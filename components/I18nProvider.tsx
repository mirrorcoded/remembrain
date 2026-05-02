"use client";

import {
  getBrowserLocale,
  normalizeUserLocale,
  translate,
  type UiLocale,
} from "@/lib/i18n";

const UI_LOCALE_STORAGE_KEY = "remembrain_ui_locale";

function readStoredLocale(): UiLocale | null {
  if (typeof window === "undefined") {
    return null;
  }
  try {
    const raw = window.localStorage.getItem(UI_LOCALE_STORAGE_KEY);
    if (raw === "ko" || raw === "en") {
      return raw;
    }
  } catch {
    /* ignore */
  }
  return null;
}

function writeStoredLocale(locale: UiLocale): void {
  try {
    window.localStorage.setItem(UI_LOCALE_STORAGE_KEY, locale);
  } catch {
    /* ignore */
  }
}
import { supabase } from "@/lib/supabase";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

type I18nContextValue = {
  locale: UiLocale;
  /** Persist to Supabase user_metadata.ui_locale and update context immediately. */
  setUiLocale: (next: UiLocale) => Promise<void>;
  t: (path: string, vars?: Record<string, string | number>) => string;
};

const I18nContext = createContext<I18nContextValue | null>(null);

function interpolate(template: string, vars?: Record<string, string | number>): string {
  if (!vars) {
    return template;
  }
  return template.replace(/\{(\w+)\}/g, (_, key: string) => {
    const v = vars[key];
    return v !== undefined ? String(v) : `{${key}}`;
  });
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocale] = useState<UiLocale>(() => {
    const stored = readStoredLocale();
    return stored ?? getBrowserLocale();
  });

  const syncFromSession = useCallback(() => {
    void supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user) {
        const raw = session.user.user_metadata?.ui_locale;
        if (raw !== undefined && raw !== null) {
          setLocale(normalizeUserLocale(raw));
          return;
        }
        setLocale(getBrowserLocale());
        return;
      }
      setLocale(readStoredLocale() ?? getBrowserLocale());
    });
  }, []);

  useEffect(() => {
    syncFromSession();
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.user) {
        const raw = session.user.user_metadata?.ui_locale;
        if (raw !== undefined && raw !== null) {
          setLocale(normalizeUserLocale(raw));
        } else {
          setLocale(getBrowserLocale());
        }
      } else {
        setLocale(readStoredLocale() ?? getBrowserLocale());
      }
    });
    return () => subscription.unsubscribe();
  }, [syncFromSession]);

  useEffect(() => {
    if (typeof document !== "undefined") {
      document.documentElement.lang = locale === "ko" ? "ko" : "en";
    }
  }, [locale]);

  const setUiLocale = useCallback(async (next: UiLocale) => {
    setLocale(next);
    writeStoredLocale(next);
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session?.user) {
      return;
    }
    await supabase.auth.updateUser({
      data: { ui_locale: next },
    });
  }, []);

  const t = useCallback(
    (path: string, vars?: Record<string, string | number>) => {
      return interpolate(translate(locale, path), vars);
    },
    [locale],
  );

  const value = useMemo(
    () => ({ locale, setUiLocale, t }),
    [locale, setUiLocale, t],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) {
    throw new Error("useI18n must be used within I18nProvider");
  }
  return ctx;
}

/** Read-only i18n for components that may render outside provider (should not happen). */
export function useI18nOptional(): I18nContextValue | null {
  return useContext(I18nContext);
}
