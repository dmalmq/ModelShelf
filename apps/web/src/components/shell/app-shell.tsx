"use client";

// The frame every screen sits in: sidebar, a header carrying the page's own
// title and actions alongside the JA/EN and light/dark switchers, and the
// content column.
//
// The concept headers differ per screen in their title and actions but never
// in their anatomy, so those are slots while the switchers are fixed. Both
// switchers live here rather than in the sidebar footer so they stay reachable
// when the sidebar is a 3.5rem rail.

import { t } from "@/lib/i18n";
import { usePreferences, type Theme } from "./preferences";
import { Sidebar } from "./sidebar";
import { LocaleSwitcher, ThemeToggle } from "./toggles";
import type { NavCounts } from "./nav";

export interface AppShellProps {
  projectName: string;
  tenantName: string;
  counts?: NavCounts;
  onSwitchProject?: () => void;
  /** Left side of the header — normally a <PageHeading>. */
  header?: React.ReactNode;
  /** Page-specific header controls, placed before the shell switchers. */
  actions?: React.ReactNode;
  /**
   * Pins the content column to one theme regardless of the user's choice.
   * For screens whose subject is a 3D canvas that only reads correctly on a
   * dark surface — the chrome stays in the chosen theme, the content does not.
   */
  contentTheme?: Theme;
  children: React.ReactNode;
}

export function AppShell({
  projectName,
  tenantName,
  counts,
  onSwitchProject,
  header,
  actions,
  contentTheme,
  children,
}: AppShellProps): React.JSX.Element {
  const { locale } = usePreferences();

  return (
    <div className="flex min-h-dvh bg-surface">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-50 focus:rounded focus:bg-panel-raised focus:px-3 focus:py-2 focus:text-xs focus:text-ink"
      >
        {t("skipToContent", locale)}
      </a>

      <Sidebar
        counts={counts}
        projectName={projectName}
        tenantName={tenantName}
        onSwitchProject={onSwitchProject}
      />

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex flex-wrap items-end justify-between gap-3 border-b border-edge px-5 py-3.5">
          <div className="min-w-0">{header}</div>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            {actions}
            <LocaleSwitcher />
            <ThemeToggle />
          </div>
        </header>

        <main id="main" data-theme={contentTheme} className="min-w-0 flex-1 bg-surface text-ink">
          {children}
        </main>
      </div>
    </div>
  );
}

export interface PageHeadingProps {
  /** Small uppercase kicker, e.g. the product name. */
  eyebrow?: string;
  title: string;
  /** Identifiers and counts under the title. */
  meta?: React.ReactNode;
  /** Short state word rendered as a pill, e.g. Locked. */
  status?: string;
}

/** The header anatomy all three directions share. */
export function PageHeading({ eyebrow, title, meta, status }: PageHeadingProps): React.JSX.Element {
  return (
    <div className="min-w-0">
      {eyebrow ? (
        <p className="truncate text-xs uppercase tracking-[0.18em] text-primary">{eyebrow}</p>
      ) : null}
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <h1 className="truncate font-display text-[19px] font-semibold leading-tight text-ink">
          {title}
        </h1>
        {status ? (
          <span className="shrink-0 rounded border border-edge bg-panel px-1.5 py-0.5 text-xs font-medium text-ink-dim">
            {status}
          </span>
        ) : null}
      </div>
      {meta ? <p className="mt-0.5 truncate text-xs text-ink-faint">{meta}</p> : null}
    </div>
  );
}
