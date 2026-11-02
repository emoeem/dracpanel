import { describe, expect, it } from "vitest";

import { attribution, statusChips } from "./statusChips";

const base = {
  ip: "103.172.182.27",
  ipType: "",
  ipQuality: null,
  geoLocation: "SG · Singapore",
  egressConfigured: true,
};

describe("statusChips", () => {
  it("falls back to the GeoIP location when type/quality are absent", () => {
    expect(statusChips(base)).toEqual([{ kind: "text", text: "SG · Singapore" }]);
  });

  it("shows provided type and quality chips", () => {
    expect(statusChips({ ...base, ipType: "机房", ipQuality: "普通" })).toEqual([
      { kind: "text", text: "机房" },
      { kind: "message", key: "Quality {quality}", params: { quality: "普通" } },
    ]);
    expect(statusChips({ ...base, ipType: "住宅" })).toEqual([{ kind: "text", text: "住宅" }]);
    expect(statusChips({ ...base, ipQuality: "优质" })).toEqual([
      { kind: "message", key: "Quality {quality}", params: { quality: "优质" } },
    ]);
  });

  it("explains the configuration when no probe source exists", () => {
    expect(statusChips({ ...base, ip: "", egressConfigured: false })).toEqual([
      { kind: "message", key: "Configure an egress probe URL in panel.json" },
    ]);
  });

  it("says probing when configured but no IP has arrived yet", () => {
    expect(statusChips({ ...base, ip: null })).toEqual([{ kind: "message", key: "Pending probe" }]);
  });

  it("returns nothing rather than unknown placeholders", () => {
    expect(statusChips({ ...base, ipType: "", ipQuality: null, geoLocation: "" })).toEqual([]);
  });
});

describe("attribution", () => {
  it("prefers the organization when GeoIP provides one", () => {
    expect(attribution("AS13335 Cloudflare", "SG · Singapore")).toBe("AS13335 Cloudflare");
  });

  it("falls back to the location", () => {
    expect(attribution("—", "SG · Singapore")).toBe("SG · Singapore");
    expect(attribution("", "SG · Singapore")).toBe("SG · Singapore");
  });

  it("stays a dash without any data", () => {
    expect(attribution("", "")).toBe("—");
  });
});
