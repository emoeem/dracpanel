import { describe, expect, it } from "vitest";

import { extractLogType } from "./logTools";

describe("extractLogType", () => {
  it("reads the tag emitted by sing-box FormatSimple", () => {
    expect(extractLogType("router: match[0] inbound/tun[tun-in] => sniff")).toBe("router");
    expect(extractLogType("dns: lookup example.com")).toBe("dns");
    expect(extractLogType("inbound/tun[tun-in]: inbound connection to example.com")).toBe(
      "inbound",
    );
    expect(extractLogType("outbound/selector[proxy]: outbound connection")).toBe("outbound");
  });

  it("skips the observable connection id prefix", () => {
    expect(extractLogType("[42 1.2s] dns: lookup example.com")).toBe("dns");
    expect(extractLogType("[42 350ms] inbound/tun[tun-in]: connection")).toBe("inbound");
  });

  it("still accepts a bracketed tag and ANSI colors", () => {
    expect(extractLogType("[dns] lookup example.com")).toBe("dns");
    expect(extractLogType("\u001b[36mdns\u001b[0m: lookup example.com")).toBe("dns");
  });

  it("falls back to other for messages without a tag", () => {
    expect(extractLogType("2026-10-18T12:00:00Z started")).toBe("other");
    expect(extractLogType("https://example.com failed")).toBe("other");
  });
});
