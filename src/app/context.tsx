import { createContext, useContext, useEffect, useState } from "react";

import type { DaemonApi } from "../api/daemon";
import { deriveAccentScale } from "../lib/tonalPalette";
import { loadStoredString, removeStoredValue, saveStoredString } from "../lib/storage";
import { useLatestRef } from "./useLatest";

export const ApiContext = createContext<DaemonApi | null>(null);

export function useApi(): DaemonApi {
  const api = useContext(ApiContext);
  if (!api) {
    throw new Error("missing api context");
  }
  return api;
}

export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}

type NavigationGuard = (proceed: () => void) => void;

let navigationGuard: NavigationGuard | null = null;

export function navigate(path: string) {
  const go = () => {
    location.hash = `#/${path}`;
  };
  if (navigationGuard) {
    navigationGuard(go);
  } else {
    go();
  }
}

export function useNavigationGuard(active: boolean, onBlock: NavigationGuard) {
  const handler = useLatestRef(onBlock);
  useEffect(() => {
    if (!active) {
      return;
    }
    const guard = (proceed: () => void) => handler.current(proceed);
    navigationGuard = guard;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      if (navigationGuard === guard) {
        navigationGuard = null;
      }
      window.removeEventListener("beforeunload", onBeforeUnload);
    };
  }, [active, handler]);
}

/** Matches the CSS drawer breakpoint (tablets and phones get the drawer). */
const MOBILE_QUERY = "(max-width: 900px)";

/** Phone breakpoint: the drawer gives way to the bottom navigation bar. */
const PHONE_QUERY = "(max-width: 600px)";

export function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState(() => window.matchMedia(MOBILE_QUERY).matches);
  useEffect(() => {
    const media = window.matchMedia(MOBILE_QUERY);
    const onChange = () => setIsMobile(media.matches);
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);
  return isMobile;
}

export function useIsPhone(): boolean {
  const [isPhone, setIsPhone] = useState(() => window.matchMedia(PHONE_QUERY).matches);
  useEffect(() => {
    const media = window.matchMedia(PHONE_QUERY);
    const onChange = () => setIsPhone(media.matches);
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);
  return isPhone;
}

export type ThemePreference = "auto" | "light" | "dark";

const THEME_KEY = "theme";

export function loadThemePreference(): ThemePreference {
  const value = loadStoredString(THEME_KEY);
  if (value === "light" || value === "dark" || value === "auto") {
    return value;
  }
  // The panel defaults to dark.
  return "dark";
}

export function saveThemePreference(preference: ThemePreference) {
  saveStoredString(THEME_KEY, preference);
}

/** Color scheme family: FlClash-style neutral, or one of the alternates. */
export type PalettePreference = "flclash" | "dracula" | "nord" | "catppuccin";

const PALETTE_KEY = "palette";

const PALETTE_VALUES: readonly PalettePreference[] = ["flclash", "dracula", "nord", "catppuccin"];

export function isPalettePreference(value: string): value is PalettePreference {
  return (PALETTE_VALUES as readonly string[]).includes(value);
}

export function loadPalettePreference(): PalettePreference {
  const value = loadStoredString(PALETTE_KEY);
  if (value !== null && isPalettePreference(value)) {
    return value;
  }
  // Migration: a stored theme key marks a pre-palette user, who keeps the
  // original Dracula look. Fresh installs default to the FlClash palette.
  return loadStoredString(THEME_KEY) !== null ? "dracula" : "flclash";
}

export function savePalettePreference(preference: PalettePreference) {
  saveStoredString(PALETTE_KEY, preference);
}

/** Pure-black variant of the dark theme (FlClash "pure black"). */
export function loadAmoledPreference(): boolean {
  return loadStoredString("amoled") === "true";
}

export function saveAmoledPreference(enabled: boolean) {
  saveStoredString("amoled", enabled ? "true" : "false");
}

export function applyTheme(preference: ThemePreference) {
  const dark =
    preference === "dark" ||
    (preference === "auto" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.dataset.theme = dark ? "dark" : "light";

  const surface = getComputedStyle(document.documentElement).getPropertyValue("--surface").trim();
  if (surface) {
    document.querySelectorAll('meta[name="theme-color"]').forEach((meta) => {
      meta.setAttribute("content", surface);
    });
  }

  // iOS 26 Safari ignores theme-color and tints the status bar from the
  // .statusbar-tint probe (see globals.css). It only samples a fixed element
  // when a new node enters the render tree: color changes on a registered
  // element go unnoticed, and removals are dropped too (WebKit bug 300965).
  const tint = document.getElementById("statusbar-tint");
  if (tint) {
    const fresh = tint.cloneNode(true) as HTMLElement;
    tint.replaceWith(fresh);
    const flash = fresh.cloneNode(true) as HTMLElement;
    flash.removeAttribute("id");
    document.body.appendChild(flash);
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        flash.remove();
      });
    });
  }
}

export const ACCENT_PRESETS = [
  "default",
  "blue",
  "purple",
  "pink",
  "red",
  "orange",
  "yellow",
  "green",
  "graphite",
] as const;

export type AccentPreset = (typeof ACCENT_PRESETS)[number];

export type AccentPreference = AccentPreset | (string & {});

export function isAccentPreset(value: string): value is AccentPreset {
  return (ACCENT_PRESETS as readonly string[]).includes(value);
}

export function normalizeAccentColor(value: string): string | null {
  const hex = value.trim().replace(/^#/, "").toLowerCase();
  if (/^[0-9a-f]{3}$/.test(hex)) {
    return `#${hex[0]}${hex[0]}${hex[1]}${hex[1]}${hex[2]}${hex[2]}`;
  }
  if (/^[0-9a-f]{6}$/.test(hex)) {
    return `#${hex}`;
  }
  return null;
}

const ACCENT_KEY = "accent";

export function loadAccentPreference(): AccentPreference {
  const value = loadStoredString(ACCENT_KEY);
  if (!value) {
    return "default";
  }
  if (isAccentPreset(value)) {
    return value;
  }
  return normalizeAccentColor(value) ?? "default";
}

export function saveAccentPreference(preference: AccentPreference) {
  if (preference === "default") {
    removeStoredValue(ACCENT_KEY);
  } else {
    saveStoredString(ACCENT_KEY, preference);
  }
}

export function applyAccent(preference: AccentPreference, dark: boolean) {
  const root = document.documentElement;
  if (isAccentPreset(preference)) {
    root.dataset.accent = preference;
    root.style.removeProperty("--custom-accent");
    root.style.removeProperty("--custom-accent-strong");
    root.style.removeProperty("--custom-accent-soft");
    root.style.removeProperty("--on-accent");
  } else {
    root.dataset.accent = "custom";
    const scale = deriveAccentScale(preference, dark);
    root.style.setProperty("--custom-accent", preference);
    root.style.setProperty("--custom-accent-strong", scale.accentStrong);
    root.style.setProperty("--custom-accent-soft", scale.accentSoft);
    root.style.setProperty("--on-accent", scale.onAccent);
  }
}

/**
 * Applies the whole appearance (palette, contrast variant, resolved theme and
 * accent). One entry point so a system-theme change under "auto" also refreshes
 * the derived custom-accent tokens.
 */
export function applyAppearance(
  theme: ThemePreference,
  accent: AccentPreference,
  palette: PalettePreference = loadPalettePreference(),
  amoled: boolean = loadAmoledPreference(),
) {
  const root = document.documentElement;
  root.dataset.palette = palette;
  root.dataset.amoled = amoled ? "true" : "false";
  const dark =
    theme === "dark" ||
    (theme === "auto" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  applyTheme(theme);
  applyAccent(accent, dark);
}

export function watchSystemTheme(apply: () => void): () => void {
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  const onChange = () => apply();
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}
