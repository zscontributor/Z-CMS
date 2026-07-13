"use client";

import { useActionState, useState } from "react";
import { ROLES, type SiteDto } from "@zcmsorg/schemas";
import { inviteUserAction, type InviteState } from "@/app/actions/user";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";
import { Icon } from "@/components/shell/icon";
import { useT } from "@/lib/i18n-provider";

const INITIAL: InviteState = {};

/**
 * Invite someone, and hand back the link.
 *
 * Z-CMS ships no mailer, and this form does not pretend otherwise: it says so,
 * and gives the inviter a link to deliver themselves. The alternative — an admin
 * choosing a temporary password — means a password the admin knows, travelling
 * through whatever channel they happen to use.
 *
 * The link is shown exactly once. Only its hash is stored, so there is no
 * endpoint that could show it again, and the panel says that out loud rather than
 * letting someone discover it by navigating away.
 */
export function InviteForm({ sites }: { sites: SiteDto[] }) {
  const t = useT();
  const [state, formAction] = useActionState(inviteUserAction, INITIAL);

  if (state.created) {
    return <InviteLink token={state.created.token} email={state.created.invitation.email} />;
  }

  return (
    <form action={formAction} className="z-card flex flex-col gap-4 p-4">
      <Field label={t("admin.users.invite.email")} htmlFor="invite-email" required>
        <Input
          id="invite-email"
          name="email"
          type="email"
          required
          autoComplete="off"
          spellCheck={false}
          placeholder={t("admin.users.invite.emailPlaceholder")}
        />
      </Field>

      <Field
        label={t("admin.users.invite.scope")}
        hint={t("admin.users.role.scopeHint")}
        htmlFor="invite-scope"
      >
        <Select id="invite-scope" name="siteId" defaultValue="">
          <option value="">{t("admin.users.tenantWide")}</option>
          {sites.map((site) => (
            <option key={site.id} value={site.id}>
              {site.name}
            </option>
          ))}
        </Select>
      </Field>

      <Field label={t("admin.users.invite.role")} htmlFor="invite-role">
        <Select id="invite-role" name="role" defaultValue="VIEWER">
          {ROLES.map((role) => (
            <option key={role} value={role}>
              {t(`admin.roles.${role}`)}
            </option>
          ))}
        </Select>
      </Field>

      {state.error ? (
        <p
          role="alert"
          className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs leading-5 text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300"
        >
          {state.error}
        </p>
      ) : null}

      <SubmitButton
        variant="primary"
        className="self-start"
        pendingLabel={t("admin.users.invite.submitting")}
      >
        {t("admin.users.invite.submit")}
      </SubmitButton>
    </form>
  );
}

/**
 * The one-time link.
 *
 * The URL is built in the browser, from `window.location.origin`, because the API
 * has no business knowing where the admin is hosted — and a link minted against
 * the wrong origin is a link that does not work.
 */
function InviteLink({ token, email }: { token: string; email: string }) {
  const t = useT();
  const [copied, setCopied] = useState(false);

  const url =
    typeof window === "undefined"
      ? ""
      : `${window.location.origin}/accept-invite?token=${encodeURIComponent(token)}`;

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      // Clipboard access can be refused (an insecure origin, a locked-down
      // browser). The link is on screen and selectable either way, which is why
      // this is not an error worth interrupting anyone with.
    }
  }

  return (
    <div className="z-card flex flex-col gap-3 p-4">
      <div>
        <h3 className="flex items-center gap-1.5 text-sm font-semibold">
          <Icon name="key" size={16} />
          {t("admin.users.invite.linkHeading")}
        </h3>
        <p className="mt-0.5 text-[11px] z-muted">{email}</p>
      </div>

      <p className="flex items-start gap-1.5 rounded-md border border-amber-200 bg-amber-50/70 px-2.5 py-2 text-[11px] leading-4 text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300">
        <Icon name="warning" size={16} className="mt-px shrink-0" />
        <span>{t("admin.users.invite.linkBody")}</span>
      </p>

      <code className="block max-h-24 overflow-y-auto rounded-md border border-[var(--border)] bg-[var(--surface-sunken)] p-2 font-mono text-[11px] break-all">
        {url}
      </code>

      <div className="flex gap-2">
        <Button variant="primary" size="sm" onClick={copy}>
          <Icon name={copied ? "check" : "copy"} size={15} />
          {copied ? t("admin.users.invite.copied") : t("admin.users.invite.copy")}
        </Button>
        {/* A reload drops the token from memory, which is the point: the panel
            cannot become a place the link quietly lives on. */}
        <Button size="sm" onClick={() => window.location.reload()}>
          {t("admin.users.invite.done")}
        </Button>
      </div>
    </div>
  );
}
