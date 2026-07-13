import {
  BadGatewayException,
  BadRequestException,
  Controller,
  Injectable,
  Module,
  NotFoundException,
  Param,
  Post,
  Body,
  Query,
  UseGuards,
  ForbiddenException,
} from "@nestjs/common";
import { db, getSystemDb } from "@zcmsorg/database";
import { CreateContentSchema, UpdateContentSchema, type Permission } from "@zcmsorg/schemas";
import { Actor, Internal, RequirePermissions, SiteId, SiteScoped } from "../auth/decorators";
import { RateLimit } from "../common/rate-limit.decorator";
import { RateLimitGuard } from "../common/rate-limit.guard";
import type { RequestActor } from "../common/request-context";
import { ContentsService } from "../contents/contents.service";
import { ContentsModule } from "../contents/contents.module";
import { PluginsService } from "../plugins/plugins.service";

/**
 * The AI capability, as core sees it.
 *
 * There used to be a `const ZAI_KEY = "vn.zsoft.plugin.zai"` here, and three
 * `fetch()` calls to OpenAI, Anthropic and Google below it. Core held the API keys,
 * core made the requests, and the "plugin" was a settings form with a capability
 * string on it — because a plugin had no way to reach the internet, so the only way
 * to ship an AI feature was to put it in core and hard-code the plugin's id.
 *
 * That is gone. The provider calls live in the plugin now, in the sandbox, going out
 * through `ctx.http` under the hosts its manifest declares. What is left here is the
 * part that is genuinely core's business: finding the site, sanitising the messages,
 * and — for the admin operator — deciding whether the actor may do what the model
 * just asked for.
 *
 * Note that no identifier in this file names zAI. Core asks for whichever plugin
 * provides `ai.assistant`; swapping zAI for a different AI plugin is now an install,
 * not a patch.
 */
const AI_CAPABILITY = "ai.assistant";

type ChatMessage = { role: "user" | "assistant"; content: string };

/** The plugin's answer to a `chat` call. */
interface ChatAnswer {
  answer: string;
  provider: string;
}

@Injectable()
export class AiService {
  constructor(
    private readonly contents: ContentsService,
    private readonly plugins: PluginsService,
  ) {}

  async chat(hostname: string, messages: ChatMessage[]): Promise<ChatAnswer> {
    const domain = await getSystemDb().domain.findUnique({
      where: { hostname: hostname.toLowerCase() },
      include: { site: true },
    });
    if (!domain || domain.site.status !== "PUBLISHED") {
      throw new NotFoundException("Site not found.");
    }

    return this.ask(domain.site.tenantId, domain.site.id, this.sanitise(messages));
  }

  async adminChat(
    actor: RequestActor,
    siteId: string,
    messages: ChatMessage[],
    confirmDestructive: boolean,
  ) {
    await this.requireContentManagement(actor.tenantId, siteId);

    const contentTypes = await db().contentType.findMany({
      where: { siteId, key: { in: ["page", "post", "blog"] } },
      select: { id: true, key: true, name: true, fields: true },
    });
    const clean = this.sanitise(messages);

    const instruction = [
      "You are the Z-CMS admin content operator.",
      "Translate the admin request into exactly one JSON object and no markdown.",
      'Allowed actions: list, get, create, update, publish, unpublish, delete.',
      'Shape: {"action":"...","contentTypeKey?":"page|post|blog","id?":"uuid","query?":"text","input?":{...}}.',
      "For create input use title, slug, optional locale/excerpt/data/blocks/seo/status. Never invent an id.",
      "For update put only changed fields in input. Use list first when an id is unknown.",
      `Available content types: ${JSON.stringify(contentTypes)}.`,
    ].join("\n");
    // requireCore: the admin operator turns the model's output into content CRUD
    // under the ACTOR's permissions. Letting any marketplace plugin that declared
    // `ai.assistant` drive that would be a privilege escalation dressed up as an
    // integration — so this one call, unlike the public chat, insists on the
    // platform's own plugin.
    const { answer, provider } = await this.ask(actor.tenantId, siteId, clean, {
      systemPrompt: instruction,
      requireCore: true,
    });

    const command = this.parseCommand(answer);
    const required = this.permissionFor(command.action);
    if (!actor.permissions.includes(required)) {
      throw new ForbiddenException(`Your account does not have ${required}.`);
    }
    if (command.action === "delete" && !confirmDestructive) {
      return {
        answer: `Xác nhận xóa nội dung ${command.id ?? "đã chọn"}? Thao tác này không thể hoàn tác.`,
        provider,
        confirmationRequired: true,
      };
    }

    const result = await this.executeCommand(actor, siteId, contentTypes, command);
    return { answer: this.describeResult(command.action, result), provider, result };
  }

  /**
   * Asks whichever plugin provides `ai.assistant` to answer, and waits for it.
   *
   * This is the whole provider layer now. Core does not know which model was used,
   * does not hold the API key, and does not open the socket — the plugin does the
   * first, the gateway holds the second, and cms-api's egress service does the
   * third. What comes back is text.
   */
  private async ask(
    tenantId: string,
    siteId: string,
    messages: ChatMessage[],
    options: { systemPrompt?: string; requireCore?: boolean } = {},
  ): Promise<ChatAnswer> {
    const result = (await this.plugins.callCapability(
      tenantId,
      siteId,
      AI_CAPABILITY,
      "chat",
      { messages, ...(options.systemPrompt ? { systemPrompt: options.systemPrompt } : {}) },
      { requireCore: options.requireCore },
    )) as ChatAnswer | null;

    if (!result?.answer) {
      throw new BadGatewayException("The AI provider returned an empty response.");
    }
    return result;
  }

  /**
   * The admin operator is gated on a setting the plugin declares but core enforces.
   *
   * `isCore` and `publisher` are platform-controlled catalogue columns — a
   * marketplace package cannot claim either — so this is an identity check, whereas
   * the capability string in a manifest is only a claim.
   */
  private async requireContentManagement(tenantId: string, siteId: string): Promise<void> {
    const install = await getSystemDb().sitePlugin.findFirst({
      where: {
        tenantId,
        siteId,
        status: "ACTIVE",
        plugin: { isCore: true, publisher: "Z-SOFT Co., Ltd" },
      },
      select: { settings: true },
    });

    const settings = (install?.settings ?? {}) as { contentManagementEnabled?: boolean };
    if (!install || settings.contentManagementEnabled !== true) {
      throw new ForbiddenException(
        "AI content management is disabled, or the trusted core AI plugin is not active.",
      );
    }
  }

  /** Trims the transcript to what a provider should see: recent, non-empty, user-last. */
  private sanitise(messages: ChatMessage[]): ChatMessage[] {
    const clean = (messages ?? [])
      .filter((item) => item && (item.role === "user" || item.role === "assistant"))
      .slice(-12)
      .map((item) => ({ role: item.role, content: String(item.content).trim().slice(0, 4_000) }))
      .filter((item) => item.content);

    if (!clean.length || clean.at(-1)?.role !== "user") {
      throw new BadRequestException("A user message is required.");
    }
    return clean;
  }

  private parseCommand(raw: string): { action: string; id?: string; contentTypeKey?: string; query?: string; input?: Record<string, unknown> } {
    try {
      const start = raw.indexOf("{");
      const end = raw.lastIndexOf("}");
      const value = JSON.parse(raw.slice(start, end + 1)) as Record<string, unknown>;
      const allowed = ["list", "get", "create", "update", "publish", "unpublish", "delete"];
      if (!allowed.includes(String(value.action))) throw new Error("Unsupported action");
      return {
        action: String(value.action),
        ...(typeof value.id === "string" ? { id: value.id } : {}),
        ...(typeof value.contentTypeKey === "string" ? { contentTypeKey: value.contentTypeKey } : {}),
        ...(typeof value.query === "string" ? { query: value.query } : {}),
        ...(value.input && typeof value.input === "object" ? { input: value.input as Record<string, unknown> } : {}),
      };
    } catch {
      throw new BadGatewayException("The AI provider did not return a valid content command.");
    }
  }

  private permissionFor(action: string): Permission {
    if (action === "create") return "content:create";
    if (action === "update") return "content:update";
    if (action === "delete") return "content:delete";
    if (action === "publish" || action === "unpublish") return "content:publish";
    return "content:read";
  }

  private async executeCommand(
    actor: RequestActor,
    siteId: string,
    types: Array<{ id: string; key: string }>,
    command: { action: string; id?: string; contentTypeKey?: string; query?: string; input?: Record<string, unknown> },
  ): Promise<unknown> {
    if (command.action === "list") {
      if (command.contentTypeKey && !types.some((item) => item.key === command.contentTypeKey)) {
        throw new BadRequestException("Only page, post, and blog content can be managed by zAI.");
      }
      const selected = command.contentTypeKey
        ? [command.contentTypeKey]
        : types.map((item) => item.key);
      const pages = await Promise.all(selected.map((contentTypeKey) =>
        this.contents.list(siteId, {
          contentTypeKey,
          search: command.query,
          page: 1,
          perPage: 20,
        }),
      ));
      return { items: pages.flatMap((page) => page.items), total: pages.reduce((sum, page) => sum + page.total, 0) };
    }
    if (!command.id && command.action !== "create") {
      throw new BadRequestException("The AI command requires a content id. Ask it to list matching content first.");
    }
    if (command.action !== "create") {
      const existing = await this.contents.findOne(siteId, command.id!);
      if (!types.some((item) => item.key === existing.contentType.key)) {
        throw new ForbiddenException("zAI may only manage page, post, and blog content.");
      }
      if (command.action === "get") return existing;
    }
    if (command.action === "create") {
      const type = types.find((item) => item.key === command.contentTypeKey);
      if (!type) throw new BadRequestException("The requested page/blog content type does not exist.");
      const input = CreateContentSchema.parse({ ...command.input, contentTypeId: type.id });
      return this.contents.create(actor, siteId, input);
    }
    if (command.action === "update") {
      return this.contents.update(actor, siteId, command.id!, UpdateContentSchema.parse(command.input ?? {}));
    }
    if (command.action === "publish") return this.contents.setPublished(actor, siteId, command.id!, true);
    if (command.action === "unpublish") return this.contents.setPublished(actor, siteId, command.id!, false);
    await this.contents.remove(actor, siteId, command.id!);
    return { id: command.id, deleted: true };
  }

  private describeResult(action: string, result: unknown): string {
    if (action === "list") {
      const items = (result as { items?: Array<{ id: string; title: string; status: string }> }).items ?? [];
      return items.length
        ? items.map((item) => `${item.title} — ${item.status} — ${item.id}`).join("\n")
        : "Không tìm thấy page/blog phù hợp.";
    }
    if (action === "delete") return "Đã xóa nội dung thành công.";
    const item = result as { title?: string; id?: string; status?: string };
    return `Đã ${action} thành công: ${item.title ?? item.id ?? "content"}${item.status ? ` (${item.status})` : ""}.`;
  }
}

@Controller("ai")
@UseGuards(RateLimitGuard)
export class AiController {
  constructor(private readonly ai: AiService) {}

  @Internal("render")
  @Post("chat")
  @RateLimit({ by: "ip", points: 20, windowSec: 60 })
  chat(
    @Query("hostname") hostname: string,
    @Body() body: { messages?: ChatMessage[] },
  ) {
    if (!hostname) throw new BadRequestException("hostname is required.");
    if (!Array.isArray(body.messages)) throw new BadRequestException("messages must be an array.");
    return this.ai.chat(hostname, body.messages);
  }

  @Post("admin/chat")
  @SiteScoped()
  @RequirePermissions("content:read")
  @RateLimit({ by: "ip", points: 30, windowSec: 60 })
  adminChat(
    @Actor() actor: RequestActor,
    @SiteId() siteId: string,
    @Body() body: { messages?: ChatMessage[]; confirmDestructive?: boolean },
  ) {
    if (!Array.isArray(body.messages)) throw new BadRequestException("messages must be an array.");
    return this.ai.adminChat(actor, siteId, body.messages, body.confirmDestructive === true);
  }
}

/** Stable capability endpoint. Plugin keys stay an implementation detail. */
@Controller("integrations")
@UseGuards(RateLimitGuard)
export class IntegrationController {
  constructor(private readonly ai: AiService) {}

  @Internal("render")
  @Post(":capability/actions/:action")
  @RateLimit({ by: "ip", points: 20, windowSec: 60 })
  action(
    @Param("capability") capability: string,
    @Param("action") action: string,
    @Query("hostname") hostname: string,
    @Body() body: { messages?: ChatMessage[] },
  ) {
    if (capability !== "ai.assistant" || action !== "chat") {
      throw new NotFoundException("Integration action not found.");
    }
    if (!hostname) throw new BadRequestException("hostname is required.");
    if (!Array.isArray(body.messages)) throw new BadRequestException("messages must be an array.");
    return this.ai.chat(hostname, body.messages);
  }
}

@Module({
  imports: [ContentsModule],
  controllers: [AiController, IntegrationController],
  providers: [AiService],
})
export class AiModule {}
