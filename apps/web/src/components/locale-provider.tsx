"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { DEFAULT_LOCALE, type Locale } from "@/lib/i18n";

const STORAGE_KEY = "modelshelf-locale";

interface LocaleContextValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
}

const LocaleContext = createContext<LocaleContextValue | null>(null);

export function LocaleProvider({ children }: { readonly children: React.ReactNode }): React.JSX.Element {
  const [locale, setLocale] = useState<Locale>(DEFAULT_LOCALE);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === "ja" || stored === "en") setLocale(stored);
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    document.documentElement.lang = locale;
    document.cookie = `${STORAGE_KEY}=${locale}; Path=/; Max-Age=31536000; SameSite=Lax`;
    window.localStorage.setItem(STORAGE_KEY, locale);
  }, [hydrated, locale]);

  const value = useMemo(() => ({ locale, setLocale }), [locale]);
  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export function useLocale(): LocaleContextValue {
  const value = useContext(LocaleContext);
  if (value === null) throw new Error("useLocale must be used within LocaleProvider");
  return value;
}
