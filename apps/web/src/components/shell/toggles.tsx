"use client";

// The JA/EN switcher and the light/dark toggle. Every concept header carries
// both, so they are shell furniture rather than page controls.
//
// Both render as segmented controls: two visible options with the active one
// pressed. A single button that only shows the *other* state is smaller but
// ambiguous — in a bilingual UI especially, "EN" alone reads as either the
// current language or the one on offer.

import { LOCALES, LOCALE_NATIVE_LABEL, t } from "@/lib/i18n";
import { Icon } from "./icons";
import { usePreferences, type Theme } from "./preferences";

const GROUP = "inline-flex items-center gap-0.5 rounded-md border border-edge bg-panel p-0.5";

function segment(active: boolean): string {
  return [
    "cursor-pointer rounded px-2 py-1 text-xs font-medium tracking-wide transition-colors",
    active ? "bg-accent-soft text-primary" : "text-ink-faint hover:text-ink-dim",
  ].join(" ");
}

export function LocaleSwitcher(): React.JSX.Element {
  const { locale, setLocale } = usePreferences();
  return (
    <div className={GROUP} role="group" aria-label={t("language", locale)}>
      {LOCALES.map((option) => (
        <button
          key={option}
          type="button"
          onClick={() => setLocale(option)}
          aria-pressed={locale === option}
          // The label is in the language it selects, so announce it in that
          // language too rather than inheriting the page's.
          lang={option}
          className={segment(locale === option)}
        >
          {LOCALE_NATIVE_LABEL[option]}
        </button>
      ))}
    </div>
  );
}

const THEMES: readonly { value: Theme; icon: "sun" | "moon"; label: "themeLight" | "themeDark"; hint: "useLightTheme" | "useDarkTheme" }[] = [
  { value: "light", icon: "sun", label: "themeLight", hint: "useLightTheme" },
  { value: "dark", icon: "moon", label: "themeDark", hint: "useDarkTheme" },
];

export function ThemeToggle({ showLabels = true }: { showLabels?: boolean }): React.JSX.Element {
  const { locale, theme, setTheme } = usePreferences();
  return (
    <div className={GROUP} role="group" aria-label={t("theme", locale)}>
      {THEMES.map((option) => (
        <button
          key={option.value}
          type="button"
          onClick={() => setTheme(option.value)}
          aria-pressed={theme === option.value}
          aria-label={showLabels ? undefined : t(option.hint, locale)}
          title={showLabels ? undefined : t(option.hint, locale)}
          className={`${segment(theme === option.value)} inline-flex items-center gap-1.5`}
        >
          <Icon name={option.icon} />
          {showLabels ? t(option.label, locale) : null}
        </button>
      ))}
    </div>
  );
}
