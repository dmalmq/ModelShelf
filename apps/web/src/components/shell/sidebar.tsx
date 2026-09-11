"use client";

// The sidebar grammar shared by all three directions: a labelled nav that
// collapses to an icon rail, an accent bar marking the active route, badge
// counts on the sections that carry a live number, and footer utilities.
//
// Collapsing is a width change plus label visibility — the same DOM either
// way. That keeps the active item, the counts and the tab order identical
// between the labelled column (inspection console, review desk) and the rail
// (delivery dashboard), which is the whole point of having one component.

import Link from "next/link";
import { usePathname } from "next/navigation";
import { t, type Locale } from "@/lib/i18n";
import { Icon } from "./icons";
import { isActive, NAV_SECTIONS, type NavCounts, type NavItem } from "./nav";
import { usePreferences } from "./preferences";

export interface SidebarProps {
  /** Live badge counts. Omitted keys render no badge — never a zero. */
  counts?: NavCounts;
  projectName: string;
  tenantName: string;
  /** Fired by the project name button; wire to a picker when one exists. */
  onSwitchProject?: () => void;
}

export function Sidebar({ counts = {}, projectName, tenantName, onSwitchProject }: SidebarProps): React.JSX.Element {
  const { locale, sidebarCollapsed: collapsed, toggleSidebar } = usePreferences();
  const pathname = usePathname();

  return (
    <nav
      aria-label={t("mainNav", locale)}
      style={{ width: collapsed ? "var(--spacing-sidebar-rail)" : "var(--spacing-sidebar)" }}
      className="sticky top-0 flex h-dvh shrink-0 flex-col border-r border-edge bg-panel transition-[width] duration-150"
    >
      <Brand
        collapsed={collapsed}
        locale={locale}
        projectName={projectName}
        tenantName={tenantName}
        onSwitchProject={onSwitchProject}
      />

      <div className="flex-1 overflow-y-auto overflow-x-hidden py-2">
        {NAV_SECTIONS.map((section, index) => (
          <div key={section.key} className={index > 0 ? "mt-1 pt-1" : undefined}>
            {collapsed ? (
              // No room for the heading, so the grouping is carried by a rule.
              index > 0 ? <hr className="mx-3 mb-2 border-edge" /> : null
            ) : (
              <h2 className="px-3 pb-1 pt-2 text-xs font-semibold uppercase tracking-[0.14em] text-ink-faint">
                {t(section.key, locale)}
              </h2>
            )}
            <ul className="flex flex-col gap-px px-1.5">
              {section.items.map((item) => (
                <li key={item.key}>
                  <NavRow
                    item={item}
                    active={isActive(item.href, pathname)}
                    collapsed={collapsed}
                    locale={locale}
                    counts={counts}
                  />
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      <div className="flex flex-col gap-px border-t border-edge p-1.5">
        <button
          type="button"
          onClick={toggleSidebar}
          aria-expanded={!collapsed}
          title={collapsed ? t("expandSidebar", locale) : undefined}
          className="flex cursor-pointer items-center gap-2.5 rounded px-2.5 py-2 text-ink-faint transition-colors hover:bg-panel-raised hover:text-ink-dim"
        >
          <Icon name="panelCollapse" className={collapsed ? "shrink-0 rotate-180" : "shrink-0"} />
          <span className={collapsed ? "sr-only" : "truncate text-xs"}>
            {collapsed ? t("expandSidebar", locale) : t("collapseSidebar", locale)}
          </span>
        </button>

        <span
          aria-disabled="true"
          title={`${t("help", locale)} — ${t("notAvailableYet", locale)}`}
          className="flex cursor-default items-center gap-2.5 rounded px-2.5 py-2 text-ink-faint opacity-60"
        >
          <Icon name="help" className="shrink-0" />
          <span className={collapsed ? "sr-only" : "flex-1 truncate text-xs"}>{t("help", locale)}</span>
          {collapsed ? null : <Icon name="chevronRight" className="shrink-0 opacity-60" />}
        </span>
      </div>
    </nav>
  );
}

function Brand({
  collapsed,
  locale,
  projectName,
  tenantName,
  onSwitchProject,
}: {
  collapsed: boolean;
  locale: Locale;
  projectName: string;
  tenantName: string;
  onSwitchProject?: () => void;
}): React.JSX.Element {
  return (
    <div className="flex items-center gap-2 border-b border-edge px-2.5 py-3">
      <span
        aria-hidden="true"
        className="grid size-7 shrink-0 place-items-center rounded bg-accent-soft font-display text-xs font-bold text-primary"
      >
        MS
      </span>
      {collapsed ? (
        <span className="sr-only">{`${t("brand", locale)} — ${projectName}`}</span>
      ) : (
        <button
          type="button"
          onClick={onSwitchProject}
          disabled={!onSwitchProject}
          aria-label={`${projectName} — ${t("switchProject", locale)}`}
          className="flex min-w-0 flex-1 cursor-pointer items-center gap-1.5 rounded px-1 py-0.5 text-left transition-colors hover:bg-panel-raised disabled:cursor-default disabled:hover:bg-transparent"
        >
          <span className="min-w-0 flex-1">
            <span className="block truncate font-display text-[13px] font-semibold leading-tight text-ink">
              {projectName}
            </span>
            <span className="block truncate text-xs leading-tight text-ink-faint">{tenantName}</span>
          </span>
          <Icon name="chevronDown" className="shrink-0 text-ink-faint" />
        </button>
      )}
    </div>
  );
}

function NavRow({
  item,
  active,
  collapsed,
  locale,
  counts,
}: {
  item: NavItem;
  active: boolean;
  collapsed: boolean;
  locale: Locale;
  counts: NavCounts;
}): React.JSX.Element {
  const label = t(item.key, locale);
  const count = item.count ? counts[item.count] : undefined;

  const shared = [
    "relative flex items-center gap-2.5 rounded px-2.5 py-2 transition-colors",
    collapsed ? "justify-center" : "",
    active ? "bg-accent-soft text-ink" : "text-ink-dim",
  ].join(" ");

  const body = (
    <>
      {/* Accent bar: inset so it sits flush with the panel edge whatever the
          row's own padding and rounding are. */}
      {active ? <span aria-hidden="true" className="absolute inset-y-1 left-0 w-[3px] rounded-r bg-primary" /> : null}
      <span className="relative shrink-0">
        <Icon name={item.icon} className={active ? "text-primary" : undefined} />
        {collapsed && count !== undefined ? (
          <span
            aria-hidden="true"
            className="absolute -right-2 -top-1.5 min-w-3.5 rounded-full bg-primary px-1 text-center text-xs font-bold leading-[14px] text-panel"
          >
            {count}
          </span>
        ) : null}
      </span>
      <span className={collapsed ? "sr-only" : "flex-1 truncate text-xs"}>{label}</span>
      {!collapsed && count !== undefined ? (
        <span
          className={`shrink-0 rounded px-1.5 text-xs font-semibold leading-[16px] tabular-nums ${
            active ? "bg-primary text-panel" : "bg-panel-raised text-ink-faint"
          }`}
        >
          {count}
        </span>
      ) : null}
    </>
  );

  // In the rail the badge is hidden from assistive tech, so the count has to
  // ride along in the tooltip and accessible name instead.
  const title = collapsed ? (count !== undefined ? `${label} (${count})` : label) : undefined;

  if (!item.ready) {
    return (
      <span
        aria-disabled="true"
        title={`${label} — ${t("notAvailableYet", locale)}`}
        className={`${shared} cursor-default text-ink-faint opacity-60`}
      >
        {body}
      </span>
    );
  }

  return (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      title={title}
      className={`${shared} hover:bg-panel-raised hover:text-ink`}
    >
      {body}
    </Link>
  );
}
