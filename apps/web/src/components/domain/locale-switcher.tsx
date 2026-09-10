"use client";

import { Button } from "@/components/ui/button";
import { LOCALE_GROUP_LABEL, LOCALE_LABEL, type Locale } from "@/lib/i18n";
import { useLocale } from "../locale-provider";

const LOCALES: readonly Locale[] = ["ja", "en"];

export function LocaleSwitcher(): React.JSX.Element {
  const { locale, setLocale } = useLocale();
  return (
    <div className="flex min-h-11 items-center gap-1" role="group" aria-label={LOCALE_GROUP_LABEL[locale]}>
      {LOCALES.map((candidate) => (
        <Button
          key={candidate}
          type="button"
          variant={candidate === locale ? "secondary" : "ghost"}
          size="sm"
          aria-pressed={candidate === locale}
          data-locale={candidate}
          onClick={() => setLocale(candidate)}
        >
          {LOCALE_LABEL[locale][candidate]}
        </Button>
      ))}
    </div>
  );
}
