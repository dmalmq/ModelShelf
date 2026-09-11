import type { Metadata, Viewport } from "next";
import { LocaleProvider } from "@/components/locale-provider";
import { PreferencesProvider, SSR_THEME, THEME_INIT_SCRIPT } from "@/components/shell/preferences";
import { TooltipProvider } from "@/components/ui/tooltip";
import { DEFAULT_LOCALE } from "@/lib/i18n";
import "./globals.css";

export const metadata: Metadata = {
  title: "ModelShelf",
  description: "Check BIM deliveries against project information requirements.",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f2f2f0" },
    { media: "(prefers-color-scheme: dark)", color: "#0b0b0d" },
  ],
};

/**
 * `lang` is switched per user preference; the UI ships Japanese and English as
 * equals. It matters beyond translation: the `:lang(ja)` rules in globals.css
 * neutralise letter-spacing and text-transform, which are Latin-only devices
 * that do nothing to kanji.
 *
 * `shadcn init` wired Geist here via next/font/google. Kept off — it has no CJK
 * coverage and fetches from Google at build time. See globals.css --ms-font-sans.
 *
 * Theme is corrected before first paint by the inline script, which is why
 * <html> opts out of hydration warnings: the server cannot know a returning
 * visitor's stored preference.
 */
export default function RootLayout({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <html lang={DEFAULT_LOCALE} data-theme={SSR_THEME} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      {/* suppressHydrationWarning: extensions (e.g. ColorZilla's cz-shortcut-listen) */}
      {/* mutate <body> before React loads; not a server/client bug. */}
      <body suppressHydrationWarning>
        <PreferencesProvider>
          <LocaleProvider>
            <TooltipProvider>{children}</TooltipProvider>
          </LocaleProvider>
        </PreferencesProvider>
      </body>
    </html>
  );
}
