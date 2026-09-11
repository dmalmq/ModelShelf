"use client";

// Locale, theme and sidebar state for the whole app shell.
//
// The source of truth for theme and locale is the DOM: `data-theme` and `lang`
// on <html>. The inline script in the root layout sets both before first paint
// (see THEME_INIT_SCRIPT), so there is no flash of the wrong theme and no
// server/client divergence to reconcile — this provider adopts whatever the
// script decided, then owns it from there.

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { DEFAULT_LOCALE, LOCALES, LOCALE_TAG, type Locale } from "@/lib/i18n";

export type Theme = "light" | "dark";

/** localStorage keys. Shared with THEME_INIT_SCRIPT so they cannot drift. */
export const STORAGE_KEY = {
  locale: "modelshelf.locale",
  theme: "modelshelf.theme",
  sidebar: "modelshelf.sidebarCollapsed",
} as const;

/**
 * What the server renders into <html data-theme>. The init script below almost
 * always replaces it — with the stored preference, or the OS setting for a
 * first-time visitor — so this only has to be a defensible default for the
 * case where scripts never run at all. Light, because the model plate is white
 * and the review desk is the Light artboard.
 */
export const SSR_THEME: Theme = "light";

/**
 * Runs synchronously in <head>. Reads the stored preference, falls back to the
 * OS setting, and writes the result onto <html> before the first paint.
 * Wrapped in try/catch because localStorage throws in some privacy modes.
 */
export const THEME_INIT_SCRIPT = `(function(){try{
var d=document.documentElement;
var t=localStorage.getItem(${JSON.stringify(STORAGE_KEY.theme)});
if(t!=="light"&&t!=="dark"){t=window.matchMedia("(prefers-color-scheme: light)").matches?"light":"dark";}
d.dataset.theme=t;
var l=localStorage.getItem(${JSON.stringify(STORAGE_KEY.locale)});
if(l==="ja"||l==="en"){d.lang=l;}
if(localStorage.getItem(${JSON.stringify(STORAGE_KEY.sidebar)})==="1"){d.dataset.sidebar="collapsed";}
}catch(e){}})();`;

interface Preferences {
  locale: Locale;
  theme: Theme;
  sidebarCollapsed: boolean;
  setLocale: (locale: Locale) => void;
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
  toggleSidebar: () => void;
}

const PreferencesContext = createContext<Preferences | null>(null);

function isLocale(value: unknown): value is Locale {
  return LOCALES.includes(value as Locale);
}

export function PreferencesProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  // Seeded with the same values the server rendered, then reconciled from the
  // DOM on mount. One effect, no mismatch.
  const [locale, setLocaleState] = useState<Locale>(DEFAULT_LOCALE);
  const [theme, setThemeState] = useState<Theme>(SSR_THEME);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  useEffect(() => {
    const root = document.documentElement;
    setThemeState(root.dataset.theme === "light" ? "light" : "dark");
    if (isLocale(root.lang)) setLocaleState(root.lang);
    setSidebarCollapsed(root.dataset.sidebar === "collapsed");
  }, []);

  const setTheme = useCallback((next: Theme) => {
    setThemeState(next);
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem(STORAGE_KEY.theme, next);
    } catch {
      /* storage unavailable — the choice still applies for this session */
    }
  }, []);

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next);
    // `lang` drives :lang(ja) typography in globals.css as well as screen
    // reader pronunciation, so it has to move with the switcher.
    document.documentElement.lang = next;
    try {
      localStorage.setItem(STORAGE_KEY.locale, next);
    } catch {
      /* storage unavailable */
    }
  }, []);

  const toggleTheme = useCallback(() => {
    setTheme(theme === "dark" ? "light" : "dark");
  }, [setTheme, theme]);

  const toggleSidebar = useCallback(() => {
    const next = !sidebarCollapsed;
    setSidebarCollapsed(next);
    if (next) document.documentElement.dataset.sidebar = "collapsed";
    else delete document.documentElement.dataset.sidebar;
    try {
      localStorage.setItem(STORAGE_KEY.sidebar, next ? "1" : "0");
    } catch {
      /* storage unavailable */
    }
  }, [sidebarCollapsed]);

  const value = useMemo<Preferences>(
    () => ({ locale, theme, sidebarCollapsed, setLocale, setTheme, toggleTheme, toggleSidebar }),
    [locale, theme, sidebarCollapsed, setLocale, setTheme, toggleTheme, toggleSidebar],
  );

  return <PreferencesContext.Provider value={value}>{children}</PreferencesContext.Provider>;
}

export function usePreferences(): Preferences {
  const value = useContext(PreferencesContext);
  if (!value) throw new Error("usePreferences must be used inside <PreferencesProvider>");
  return value;
}

/** Intl tag for the active locale — for Intl.NumberFormat / DateTimeFormat. */
export function useLocaleTag(): string {
  return LOCALE_TAG[usePreferences().locale];
}
