import { describe, expect, it } from "vitest";

import {
  detectInboundMode,
  inboundModeHintKey,
  INBOUND_MODE_KEYS,
  type InboundMode,
} from "./inboundMode";

describe("detectInboundMode", () => {
  it("reports unknown when the panel omits the inbound list", () => {
    expect(detectInboundMode(undefined)).toEqual({
      mode: "unknown",
      tun: false,
      ebpf: false,
      types: [],
    });
  });

  it("reports none for an empty list", () => {
    expect(detectInboundMode([]).mode).toBe("none");
  });

  it("prefers eBPF over TUN", () => {
    expect(detectInboundMode(["tun", "ebpf"])).toMatchObject({ mode: "ebpf", tun: true, ebpf: true });
  });

  it("detects TUN capture", () => {
    expect(detectInboundMode(["tun", "mixed"])).toMatchObject({ mode: "tun", tun: true, ebpf: false });
  });

  it("treats port inbounds as proxy mode", () => {
    expect(detectInboundMode(["mixed"]).mode).toBe("mixed");
    expect(detectInboundMode(["socks", "http"]).mode).toBe("mixed");
    expect(detectInboundMode(["tproxy"]).mode).toBe("mixed");
  });

  it("falls back to proxy for unfamiliar inbound types", () => {
    expect(detectInboundMode(["tailscale"]).mode).toBe("proxy");
  });

  it("de-duplicates types and drops blanks", () => {
    expect(detectInboundMode(["tun", "tun", "", "mixed"]).types).toEqual(["tun", "mixed"]);
  });
});

describe("inboundModeHintKey", () => {
  it("explains the capture modes and stays silent otherwise", () => {
    expect(inboundModeHintKey("tun")).toContain("CAP_NET_ADMIN");
    expect(inboundModeHintKey("ebpf")).toContain("cgroup");
    expect(inboundModeHintKey("mixed")).toBeTruthy();
    expect(inboundModeHintKey("none")).toBeNull();
    expect(inboundModeHintKey("unknown")).toBeNull();
    expect(inboundModeHintKey("proxy")).toBeNull();
  });
});

describe("INBOUND_MODE_KEYS", () => {
  it("covers every mode", () => {
    const modes: InboundMode[] = ["tun", "ebpf", "mixed", "proxy", "none", "unknown"];
    for (const mode of modes) {
      expect(INBOUND_MODE_KEYS[mode]).toBeTruthy();
    }
    expect(new Set(Object.values(INBOUND_MODE_KEYS)).size).toBe(modes.length);
  });
});
