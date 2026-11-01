// @vitest-environment node
import { describe, expect, it } from "vitest";

import { isUsablePanelIp } from "./localIp";

describe("isUsablePanelIp", () => {
  it("accepts LAN addresses", () => {
    expect(isUsablePanelIp("192.168.31.30")).toBe(true);
    expect(isUsablePanelIp("10.0.0.5")).toBe(true);
  });

  it("rejects loopback, so the WebRTC probe can run", () => {
    expect(isUsablePanelIp("127.0.0.1")).toBe(false);
    expect(isUsablePanelIp("127.1.2.3")).toBe(false);
    expect(isUsablePanelIp("::1")).toBe(false);
    expect(isUsablePanelIp("0.0.0.0")).toBe(false);
  });

  it("rejects empty values", () => {
    expect(isUsablePanelIp("")).toBe(false);
    expect(isUsablePanelIp(null)).toBe(false);
    expect(isUsablePanelIp(undefined)).toBe(false);
  });
});
