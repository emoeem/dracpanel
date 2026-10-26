// @vitest-environment node
import { describe, expect, it } from "vitest";

import {
  deriveAccentScale,
  hexToOklab,
  oklabToHex,
  relativeLuminance,
} from "./tonalPalette";

function parseHex(hex: string): [number, number, number] {
  return [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ];
}

describe("oklab conversion", () => {
  it("round-trips in-gamut sRGB colors within a small tolerance", () => {
    const samples = ["#ff8d28", "#007aff", "#bd93f9", "#34c759", "#1a1a1a", "#f8f8f2"];
    for (const hex of samples) {
      const roundTrip = oklabToHex(hexToOklab(hex));
      const [r1, g1, b1] = parseHex(hex);
      const [r2, g2, b2] = parseHex(roundTrip);
      expect(Math.abs(r1 - r2)).toBeLessThanOrEqual(2);
      expect(Math.abs(g1 - g2)).toBeLessThanOrEqual(2);
      expect(Math.abs(b1 - b2)).toBeLessThanOrEqual(2);
    }
  });

  it("keeps perceived lightness ordering", () => {
    expect(hexToOklab("#000000").l).toBeLessThan(hexToOklab("#808080").l);
    expect(hexToOklab("#808080").l).toBeLessThan(hexToOklab("#ffffff").l);
  });
});

describe("relativeLuminance", () => {
  it("matches the WCAG anchors", () => {
    expect(relativeLuminance("#000000")).toBeCloseTo(0, 5);
    expect(relativeLuminance("#ffffff")).toBeCloseTo(1, 5);
  });
});

describe("deriveAccentScale", () => {
  it("produces parseable hex tokens in both modes", () => {
    for (const dark of [false, true]) {
      const scale = deriveAccentScale("#ff8d28", dark);
      for (const token of [scale.accent, scale.accentStrong]) {
        expect(token).toMatch(/^#[0-9a-f]{6}$/);
      }
      expect(scale.accentSoft).toMatch(/^rgb\(\d+ \d+ \d+ \/ \d+%\)$/);
    }
  });

  it("lightens dark-mode accents and keeps on-accent readable", () => {
    const scale = deriveAccentScale("#ff8d28", true);
    expect(hexToOklab(scale.accent).l).toBeGreaterThanOrEqual(hexToOklab("#ff8d28").l);
    expect(scale.onAccent).toBe("#1a1a1a");
  });

  it("darkens light-mode accents from a very light seed", () => {
    const scale = deriveAccentScale("#ffcc00", false);
    expect(hexToOklab(scale.accent).l).toBeLessThanOrEqual(0.56);
    // The gamut-clamped tone is a dark olive; near-white text wins the
    // contrast comparison there.
    expect(scale.onAccent).toBe("#ffffff");
  });

  it("returns white on-accent for dark seeds", () => {
    const scale = deriveAccentScale("#101040", false);
    expect(scale.onAccent).toBe("#ffffff");
  });

  it("keeps the hue family of the seed", () => {
    const orange = hexToOklab("#ff8d28");
    const derived = hexToOklab(deriveAccentScale("#ff8d28", true).accent);
    const hueA = Math.atan2(orange.b, orange.a);
    const hueB = Math.atan2(derived.b, derived.a);
    const drift = Math.abs(hueA - hueB);
    expect(Math.min(drift, Math.abs(drift - Math.PI * 2))).toBeLessThan(0.35);
  });
});
