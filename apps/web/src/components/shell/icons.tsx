// Inline 16px stroke icons for the sidebar rail. Inline rather than a package
// because the collapsed rail is the only place icons carry meaning on their
// own, and the set is small enough that a dependency would cost more than it
// saves. `currentColor` throughout so they inherit the nav item's ink.

export type IconName =
  | "dashboard"
  | "deliveries"
  | "runCheck"
  | "findings"
  | "sourceModels"
  | "diff"
  | "savedViews"
  | "checkPacks"
  | "members"
  | "projectSettings"
  | "chevronDown"
  | "chevronRight"
  | "panelCollapse"
  | "sun"
  | "moon"
  | "help";

const PATHS: Record<IconName, React.ReactNode> = {
  dashboard: <><rect x="2" y="2" width="5.5" height="5.5" rx="1" /><rect x="10.5" y="2" width="5.5" height="5.5" rx="1" /><rect x="2" y="10.5" width="5.5" height="5.5" rx="1" /><rect x="10.5" y="10.5" width="5.5" height="5.5" rx="1" /></>,
  deliveries: <><path d="M2.5 5.5 9 2l6.5 3.5v7L9 16l-6.5-3.5v-7Z" /><path d="M2.5 5.5 9 9l6.5-3.5M9 9v7" /></>,
  runCheck: <><circle cx="9" cy="9" r="6.75" /><path d="M7.25 6.25 11.75 9l-4.5 2.75V6.25Z" /></>,
  findings: <><path d="M9 2.25 16.25 15H1.75L9 2.25Z" /><path d="M9 7v3.5M9 12.75v.5" /></>,
  sourceModels: <><path d="M2.5 4.5 9 1.75l6.5 2.75L9 7.25 2.5 4.5Z" /><path d="M2.5 9 9 11.75 15.5 9M2.5 13.5 9 16.25 15.5 13.5" /></>,
  diff: <><path d="M5 2.5v9M13 6.5v9" /><circle cx="5" cy="13.5" r="2" /><circle cx="13" cy="4.5" r="2" /><path d="M7 4.5h4" /></>,
  savedViews: <><path d="M4.5 2.25h9v13.5L9 12.5l-4.5 3.25V2.25Z" /></>,
  checkPacks: <><rect x="2.25" y="3.5" width="13.5" height="11" rx="1.5" /><path d="M2.25 7h13.5M6.25 10.25l1.75 1.75 3.5-3.5" /></>,
  members: <><circle cx="6.75" cy="6.5" r="2.75" /><path d="M2 15.25c0-2.35 2.13-4.25 4.75-4.25s4.75 1.9 4.75 4.25" /><path d="M12 4.25a2.75 2.75 0 0 1 0 5.25M13 15.25c0-1.6-.5-2.9-1.4-3.85" /></>,
  projectSettings: <><circle cx="9" cy="9" r="2.5" /><path d="M9 1.75v2M9 14.25v2M2.75 9h2M13.25 9h2M4.6 4.6l1.4 1.4M12 12l1.4 1.4M13.4 4.6 12 6M6 12l-1.4 1.4" /></>,
  chevronDown: <path d="m4.5 7 4.5 4.5L13.5 7" />,
  chevronRight: <path d="m7 4.5 4.5 4.5L7 13.5" />,
  panelCollapse: <><rect x="2.25" y="2.75" width="13.5" height="12.5" rx="1.5" /><path d="M7 2.75v12.5" /><path d="m12.5 7 -2 2 2 2" /></>,
  sun: <><circle cx="9" cy="9" r="3.25" /><path d="M9 1.5v2M9 14.5v2M1.5 9h2M14.5 9h2M3.7 3.7l1.4 1.4M12.9 12.9l1.4 1.4M14.3 3.7l-1.4 1.4M5.1 12.9l-1.4 1.4" /></>,
  moon: <path d="M14.5 10.9A6.25 6.25 0 0 1 7.1 3.5a6.25 6.25 0 1 0 7.4 7.4Z" />,
  help: <><circle cx="9" cy="9" r="6.75" /><path d="M6.9 6.9a2.1 2.1 0 1 1 2.1 2.6v1M9 12.9v.4" /></>,
};

interface IconProps {
  name: IconName;
  className?: string;
}

/**
 * Always decorative: every place an icon appears, a text label or an
 * aria-label sits alongside it, so it is hidden from assistive tech.
 */
export function Icon({ name, className }: IconProps): React.JSX.Element {
  return (
    <svg
      viewBox="0 0 18 18"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.35"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={className}
    >
      {PATHS[name]}
    </svg>
  );
}
