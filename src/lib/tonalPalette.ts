/**
 * M3-style tonal accent derivation from a seed color.
 *
 * FlClash generates its Material 3 color schemes from a single seed with the
 * material_color_utilities HCT model. This module reimplements the small part
 * the panel needs — an accent ramp (accent / accent-strong / soft container /
 * on-accent) — on top of OKLab, which is close enough perceptually for UI
 * accents and keeps the panel dependency-free.
 */

export interface AccentScale {
  /** Main accent color as #rrggbb. */
  accent: string;
  /** Emphasis/hover variant as #rrggbb (lighter in dark mode, darker in light). */
  accentStrong: string;
  /** Translucent container color, e.g. "rgb(247 141 40 / 18%)". */
  accentSoft: string;
  /** Readable foreground on top of `accent`. */
  onAccent: string;
}

export interface OkLab {
  l: number;
  a: number;
  b: number;
}

// sRGB transfer functions.
function srgbToLinear(channel: number): number {
  return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
}

function linearToSrgb(channel: number): number {
  return channel <= 0.0031308 ? channel * 12.92 : 1.055 * channel ** (1 / 2.4) - 0.055;
}

export function hexToOklab(hex: string): OkLab {
  const value = hex.replace("#", "");
  const r = srgbToLinear(parseInt(value.slice(0, 2), 16) / 255);
  const g = srgbToLinear(parseInt(value.slice(2, 4), 16) / 255);
  const b = srgbToLinear(parseInt(value.slice(4, 6), 16) / 255);

  const l = 0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b;
  const m = 0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b;
  const s = 0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b;
  const l_ = Math.cbrt(l);
  const m_ = Math.cbrt(m);
  const s_ = Math.cbrt(s);

  return {
    l: 0.2104542553 * l_ + 0.793617785 * m_ - 0.0040720468 * s_,
    a: 1.9779984951 * l_ - 2.428592205 * m_ + 0.4505937099 * s_,
    b: 0.0259040371 * l_ + 0.7827717662 * m_ - 0.808675766 * s_,
  };
}

export function oklabToHex(lab: OkLab): string {
  const l_ = lab.l + 0.3963377774 * lab.a + 0.2158037573 * lab.b;
  const m_ = lab.l - 0.1055613458 * lab.a - 0.0638541728 * lab.b;
  const s_ = lab.l - 0.0894841775 * lab.a - 1.291485548 * lab.b;
  const l = l_ ** 3;
  const m = m_ ** 3;
  const s = s_ ** 3;

  const r = +4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
  const g = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
  const b = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s;

  const channels = [r, g, b].map((channel) => {
    const clamped = Math.min(Math.max(channel, 0), 1);
    return Math.round(Math.min(Math.max(linearToSrgb(clamped), 0), 1) * 255);
  });
  const [rr, gg, bb] = channels;
  return `#${[rr, gg, bb].map((c) => c.toString(16).padStart(2, "0")).join("")}`;
}

/** Relative luminance (WCAG) of a #rrggbb color. */
export function relativeLuminance(hex: string): number {
  const value = hex.replace("#", "");
  const channel = (index: number) =>
    srgbToLinear(parseInt(value.slice(index, index + 2), 16) / 255);
  return 0.2126 * channel(0) + 0.7152 * channel(2) + 0.0722 * channel(4);
}

/** Pick the more readable of dark/near-white foregrounds for a background. */
function pickOnAccent(background: string): string {
  const luminance = relativeLuminance(background);
  const contrastDark = (luminance + 0.05) / 0.0604; // vs #1a1a1a
  const contrastWhite = 1.05 / (luminance + 0.05);
  return contrastDark >= contrastWhite ? "#1a1a1a" : "#ffffff";
}

function clampChromaToGamut(lab: OkLab): OkLab {
  const { l, a, b } = lab;
  for (let chroma = 1; chroma >= 0; chroma -= 0.02) {
    const candidate = { l, a: a * chroma, b: b * chroma };
    const hex = oklabToHex(candidate);
    // oklabToHex clamps out-of-gamut channels; detect clipping by round-tripping.
    const roundTrip = hexToOklab(hex);
    const drift =
      Math.abs(roundTrip.l - candidate.l) +
      Math.abs(roundTrip.a - candidate.a) +
      Math.abs(roundTrip.b - candidate.b);
    if (drift < 0.004) {
      return candidate;
    }
  }
  return { l, a: 0, b: 0 };
}

function withLightness(seed: OkLab, targetL: number, chromaBoost = 1): OkLab {
  const chroma = Math.hypot(seed.a, seed.b) * chromaBoost;
  const hue = Math.atan2(seed.b, seed.a);
  return clampChromaToGamut({
    l: targetL,
    a: Math.cos(hue) * chroma,
    b: Math.sin(hue) * chroma,
  });
}

function soft(seed: OkLab, alphaPercent: number): string {
  const hex = oklabToHex(seed);
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgb(${r} ${g} ${b} / ${alphaPercent}%)`;
}

/**
 * Derive the panel's four accent tokens from a seed color.
 *
 * `dark` raises the accent toward M3's tone-80 territory; light mode anchors it
 * near tone-40 so text on light surfaces keeps contrast.
 */
export function deriveAccentScale(seedHex: string, dark: boolean): AccentScale {
  const seed = hexToOklab(seedHex);
  if (dark) {
    const accent = withLightness(seed, Math.max(seed.l, 0.78));
    const accentStrong = withLightness(seed, Math.max(seed.l, 0.78) + 0.09);
    const accentHex = oklabToHex(accent);
    return {
      accent: accentHex,
      accentStrong: oklabToHex(accentStrong),
      accentSoft: soft(seed, 18),
      onAccent: pickOnAccent(accentHex),
    };
  }
  const accent = withLightness(seed, Math.min(seed.l, 0.55));
  const accentStrong = withLightness(seed, Math.min(seed.l, 0.55) - 0.09);
  const accentHex = oklabToHex(accent);
  return {
    accent: accentHex,
    accentStrong: oklabToHex(accentStrong),
    accentSoft: soft(seed, 13),
    onAccent: pickOnAccent(accentHex),
  };
}
