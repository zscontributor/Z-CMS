"use client";

import { useRef, useTransition } from "react";
import type { SiteDto } from "@zcmsorg/schemas";
import { switchSiteAction } from "@/app/actions/site";
import { Select } from "@/components/ui/field";
import { useT } from "@/lib/i18n-provider";

/**
 * The selected site is a cookie, not a URL segment: it has to survive a
 * navigation to any screen, and every API call already carries it as a header.
 * Changing it submits — no client state to keep in sync.
 */
export function SiteSwitcher({
  sites,
  currentSiteId,
}: {
  sites: SiteDto[];
  currentSiteId: string | null;
}) {
  const t = useT();
  const formRef = useRef<HTMLFormElement>(null);
  const [pending, startTransition] = useTransition();

  if (sites.length === 0) {
    return <span className="text-xs z-muted">{t("admin.siteSwitcher.empty")}</span>;
  }

  return (
    <form
      ref={formRef}
      action={(formData) => startTransition(() => void switchSiteAction(formData))}
      className="flex items-center gap-2"
    >
      <label htmlFor="site-switcher" className="text-[11px] uppercase tracking-wider z-muted">
        {t("admin.siteSwitcher.label")}
      </label>
      <Select
        id="site-switcher"
        name="siteId"
        defaultValue={currentSiteId ?? sites[0]?.id}
        disabled={pending || sites.length === 1}
        onChange={() => formRef.current?.requestSubmit()}
        className="h-8 w-52 py-1 text-xs"
      >
        {sites.map((site) => (
          <option key={site.id} value={site.id}>
            {site.name}
          </option>
        ))}
      </Select>
    </form>
  );
}
