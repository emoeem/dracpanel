import { describe, expect, it } from "vitest";

import { countryCodeOf, flagEmoji, flagOfText } from "./country";

describe("countryCodeOf", () => {
  it("passes through alpha-2 codes", () => {
    expect(countryCodeOf("JP")).toBe("JP");
    expect(countryCodeOf("us")).toBe("US");
  });

  it("maps common country names in English and Chinese", () => {
    expect(countryCodeOf("Hong Kong")).toBe("HK");
    expect(countryCodeOf("United States")).toBe("US");
    expect(countryCodeOf("日本")).toBe("JP");
    expect(countryCodeOf("新加坡")).toBe("SG");
  });

  it("returns null for unknown values", () => {
    expect(countryCodeOf("Narnia")).toBeNull();
    expect(countryCodeOf(null)).toBeNull();
    expect(countryCodeOf("")).toBeNull();
  });
});

describe("flagEmoji", () => {
  it("builds regional indicators", () => {
    expect(flagEmoji("JP")).toBe("🇯🇵");
    expect(flagEmoji("us")).toBe("🇺🇸");
  });

  it("rejects invalid codes", () => {
    expect(flagEmoji("JPN")).toBe("");
    expect(flagEmoji("")).toBe("");
  });
});

describe("flagOfText", () => {
  it("keeps an existing flag emoji", () => {
    expect(flagOfText("🇭🇰 IEPL 01")).toBe("🇭🇰");
  });

  it("derives a flag from a country word", () => {
    expect(flagOfText("Tokyo Node")).toBe("🇯🇵");
    expect(flagOfText("洛杉矶 01")).toBe("🇺🇸");
  });

  it("returns empty when nothing matches", () => {
    expect(flagOfText("HomeLab")).toBe("");
  });
});
