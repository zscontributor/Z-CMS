import type { Metadata } from "next";
import {
  can,
  getCurrentSite,
  getSession,
  listInstalledThemes,
  listThemeCatalog,
  type InstalledThemeDto,
  type ThemeCatalogEntry,
} from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/ui/table";
import { getT } from "@/lib/locale";
import { ActivateButton } from "./activate-button";
import { SeedDemoButton } from "./seed-demo-button";
import { ThemeSettingsForm } from "./theme-settings-form";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t("appearance.metaTitle") };
}

export const dynamic = "force-dynamic";

export default async function AppearancePage() {
  const t = await getT();
  const user = await getSession();

  if (!can(user, "theme:read")) {
    return <div className="z-card p-10 text-center text-sm">{t("appearance.denied")}</div>;
  }

  const [site, installed, catalog] = await Promise.all([
    getCurrentSite(),
    safe<InstalledThemeDto[]>(listInstalledThemes, []),
    safe<ThemeCatalogEntry[]>(listThemeCatalog, []),
  ]);

  const activeKey = site?.activeTheme?.key ?? null;
  const active = installed.find((theme) => theme.key === activeKey) ?? null;
  const installedKeys = new Set(installed.map((theme) => theme.key));
  const available = catalog.filter((entry) => !installedKeys.has(entry.key));

  const canActivate = can(user, "theme:activate");
  const canConfigure = can(user, "theme:configure");

  return (
    <>
      <PageHeader title={t("appearance.title")} description={t("appearance.description")} />

      {installed.length === 0 ? (
        <div className="z-card">
          <EmptyState
            title={t("appearance.emptyTitle")}
            description={t("appearance.emptyDescription")}
          />
        </div>
      ) : (
        <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {installed.map((theme) => {
            const isActive = theme.key === activeKey;
            return (
              <article
                key={theme.key}
                className={
                  isActive
                    ? "z-card border-brand-500 p-4 ring-1 ring-brand-500/30"
                    : "z-card p-4"
                }
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h2 className="truncate text-sm font-semibold">{theme.name}</h2>
                    <p className="mt-0.5 text-[11px] z-muted">
                      <code>{theme.key}</code> · v{theme.version}
                    </p>
                  </div>
                  {isActive ? (
                    <Badge tone="success">{t("appearance.active")}</Badge>
                  ) : (
                    <Badge tone="neutral">{theme.status}</Badge>
                  )}
                </div>

                {!isActive && canActivate ? (
                  <div className="mt-3">
                    <ActivateButton themeKey={theme.key} name={theme.name} />
                  </div>
                ) : null}
              </article>
            );
          })}
        </section>
      )}

      {active ? (
        <section className="z-card mt-5 p-4">
          <header className="mb-4 flex items-center justify-between gap-2">
            <div>
              <h2 className="text-sm font-semibold">
                {t("appearance.settings.heading", { name: active.name })}
              </h2>
              <p className="mt-0.5 text-[11px] z-muted">
                {active.demoAvailable
                  ? active.demoSeeded
                    ? t("appearance.demo.seededHint")
                    : t("appearance.demo.availableHint")
                  : t("appearance.settings.generated")}
              </p>
            </div>
            {active.demoAvailable && canConfigure ? (
              <SeedDemoButton seeded={active.demoSeeded} />
            ) : null}
          </header>

          <ThemeSettingsForm
            themeKey={active.key}
            schema={active.settingsSchema}
            settings={active.settings ?? {}}
            disabled={!canConfigure}
          />
        </section>
      ) : null}

      {available.length > 0 ? (
        <section className="mt-5">
          <h2 className="mb-2 text-sm font-semibold">{t("appearance.available")}</h2>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {available.map((entry) => (
              <article key={entry.key} className="z-card p-4">
                <h3 className="text-sm font-semibold">{entry.name}</h3>
                <p className="mt-0.5 text-[11px] z-muted">
                  {entry.author} · v{entry.versions[entry.versions.length - 1]?.version ?? "—"}
                </p>
                <p className="mt-2 line-clamp-3 text-xs z-muted">{entry.description}</p>
                {canActivate ? (
                  <div className="mt-3">
                    <ActivateButton themeKey={entry.key} name={entry.name} />
                  </div>
                ) : null}
              </article>
            ))}
          </div>
        </section>
      ) : null}
    </>
  );
}

async function safe<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch {
    return fallback;
  }
}
