// The navigation model, shared by all three design directions.
//
// Sections and order come from the concept sidebar: review work first, the
// models it draws on second, configuration last. Keeping this as data means a
// direction can render it as a labelled column or a collapsed icon rail
// without either one owning the structure.

import type { StringKey } from "@/lib/i18n";
import type { IconName } from "./icons";

/** Which live count decorates an item, if any. */
export type CountKey = "deliveries" | "findings";

export type NavCounts = Partial<Record<CountKey, number>>;

export interface NavItem {
  key: StringKey;
  icon: IconName;
  href: string;
  count?: CountKey;
  /**
   * False while the route has no page yet. Not-ready items still render — the
   * sidebar is the map of the product, and hiding them would misrepresent it —
   * but they are inert rather than 404s. Flip to true when the page lands.
   */
  ready: boolean;
}

export interface NavSection {
  key: StringKey;
  items: readonly NavItem[];
}

export const NAV_SECTIONS: readonly NavSection[] = [
  {
    key: "sectionReview",
    items: [
      { key: "navDashboard", icon: "dashboard", href: "/", ready: true },
      { key: "navDeliveries", icon: "deliveries", href: "/deliveries", count: "deliveries", ready: false },
      { key: "navRunCheck", icon: "runCheck", href: "/checks/new", ready: false },
      { key: "navFindings", icon: "findings", href: "/findings", count: "findings", ready: false },
    ],
  },
  {
    key: "sectionModels",
    items: [
      { key: "navSourceModels", icon: "sourceModels", href: "/models", ready: false },
      { key: "navDiff", icon: "diff", href: "/diff", ready: false },
      { key: "navSavedViews", icon: "savedViews", href: "/views", ready: false },
    ],
  },
  {
    key: "sectionSettings",
    items: [
      { key: "navCheckPacks", icon: "checkPacks", href: "/packs", ready: false },
      { key: "navMembers", icon: "members", href: "/members", ready: false },
      { key: "navProjectSettings", icon: "projectSettings", href: "/settings", ready: false },
    ],
  },
] as const;

/**
 * Active when the path is the item's route or a child of it. "/" only matches
 * exactly, otherwise it would light up on every page.
 */
export function isActive(href: string, pathname: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}
