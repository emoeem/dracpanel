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
    expect(statusChips(base)).toEqual(["SG · Singapore"]);
  });

  it("shows provided type and quality chips", () => {
    expect(statusChips({ ...base, ipType: "机房", ipQuality: "普通" })).toEqual([
      "机房",
      "质量 普通",
    ]);
    expect(statusChips({ ...base, ipType: "住宅" })).toEqual(["住宅"]);
    expect(statusChips({ ...base, ipQuality: "优质" })).toEqual(["质量 优质"]);
  });

  it("explains the configuration when no probe source exists", () => {
    expect(statusChips({ ...base, ip: "", egressConfigured: false })).toEqual([
      "在 panel.json 配置 egress_ip_probe_url",
    ]);
  });

  it("says probing when configured but no IP has arrived yet", () => {
    expect(statusChips({ ...base, ip: null })).toEqual(["待探测"]);
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
