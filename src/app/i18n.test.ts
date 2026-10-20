// @vitest-environment jsdom

/**
 * Two regressions worth guarding: raw backend errors are passed to `t()` as if
 * they were message keys and must survive untouched, and a half-translated
 * entry (missing language, empty string, mismatched placeholder) only shows up
 * in a language most of the team does not read.
 */
import { cleanup, renderHook } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { I18nProvider, useI18n } from "./i18n";
import {
  LANGUAGES,
  TRANSLATIONS,
  type MessageKey,
  type PluralForms,
  type TranslatedLanguage,
} from "./translations";
import type { LanguagePreference } from "./i18nCore";

const STORAGE_PREFIX = "sing-box-dashboard.";
const TRANSLATED_LANGUAGES = LANGUAGES.filter((entry) => entry.value !== "en").map(
  (entry) => entry.value as TranslatedLanguage,
);
/** `{count}` and `{count, plural, …}` both name the same placeholder. */
const PLACEHOLDER = /\{([A-Za-z_][A-Za-z0-9_]*)[,}]/g;

function placeholders(text: string): string[] {
  return [...text.matchAll(PLACEHOLDER)].map((match) => match[1]).sort();
}

function forms(value: string | PluralForms): string[] {
  return typeof value === "string" ? [value] : Object.values(value);
}

function renderTranslator(preference: LanguagePreference) {
  if (preference === "auto") {
    localStorage.removeItem(`${STORAGE_PREFIX}language`);
  } else {
    localStorage.setItem(`${STORAGE_PREFIX}language`, preference);
  }
  const view = renderHook(() => useI18n(), {
    wrapper: ({ children }: { children: ReactNode }) => createElement(I18nProvider, null, children),
  });
  return view.result.current;
}

describe("translate", () => {
  beforeAll(() => {
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  });

  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(cleanup);

  it("returns an unknown key verbatim so raw error text stays readable", () => {
    const { t } = renderTranslator("en");
    const unknown: string = "failed to dial remote: unexpected EOF";
    expect(t(unknown as MessageKey)).toBe(unknown);
  });

  it("keeps an unknown key verbatim for translated languages too", () => {
    const { language, t } = renderTranslator("zh-Hans");
    expect(language).toBe("zh-Hans");
    const unknown: string = "failed to dial remote: unexpected EOF";
    expect(t(unknown as MessageKey, { count: 2 })).toBe(unknown);
    // Sanity check: the provider is really translating, not echoing everything.
    expect(t("Overview")).toBe("概览");
  });
});

describe("TRANSLATIONS", () => {
  it("fills all four languages of every key with a non-empty string", () => {
    const problems: string[] = [];
    for (const [key, entry] of Object.entries(TRANSLATIONS)) {
      const record = entry as Record<TranslatedLanguage, string | PluralForms>;
      for (const language of TRANSLATED_LANGUAGES) {
        const value = record[language];
        if (value === undefined) {
          problems.push(`${key} [${language}]: missing`);
          continue;
        }
        for (const text of forms(value)) {
          if (text.trim() === "") {
            problems.push(`${key} [${language}]: empty`);
          }
        }
      }
    }
    expect(problems).toEqual([]);
  });

  it("keeps the placeholders of the source string in every translation", () => {
    const problems: string[] = [];
    for (const [key, entry] of Object.entries(TRANSLATIONS)) {
      const expected = placeholders(key).join(",");
      const record = entry as Record<TranslatedLanguage, string | PluralForms>;
      for (const language of TRANSLATED_LANGUAGES) {
        for (const text of forms(record[language])) {
          const found = placeholders(text).join(",");
          if (found !== expected) {
            problems.push(`${key} [${language}]: "${found}" instead of "${expected}"`);
          }
        }
      }
    }
    expect(problems).toEqual([]);
  });
});
