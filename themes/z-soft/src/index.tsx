import type { CSSProperties, ReactNode } from "react";
import type { MenuDto, MenuItemDto } from "@zcmsorg/schemas";
import {
  ColorModeToggle,
  defineTheme,
  type ArchiveTemplateProps,
  type BlockProps,
  type ErrorTemplateProps,
  type LayoutProps,
  type NotFoundTemplateProps,
  type PageTemplateProps,
  type ThemeContext,
  type ThemeManifest,
  type ThemeSeoOverrides,
} from "@zcmsorg/theme-sdk";
import manifestJson from "../theme.json";
import en from "./locales/en.json";
import ja from "./locales/ja.json";
import vi from "./locales/vi.json";

/**
 * Z-SOFT — the company & product theme for the Z-SOFT website.
 *
 * It talks to the Theme SDK and to nothing else: templates receive a ThemeContext
 * and a ContentDto, and that is the whole of their view of the platform. Nothing
 * here knows about Next.js, Prisma or cms-api, which is what lets the runtime swap
 * this package out for another theme without touching core.
 *
 * It renders on the SERVER, and ships no client JavaScript. The two things that
 * usually need it are handled without it:
 *
 *   - the language switcher is a native <details> disclosure over `ctx.alternates`,
 *   - the dark/light toggle is the SDK's own <ColorModeToggle>, which the runtime
 *     wires up: this theme declares in its manifest that it is drawn for both modes,
 *     says where the switch goes, and styles itself under html[data-theme="dark"].
 *
 * The header is an absolute, white-on-dark bar that overlays the first section of
 * every page. On the home page that is the cinematic hero; on every other template
 * it is a dark "page head" band the templates draw for exactly this reason, so the
 * header reads the same everywhere instead of turning white-on-white on an inner
 * page.
 */

export interface ZSoftSettings {
  primaryColor: string;
  siteTitle: string;
  logo: string;
  tagline: string;
  heroImage: string;
  heroLocation: string;
  heroPrimaryHref: string;
  heroSecondaryHref: string;
  service1Image: string;
  service1Href: string;
  service2Image: string;
  service2Href: string;
  product1Href: string;
  product2Href: string;
  product3Href: string;
  product4Href: string;
  product5Href: string;
  contactEmail: string;
  linkedinUrl: string;
  facebookUrl: string;
  showProcess: boolean;
  showQuality: boolean;
  showEngagement: boolean;
  showProducts: boolean;
  showStats: boolean;
  colorMode: string;
  metaDescription: string;
  ogImage: string;
  favicon: string;
  twitterSite: string;
  noindex: boolean;
  organizationName: string;
  organizationUrl: string;
  organizationLogo: string;
  socialProfiles: string;
  footerText: string;
}

type Ctx = ThemeContext<ZSoftSettings>;

export const manifest = manifestJson as unknown as ThemeManifest;

// --------------------------------------------------------------------- helpers

/** Block props arrive as unknown JSON. Nothing below trusts their shape. */
function str(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function list(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter(
        (item): item is Record<string, unknown> =>
          typeof item === "object" && item !== null && !Array.isArray(item),
      )
    : [];
}

function formatDate(iso: string | null, locale: string): string {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleDateString(locale, {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  } catch {
    return "";
  }
}

/** Absolute URLs go to another site untouched; site-relative ones get the locale prefix. */
function itemHref(ctx: Ctx, item: MenuItemDto): string {
  return /^[a-z]+:\/\//i.test(item.url) || item.url.startsWith("#")
    ? item.url
    : ctx.url(item.url);
}

/** A hero/section anchor is a fragment on the home page; keep the locale root in front of it. */
function homeAnchor(ctx: Ctx, href: string): string {
  if (!href) return ctx.url("/");
  if (/^[a-z]+:\/\//i.test(href) || href.startsWith("mailto:")) return href;
  if (href.startsWith("#")) return `${ctx.url("/")}${href}`;
  return ctx.url(href);
}

/** "vi" -> "Tiếng Việt": the only name a reader looking for their language recognises. */
function localeName(locale: string): string {
  try {
    return new Intl.DisplayNames([locale], { type: "language" }).of(locale) ?? locale;
  } catch {
    return locale;
  }
}

/** "one per line" is the least annoying way to type a list into a textarea. */
function parseLines(value: string | undefined): string[] | undefined {
  const lines = (value ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  return lines.length ? lines : undefined;
}

// -------------------------------------------------------------------- icons

const SunIcon = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2M12 20v2M4.93 4.93l1.42 1.42M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.42-1.42M17.66 6.34l1.41-1.41" />
  </svg>
);

const MoonIcon = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
    <path d="M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8Z" />
  </svg>
);

// ------------------------------------------------------------------ navigation

/**
 * The language switcher.
 *
 * `ctx.alternates` lists only the locales this page *actually exists in*, so
 * nothing here can send a reader to a 404. Fewer than two entries means there is
 * nothing to switch between, and the control disappears rather than showing a menu
 * of one.
 */
function LanguageSwitcher({ ctx }: { ctx: Ctx }) {
  if (ctx.alternates.length < 2) return null;

  const current = ctx.alternates.find((a) => a.current) ?? ctx.alternates[0]!;

  return (
    <details className="zsoft__lang">
      <summary aria-label={ctx.t("language.switch")}>
        <span aria-hidden="true">🌐</span>
        <span>{current.locale.toUpperCase()}</span>
      </summary>
      <ul className="zsoft__lang-menu">
        {ctx.alternates.map((alternate) => (
          <li key={alternate.locale}>
            {/* `path` is already final. Passing it through ctx.url() would prefix it
                a second time, with the locale of the page being rendered. */}
            <a
              href={alternate.path}
              hrefLang={alternate.locale}
              lang={alternate.locale}
              aria-current={alternate.current ? "true" : undefined}
            >
              <span>{localeName(alternate.locale)}</span>
            </a>
          </li>
        ))}
      </ul>
    </details>
  );
}

function PrimaryNav({ ctx, menu }: { ctx: Ctx; menu?: MenuDto }) {
  const items = menu?.items ?? [];

  // No menu configured yet: fall back to the theme's own section anchors, so a
  // brand-new site still ships a working navigation instead of an empty bar.
  const links: { key: string; href: string; label: string; cta?: boolean }[] =
    items.length > 0
      ? items.map((item, i) => ({
          key: item.id,
          href: itemHref(ctx, item),
          label: item.label,
          cta: i === items.length - 1,
        }))
      : [
          { key: "about", href: homeAnchor(ctx, "#about"), label: ctx.t("nav.about") },
          { key: "outsourcing", href: homeAnchor(ctx, "#outsourcing"), label: ctx.t("nav.outsourcing") },
          { key: "products", href: homeAnchor(ctx, "#products"), label: ctx.t("nav.products") },
          { key: "contact", href: homeAnchor(ctx, "#contact"), label: ctx.t("nav.contact"), cta: true },
        ];

  return (
    <nav className="zsoft__menu" aria-label={menu?.name ?? ctx.t("nav.primary")}>
      {links.map((link) => (
        <a key={link.key} href={link.href} className={link.cta ? "zsoft__nav-cta" : undefined}>
          {link.label}
        </a>
      ))}
    </nav>
  );
}

// ---------------------------------------------------------------------- layout

function Header({ ctx }: { ctx: Ctx }) {
  const { settings, site, menus } = ctx;
  const title = settings.siteTitle || site.name;
  const logo = settings.logo || site.brand.logo;

  return (
    <header className="zsoft__header">
      <div className="zsoft__container zsoft__nav">
        <a className="zsoft__brand" href={ctx.url("/")} aria-label={title}>
          {logo ? (
            <img className="zsoft__brand-logo" src={ctx.asset(logo)} alt="" />
          ) : (
            <>
              <span className="zsoft__brand-mark" aria-hidden="true">
                Z
              </span>
              <span>{title}</span>
            </>
          )}
        </a>

        <div className="zsoft__nav-right">
          <PrimaryNav ctx={ctx} menu={menus.primary} />
          <LanguageSwitcher ctx={ctx} />
          <ColorModeToggle
            ctx={ctx}
            className="zsoft__theme-toggle"
            lightIcon={SunIcon}
            darkIcon={MoonIcon}
          />
        </div>
      </div>
    </header>
  );
}

function Footer({ ctx }: { ctx: Ctx }) {
  const { settings, site, menus } = ctx;
  const title = settings.siteTitle || site.name;
  const footerMenu = menus.footer;

  const socials: { href: string; label: string }[] = [
    ...(settings.linkedinUrl ? [{ href: settings.linkedinUrl, label: "LinkedIn" }] : []),
    ...(settings.facebookUrl ? [{ href: settings.facebookUrl, label: "Facebook" }] : []),
  ];

  return (
    <footer className="zsoft__footer">
      <div className="zsoft__container">
        <div className="zsoft__footer-grid">
          <div>
            <div className="zsoft__footer-brand">{title}</div>
            <p>
              {ctx.t("footer.tagline1")}
              <br />
              {ctx.t("footer.tagline2")}
            </p>
          </div>

          <nav className="zsoft__footer-links" aria-label={footerMenu?.name ?? ctx.t("nav.footer")}>
            {footerMenu && footerMenu.items.length > 0 ? (
              footerMenu.items.map((item) => (
                <a key={item.id} href={itemHref(ctx, item)}>
                  {item.label}
                </a>
              ))
            ) : (
              <>
                <a href={homeAnchor(ctx, "#about")}>{ctx.t("nav.about")}</a>
                <a href={homeAnchor(ctx, "#outsourcing")}>{ctx.t("nav.outsourcing")}</a>
                <a href={homeAnchor(ctx, "#products")}>{ctx.t("nav.products")}</a>
                <a href={homeAnchor(ctx, "#contact")}>{ctx.t("nav.contact")}</a>
              </>
            )}
            {socials.map((s) => (
              <a key={s.label} href={s.href} target="_blank" rel="noopener noreferrer">
                {s.label}
              </a>
            ))}
          </nav>
        </div>

        <div className="zsoft__copyright">
          <span>{settings.footerText}</span>
          <span>{settings.tagline}</span>
        </div>
      </div>
    </footer>
  );
}

function Layout({ ctx, children }: LayoutProps<ZSoftSettings>) {
  const { settings, site } = ctx;

  // Accent arrives as data, never hardcoded: this theme's setting wins, then the
  // SITE's brand colour (which survives a theme change), then the theme default.
  const brandStyle = {
    "--accent": settings.primaryColor || site.brand.primaryColor || "#d4a75f",
  } as CSSProperties;

  return (
    <div className="zsoft" style={brandStyle}>
      <a className="zsoft__skip" href="#main">
        {ctx.t("layout.skipToContent")}
      </a>

      <Header ctx={ctx} />

      <main id="main">{children}</main>

      <Footer ctx={ctx} />

      <div className="zsoft__float">
        <a
          className="zsoft__float-btn"
          href="#main"
          aria-label={ctx.t("layout.backToTop")}
          title={ctx.t("layout.backToTop")}
        >
          <span aria-hidden="true">↑</span>
        </a>
      </div>
      {ctx.renderSlot("floating")}
    </div>
  );
}

// ------------------------------------------------------------ inner page head

/**
 * The dark band every non-home template opens with. It exists so the absolute,
 * white-on-dark header always has something dark beneath it — an inner page with a
 * white top would swallow the header whole.
 */
function PageHead({
  ctx,
  eyebrow,
  title,
  lede,
}: {
  ctx: Ctx;
  eyebrow: string;
  title: string;
  lede?: string;
}) {
  return (
    <section className="zsoft__pagehead">
      <div className="zsoft__container">
        <span className="zsoft__eyebrow zsoft__eyebrow--light">{eyebrow}</span>
        <h1 className="zsoft__pagehead-title">{title}</h1>
        {lede ? <p className="zsoft__pagehead-lede">{lede}</p> : null}
      </div>
    </section>
  );
}

// ------------------------------------------------------------------- home

const PROCESS_STEPS = [1, 2, 3, 4, 5, 6] as const;
const QUALITY_ITEMS = [1, 2, 3, 4] as const;
const ENGAGEMENT_CARDS = [1, 2, 3] as const;
const METRICS = [1, 2, 3, 4] as const;

const PRODUCTS = [
  { n: 1, hrefKey: "product1Href" },
  { n: 2, hrefKey: "product2Href" },
  { n: 3, hrefKey: "product3Href" },
  { n: 4, hrefKey: "product4Href" },
  { n: 5, hrefKey: "product5Href" },
] as const;

function ServiceRow({
  ctx,
  index,
  reverse,
  image,
  href,
}: {
  ctx: Ctx;
  index: 1 | 2;
  reverse: boolean;
  image: string;
  href: string;
}) {
  const k = (suffix: string) => ctx.t(`service${index}.${suffix}`);
  return (
    <article
      className={`zsoft__zigzag-row${reverse ? " zsoft__zigzag-row--reverse" : ""}`}
      id={index === 1 ? "outsourcing" : undefined}
    >
      <div className="zsoft__visual">
        <div className="zsoft__frame zsoft__frame--main">
          <img src={ctx.asset(image)} alt={k("cardLabel")} loading="lazy" />
        </div>
        <div className="zsoft__frame zsoft__frame--card">
          <span>{k("cardLabel")}</span>
          <p>{k("cardText")}</p>
        </div>
      </div>

      <div className="zsoft__content">
        <span className="zsoft__eyebrow">{k("eyebrow")}</span>
        <h2 dangerouslySetInnerHTML={{ __html: k("title") }} />
        <p>{k("copy")}</p>

        <div className="zsoft__classic-list">
          {[1, 2, 3].map((p) => (
            <div key={p}>
              <b>{String(p).padStart(2, "0")}</b>
              <span>{k(`point${p}`)}</span>
            </div>
          ))}
        </div>

        <a className="zsoft__btn zsoft__btn--primary" href={homeAnchor(ctx, href)}>
          {k("cta")}
        </a>
      </div>
    </article>
  );
}

function HomeTemplate({ ctx, content }: PageTemplateProps<ZSoftSettings>) {
  const { settings } = ctx;

  return (
    <>
      {/* Hero -------------------------------------------------------------- */}
      <section
        className="zsoft__hero"
        style={
          {
            "--hero-image": `url("${settings.heroImage}")`,
          } as CSSProperties
        }
      >
        <div className="zsoft__container zsoft__hero-grid">
          <div className="zsoft__hero-copy">
            <span className="zsoft__eyebrow zsoft__eyebrow--gold">{ctx.t("hero.eyebrow")}</span>
            <h1>
              {ctx.t("hero.title1")}
              <br />
              <em>{ctx.t("hero.title2")}</em>
            </h1>
            <p>{ctx.t("hero.copy")}</p>
            <div className="zsoft__hero-actions">
              <a className="zsoft__btn zsoft__btn--primary" href={homeAnchor(ctx, settings.heroPrimaryHref)}>
                {ctx.t("hero.primary")}
              </a>
              <a className="zsoft__btn zsoft__btn--light" href={homeAnchor(ctx, settings.heroSecondaryHref)}>
                {ctx.t("hero.secondary")}
              </a>
            </div>
          </div>

          <aside className="zsoft__hero-note">
            <strong>{settings.heroLocation}</strong>
            {ctx.t("hero.noteText")}
          </aside>
        </div>
      </section>

      {/* Philosophy -------------------------------------------------------- */}
      <section className="zsoft__intro" id="about">
        <div className="zsoft__container">
          <div className="zsoft__intro-grid">
            <div>
              <span className="zsoft__eyebrow">{ctx.t("philosophy.eyebrow")}</span>
            </div>
            <p>{ctx.t("philosophy.body")}</p>
          </div>
          <div className="zsoft__divider" />
        </div>
      </section>

      {/* Capabilities (zigzag) --------------------------------------------- */}
      <section className="zsoft__zigzag">
        <div className="zsoft__container">
          <ServiceRow ctx={ctx} index={1} reverse={false} image={settings.service1Image} href={settings.service1Href} />
          <ServiceRow ctx={ctx} index={2} reverse image={settings.service2Image} href={settings.service2Href} />
        </div>
      </section>

      {/* Delivery process -------------------------------------------------- */}
      {settings.showProcess ? (
        <section className="zsoft__assurance" id="process">
          <div className="zsoft__container">
            <div className="zsoft__assurance-head">
              <div>
                <span className="zsoft__eyebrow">{ctx.t("process.eyebrow")}</span>
                <h2 dangerouslySetInnerHTML={{ __html: ctx.t("process.title") }} />
              </div>
              <p>{ctx.t("process.intro")}</p>
            </div>

            <div className="zsoft__process-grid">
              {PROCESS_STEPS.map((n) => (
                <article className="zsoft__process-card" key={n}>
                  <span>{String(n).padStart(2, "0")}</span>
                  <h3>{ctx.t(`process.step${n}.title`)}</h3>
                  <p>{ctx.t(`process.step${n}.copy`)}</p>
                </article>
              ))}
            </div>
          </div>
        </section>
      ) : null}

      {/* Quality ----------------------------------------------------------- */}
      {settings.showQuality ? (
        <section className="zsoft__quality">
          <div className="zsoft__container zsoft__quality-grid">
            <div className="zsoft__quality-copy">
              <span className="zsoft__eyebrow">{ctx.t("quality.eyebrow")}</span>
              <h2>{ctx.t("quality.title")}</h2>
              <p>{ctx.t("quality.copy")}</p>
            </div>
            <div className="zsoft__quality-list">
              {QUALITY_ITEMS.map((n) => (
                <div key={n}>
                  <strong>{ctx.t(`quality.item${n}.title`)}</strong>
                  <span>{ctx.t(`quality.item${n}.copy`)}</span>
                </div>
              ))}
            </div>
          </div>
        </section>
      ) : null}

      {/* Engagement models ------------------------------------------------- */}
      {settings.showEngagement ? (
        <section className="zsoft__engagement">
          <div className="zsoft__container">
            <div className="zsoft__engagement-head">
              <span className="zsoft__eyebrow">{ctx.t("engagement.eyebrow")}</span>
              <h2>{ctx.t("engagement.title")}</h2>
            </div>
            <div className="zsoft__engagement-grid">
              {ENGAGEMENT_CARDS.map((n) => (
                <article className="zsoft__engagement-card" key={n}>
                  <span>{String(n).padStart(2, "0")}</span>
                  <h3>{ctx.t(`engagement.card${n}.title`)}</h3>
                  <p>{ctx.t(`engagement.card${n}.copy`)}</p>
                  <small>{ctx.t(`engagement.card${n}.tag`)}</small>
                </article>
              ))}
            </div>
          </div>
        </section>
      ) : null}

      {/* Product ecosystem ------------------------------------------------- */}
      {settings.showProducts ? (
        <section className="zsoft__products" id="products">
          <div className="zsoft__container">
            <div className="zsoft__products-head">
              <div>
                <span className="zsoft__eyebrow">{ctx.t("products.eyebrow")}</span>
                <h2>{ctx.t("products.title")}</h2>
              </div>
              <p>{ctx.t("products.copy")}</p>
            </div>

            <div className="zsoft__product-grid">
              {PRODUCTS.map(({ n, hrefKey }) => {
                const href = str(settings[hrefKey as keyof ZSoftSettings]);
                const Tag = href ? "a" : "div";
                return (
                  <Tag
                    className="zsoft__product-card"
                    key={n}
                    {...(href ? { href, target: "_blank", rel: "noopener noreferrer" } : {})}
                  >
                    <span className="zsoft__product-no">{String(n).padStart(2, "0")}</span>
                    <h3>{ctx.t(`products.item${n}.title`)}</h3>
                    <p>{ctx.t(`products.item${n}.copy`)}</p>
                    <span className="zsoft__product-arrow" aria-hidden="true">
                      ↗
                    </span>
                  </Tag>
                );
              })}
            </div>
          </div>
        </section>
      ) : null}

      {/* Quote & metrics --------------------------------------------------- */}
      {settings.showStats ? (
        <section className="zsoft__stats">
          <div className="zsoft__container zsoft__stats-grid">
            <blockquote className="zsoft__quote">
              <p>{ctx.t("stats.quote")}</p>
              <footer>{ctx.t("stats.quoteAuthor")}</footer>
            </blockquote>

            <div className="zsoft__metrics">
              {METRICS.map((n) => (
                <div className="zsoft__metric" key={n}>
                  <strong>{ctx.t(`stats.metric${n}.value`)}</strong>
                  <span>{ctx.t(`stats.metric${n}.label`)}</span>
                </div>
              ))}
            </div>
          </div>
        </section>
      ) : null}

      {/* Editable page content — whatever the editor placed on the home page. */}
      {content.blocks.length > 0 ? (
        <section className="zsoft__section" id="content">
          <div className="zsoft__container zsoft__prose">{ctx.renderBlocks(content.blocks)}</div>
        </section>
      ) : null}

      {/* Closing call to action ------------------------------------------- */}
      <section className="zsoft__cta" id="contact">
        <div className="zsoft__container">
          <div className="zsoft__cta-box">
            <div>
              <span className="zsoft__eyebrow">{ctx.t("cta.eyebrow")}</span>
              <h2>{ctx.t("cta.title")}</h2>
              <p>{ctx.t("cta.copy")}</p>
            </div>
            <a className="zsoft__btn zsoft__btn--solid" href={`mailto:${settings.contactEmail}`}>
              {ctx.t("cta.button")}
            </a>
          </div>
        </div>
      </section>
    </>
  );
}

// ------------------------------------------------------------- inner templates

function PageTemplate({ ctx, content }: PageTemplateProps<ZSoftSettings>) {
  return (
    <article className="zsoft__article">
      <PageHead
        ctx={ctx}
        eyebrow={ctx.settings.siteTitle || ctx.site.name}
        title={content.title}
        lede={content.excerpt || undefined}
      />
      <div className="zsoft__container zsoft__narrow">
        <div className="zsoft__prose">{ctx.renderBlocks(content.blocks)}</div>
      </div>
    </article>
  );
}

function PostTemplate({ ctx, content }: PageTemplateProps<ZSoftSettings>) {
  const readingTime = Number((content.data as Record<string, unknown>)?.readingTime);
  const meta = [
    formatDate(content.publishedAt, ctx.locale),
    content.author?.name,
    Number.isFinite(readingTime) && readingTime > 0
      ? ctx.t("post.readingTime", { minutes: readingTime })
      : "",
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <article className="zsoft__article">
      <PageHead ctx={ctx} eyebrow={meta || ctx.t("nav.blog")} title={content.title} lede={content.excerpt || undefined} />
      <div className="zsoft__container zsoft__narrow">
        <p className="zsoft__meta">
          <a href={ctx.url("/blog")}>← {ctx.t("post.backToPosts")}</a>
        </p>
        <div className="zsoft__prose">{ctx.renderBlocks(content.blocks)}</div>
      </div>
    </article>
  );
}

function ArchiveTemplate({ ctx, archive }: ArchiveTemplateProps<ZSoftSettings>) {
  return (
    <section className="zsoft__article">
      <PageHead ctx={ctx} eyebrow={ctx.settings.siteTitle || ctx.site.name} title={archive.title} />
      <div className="zsoft__container zsoft__narrow">
        {archive.items.length === 0 ? (
          <p className="zsoft__lede">{ctx.t("archive.empty")}</p>
        ) : (
          <ul className="zsoft__archive-list">
            {archive.items.map((item) => (
              <li key={item.id}>
                <p className="zsoft__meta">{formatDate(item.publishedAt, ctx.locale)}</p>
                <h2>
                  <a href={ctx.url(item.path)}>{item.title}</a>
                </h2>
                {item.excerpt ? <p>{item.excerpt}</p> : null}
              </li>
            ))}
          </ul>
        )}

        {archive.totalPages > 1 ? (
          <div className="zsoft__pagination">
            {archive.page > 1 ? (
              <a href={`${archive.basePath}?page=${archive.page - 1}`}>← {ctx.t("archive.previous")}</a>
            ) : (
              <span />
            )}
            <span>{ctx.t("archive.pageOf", { page: archive.page, total: archive.totalPages })}</span>
            {archive.page < archive.totalPages ? (
              <a href={`${archive.basePath}?page=${archive.page + 1}`}>{ctx.t("archive.next")} →</a>
            ) : (
              <span />
            )}
          </div>
        ) : null}
      </div>
    </section>
  );
}

function NotFoundTemplate({ ctx }: NotFoundTemplateProps<ZSoftSettings>) {
  return (
    <section className="zsoft__article">
      <PageHead ctx={ctx} eyebrow="404" title={ctx.t("notFound.title")} lede={ctx.t("notFound.description")} />
      <div className="zsoft__container zsoft__narrow">
        <a className="zsoft__btn zsoft__btn--primary" href={ctx.url("/")}>
          {ctx.t("notFound.backHome")}
        </a>
      </div>
    </section>
  );
}

function ErrorTemplate({ ctx, statusCode, title, message, digest }: ErrorTemplateProps<ZSoftSettings>) {
  return (
    <section className="zsoft__article">
      <PageHead
        ctx={ctx}
        eyebrow={String(statusCode)}
        title={title || ctx.t("error.title")}
        lede={message || ctx.t("error.description")}
      />
      <div className="zsoft__container zsoft__narrow">
        {digest ? (
          <p className="zsoft__meta">
            {ctx.t("error.reference")}: {digest}
          </p>
        ) : null}
        <a className="zsoft__btn zsoft__btn--primary" href={ctx.url("/")}>
          {ctx.t("error.backHome")}
        </a>
      </div>
    </section>
  );
}

// ----------------------------------------------------------------------- blocks
//
// The six core block types, drawn in Z-SOFT's look. Prop keys match admin-web's
// block registry (heading/subheading/image/ctaLabel/ctaHref, items[].description,
// text/buttonLabel/buttonHref) with the older aliases kept as fallbacks, so the
// admin's editing form drives them directly.

function HeroBlock({ props, ctx }: BlockProps<Record<string, unknown>, ZSoftSettings>) {
  const label = str(props.ctaLabel ?? props.buttonLabel);
  const href = str(props.ctaHref ?? props.buttonHref);
  const image = str(props.image ?? props.src);
  return (
    <section className="zsoft__block-hero" style={image ? { backgroundImage: `url("${image}")` } : undefined}>
      {props.eyebrow ? <span className="zsoft__eyebrow zsoft__eyebrow--gold">{str(props.eyebrow)}</span> : null}
      <h2>{str(props.heading)}</h2>
      {props.subheading ? <p>{str(props.subheading)}</p> : null}
      {label && href ? (
        <p className="zsoft__block-hero-cta">
          <a className="zsoft__btn zsoft__btn--primary" href={ctx.url(href)}>
            {label}
          </a>
        </p>
      ) : null}
    </section>
  );
}

/**
 * Authored HTML, rendered as HTML. Safe because cms-api sanitises `props.html` at
 * WRITE time (sanitizeBlocks), so scripts, event handlers, javascript: URLs and
 * framing tags are already stripped against a strict allowlist by the time it
 * reaches here.
 */
function RichTextBlock({ props }: BlockProps<Record<string, unknown>, ZSoftSettings>) {
  return <div className="zsoft__prose" dangerouslySetInnerHTML={{ __html: str(props.html) }} />;
}

function FeaturesBlock({ props }: BlockProps<Record<string, unknown>, ZSoftSettings>) {
  const items = list(props.items);
  return (
    <section className="zsoft__block-features">
      {props.heading ? <h2>{str(props.heading)}</h2> : null}
      {props.subheading ? <p className="zsoft__block-lede">{str(props.subheading)}</p> : null}
      <div className="zsoft__block-features-grid">
        {items.map((item, index) => (
          <article key={index}>
            <span>{String(index + 1).padStart(2, "0")}</span>
            <h3>{str(item.title)}</h3>
            <p>{str(item.description ?? item.body)}</p>
          </article>
        ))}
      </div>
    </section>
  );
}

function ImageBlock({ props, ctx }: BlockProps<Record<string, unknown>, ZSoftSettings>) {
  const src = str(props.src ?? props.url);
  if (!src) return null;
  const width = str(props.width, "contained");
  return (
    <figure className={`zsoft__figure zsoft__figure--${width}`}>
      <img src={ctx.asset(src)} alt={str(props.alt)} loading="lazy" />
      {props.caption ? <figcaption>{str(props.caption)}</figcaption> : null}
    </figure>
  );
}

function CtaBlock({ props, ctx }: BlockProps<Record<string, unknown>, ZSoftSettings>) {
  const label = str(props.buttonLabel ?? props.ctaLabel);
  const href = str(props.buttonHref ?? props.ctaHref);
  const body = str(props.text ?? props.body);
  return (
    <section className={`zsoft__block-cta${props.inverted ? " zsoft__block-cta--inverted" : ""}`}>
      <div>
        <h2>{str(props.heading)}</h2>
        {body ? <p>{body}</p> : null}
      </div>
      {label && href ? (
        <a className="zsoft__btn zsoft__btn--solid" href={ctx.url(href)}>
          {label}
        </a>
      ) : null}
    </section>
  );
}

/**
 * `core/content-list` — a list an EDITOR placed. cms-api has already run the query
 * and resolved the rows into `props.items`, so this renders exactly like a static
 * list and needs no idea a database was involved.
 */
function ContentListBlock({ props, ctx }: BlockProps<Record<string, unknown>, ZSoftSettings>) {
  const items = list(props.items);
  const grid = str(props.layout, "list") === "grid";

  return (
    <section className="zsoft__block-section">
      {props.heading ? <h2>{str(props.heading)}</h2> : null}
      {items.length === 0 ? (
        <p>{ctx.t("latest.empty")}</p>
      ) : (
        <ul className={grid ? "zsoft__post-grid" : "zsoft__archive-list"}>
          {items.map((item, index) => {
            const path = str(item.path);
            const title = str(item.title);
            return (
              <li className={grid ? "zsoft__post-card" : undefined} key={str(item.id, String(index))}>
                <p className="zsoft__meta">
                  {formatDate(typeof item.publishedAt === "string" ? item.publishedAt : null, ctx.locale)}
                </p>
                <h3>{path ? <a href={ctx.url(path)}>{title}</a> : title}</h3>
                {item.excerpt ? <p>{str(item.excerpt)}</p> : null}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

// ------------------------------------------------------------------------ theme

const theme = defineTheme<ZSoftSettings>({
  manifest,
  Layout,
  templates: {
    home: HomeTemplate,
    page: PageTemplate,
    post: PostTemplate,
    archive: ArchiveTemplate,
    notFound: NotFoundTemplate,
    error: ErrorTemplate,
  },
  blocks: {
    "core/hero": HeroBlock,
    "core/richtext": RichTextBlock,
    "core/features": FeaturesBlock,
    "core/image": ImageBlock,
    "core/cta": CtaBlock,
    "core/content-list": ContentListBlock,
  },

  messages: { en, ja, vi },

  seo: (ctx): ThemeSeoOverrides => {
    const s = ctx.settings;
    return {
      defaultTitle: s.siteTitle || undefined,
      description: s.metaDescription || undefined,
      ogImage: s.ogImage || undefined,
      twitterSite: s.twitterSite || undefined,
      robots: s.noindex ? { index: false, follow: false } : undefined,
      icons: {
        ...(s.favicon ? { favicon: s.favicon, icon: s.favicon } : {}),
        themeColor: s.primaryColor || ctx.site.brand.primaryColor || undefined,
      },
      organization: {
        name: s.organizationName || s.siteTitle || "",
        url: s.organizationUrl || undefined,
        logo: s.organizationLogo || undefined,
        sameAs: parseLines(s.socialProfiles),
      },
    };
  },
});

export default theme;
export { Layout };
