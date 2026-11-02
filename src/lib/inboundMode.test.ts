import { describe, expect, it } from "vitest";

import {
  detectInboundMode,
  ebpfPolicyKey,
  inboundModeHintKey,
  INBOUND_MODE_KEYS,
  readCapture,
  type InboundMode,
} from "./inboundMode";

describe("detectInboundMode", () => {
  it("reports unknown when the panel omits the inbound list", () => {
    expect(detectInboundMode(undefined)).toMatchObject({
      mode: "unknown",
      tun: false,
      ebpf: false,
      types: [],
      unknown: true,
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

describe("readCapture", () => {
  const ebpfState = {
    capture: {
      mode: "ebpf",
      inbounds: ["mixed", "ebpf"],
      tun: false,
      proxy_ports: [7890],
      ebpf: {
        present: true,
        mode: "whitelist",
        uids: [1000, 1001],
        include: [1000, 1001],
        exclude: [],
        data_plane: "cgroup",
        dns_mode: "hijack",
        ipv6: true,
      },
    },
  };

  it("trusts the backend's classified capture block", () => {
    const capture = readCapture(ebpfState);
    expect(capture.mode).toBe("ebpf");
    expect(capture.tun).toBe(false);
    expect(capture.ebpf).toBe(true);
    expect(capture.proxyPorts).toEqual([7890]);
    expect(capture.ebpfInfo).toMatchObject({
      mode: "whitelist",
      dataPlane: "cgroup",
      dnsMode: "hijack",
      ipv6: true,
    });
    expect(capture.ebpfInfo?.uids).toEqual([1000, 1001]);
    expect(capture.unknown).toBe(false);
  });

  it("falls back to the inbound list on older panels", () => {
    const capture = readCapture({ inbounds: ["tun", "mixed"] });
    expect(capture).toMatchObject({ mode: "tun", tun: true, ebpf: false, ebpfInfo: null });
  });

  it("reports unknown when the config could not be read", () => {
    const capture = readCapture({ inbounds: [], config_error: "permission denied" });
    expect(capture.unknown).toBe(true);
    expect(capture.reason).toBe("permission denied");
    // "no inbounds" is only believable when the config was read at all.
    expect(capture.mode).toBe("none");
  });

  it("never invents a TUN device from a missing inbound list", () => {
    const capture = readCapture({ config_error: "no such file" });
    expect(capture.mode).toBe("unknown");
    expect(capture.tun).toBe(false);
  });

  it("coerces numeric strings and drops junk in policy lists", () => {
    const capture = readCapture({
      capture: {
        mode: "ebpf",
        ebpf: { present: true, mode: "blacklist", exclude: ["1000", 1002], uids: [] },
      },
    });
    expect(capture.ebpfInfo?.exclude).toEqual([1000, 1002]);
    expect(capture.ebpfInfo?.uids).toEqual([1000, 1002]);
    expect(capture.ebpfInfo?.ipv6).toBe(true);
  });

  it("treats a null state as unknown", () => {
    expect(readCapture(undefined).mode).toBe("unknown");
  });
});

describe("ebpfPolicyKey", () => {
  it("names the three policy selectors", () => {
    expect(ebpfPolicyKey("whitelist")).toBe("Allow list");
    expect(ebpfPolicyKey("blacklist")).toBe("Block list");
    expect(ebpfPolicyKey("off")).toBe("No app filter");
  });
});
