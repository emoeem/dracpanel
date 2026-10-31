import { describe, expect, it } from "vitest";

import {
  appendTunInbound,
  hasTunInbound,
  lanProxyInfo,
  readInbounds,
  removeTunInbounds,
  setLanProxyEnabled,
} from "./configEdit";

const CONFIG = `{
  // 主配置，保留注释
  "inbounds": [
    {
      "type": "tun", // 系统虚拟网卡
      "tag": "tun-in",
      "interface_name": "singbox0"
    },
    {
      "type": "mixed",
      "tag": "mixed-in",
      "listen": "127.0.0.1",
      "listen_port": 2080
    }
  ],
  "outbounds": [{ "type": "direct", "tag": "direct" }]
}`;

describe("configEdit", () => {
  it("reads inbound summaries", () => {
    const inbounds = readInbounds(CONFIG);
    expect(inbounds).toHaveLength(2);
    expect(inbounds[0]).toMatchObject({ type: "tun", listen: null, listenPort: null });
    expect(inbounds[1]).toMatchObject({ type: "mixed", listen: "127.0.0.1", listenPort: 2080 });
  });

  it("removes TUN while preserving comments and other inbounds", () => {
    const result = removeTunInbounds(CONFIG);
    expect(result.removed).toHaveLength(1);
    expect(result.removed[0].inbound).toMatchObject({ tag: "tun-in" });
    expect(hasTunInbound(result.text)).toBe(false);
    expect(result.text).toContain("// 主配置，保留注释");
    expect(result.text).toContain("mixed-in");
    expect(result.text).not.toContain("tun-in");
  });

  it("restores a removed TUN preset", () => {
    const removed = removeTunInbounds(CONFIG);
    const restored = appendTunInbound(removed.text, removed.removed[0].inbound);
    expect(hasTunInbound(restored)).toBe(true);
    expect(restored).toContain("singbox0");
  });

  it("reports LAN proxy state from the first port inbound", () => {
    expect(lanProxyInfo(CONFIG)).toEqual({
      enabled: false,
      listen: "127.0.0.1",
      port: 2080,
      inboundType: "mixed",
    });
    const opened = setLanProxyEnabled(CONFIG, true);
    expect(lanProxyInfo(opened)).toMatchObject({ enabled: true, listen: "0.0.0.0", port: 2080 });
    expect(opened).toContain("// 系统虚拟网卡");
    const closed = setLanProxyEnabled(opened, false);
    expect(lanProxyInfo(closed).enabled).toBe(false);
  });

  it("throws a typed error on invalid JSON", () => {
    expect(() => readInbounds("{ not json")).toThrow();
  });
});
