import type { Metadata } from "next";
import { LocaleProvider } from "@/components/locale-provider";
import { TooltipProvider } from "@/components/ui/tooltip";
import "./globals.css";

export const metadata: Metadata = {
  title: "ModelShelf",
  description: "Check BIM deliveries against project information requirements.",
};

/**
 * `lang` is switched per user preference once the locale store lands; the UI
 * ships Japanese and English as equals. It matters beyond translation: the
 * `:lang(ja)` rules in globals.css neutralise letter-spacing and text-transform,
 * which are Latin-only devices that do nothing to kanji.
 *
 * `shadcn init` wired Geist here via next/font/google. Removed — it has no CJK
 * coverage and fetches from Google at build time. See globals.css --font-sans.
 */
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja">
      <body>
        <LocaleProvider>
          <TooltipProvider>{children}</TooltipProvider>
        </LocaleProvider>
      </body>
    </html>
  );
}
