import { describe, expect, it } from "vitest";

import {
  diffConfig,
  diffLines,
  formatDiffValue,
  isSensitiveConfigPath,
} from "./configDiff";

const BEFORE = `{
  // existing config with a comment
  "log": { "level": "warn" },
  "inbounds": [
    { "type": "mixed", "listen": "127.0.0.1", "listen_port": 1080 },
  ],
  "outbounds": [
    { "type": "direct", "tag": "direct" },
  ],
}`;

const AFTER = `{
  "log": { "level": "info" },
  "inbounds": [
    { "type": "mixed", "listen": "127.0.0.1", "listen_port": 1081 },
  ],
  "outbounds": [
    { "type": "direct", "tag": "direct" },
    {
      "type": "socks",
      "tag": "socks",
      "server": "127.0.0.1",
      "server_port": 1080,
    },
  ],
}`;

describe("diffConfig", () => {
  it("reports changed, added, and sensitive paths", () => {
    const diff = diffConfig(BEFORE, AFTER);

    expect(diff.truncated).toBe(false);
    expect(diff.changes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "log.level",
          kind: "changed",
          before: "warn",
          after: "info",
          sensitive: false,
        }),
        expect.objectContaining({
          path: "inbounds[0].listen_port",
          kind: "changed",
          sensitive: true,
        }),
        expect.objectContaining({
          path: "outbounds[1]",
          kind: "added",
          sensitive: true,
        }),
      ]),
    );
  });

  it("reports removals", () => {
    const diff = diffConfig(AFTER, BEFORE);
    expect(diff.changes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "outbounds[1]",
          kind: "removed",
          sensitive: true,
        }),
      ]),
    );
  });

  it("accepts sing-box comments and trailing commas", () => {
    expect(diffConfig(BEFORE, BEFORE).changes).toEqual([]);
  });

  it("throws on syntactically invalid JSON", () => {
    expect(() => diffConfig("{", BEFORE)).toThrow();
  });
});

describe("isSensitiveConfigPath", () => {
  it("flags routing, DNS, inbound, outbound, and secret paths", () => {
    expect(isSensitiveConfigPath("services[0].secret")).toBe(true);
    expect(isSensitiveConfigPath("inbounds[0].listen_port")).toBe(true);
    expect(isSensitiveConfigPath("outbounds[0].server_port")).toBe(true);
    expect(isSensitiveConfigPath("dns.servers[0].server")).toBe(true);
    expect(isSensitiveConfigPath("route.rules[0]")).toBe(true);
    expect(isSensitiveConfigPath("experimental.clash_api.secret")).toBe(true);
  });

  it("does not flag ordinary preferences", () => {
    expect(isSensitiveConfigPath("log.level")).toBe(false);
    expect(isSensitiveConfigPath("experimental.cache_file.enabled")).toBe(false);
  });
});

describe("diffLines", () => {
  it("keeps common lines and marks replacements", () => {
    const lines = diffLines("a\nb\nc", "a\nB\nc");
    expect(lines.filter((line) => line.kind === "same").map((line) => line.text)).toEqual([
      "a",
      "c",
    ]);
    expect(lines.filter((line) => line.kind === "removed").map((line) => line.text)).toEqual([
      "b",
    ]);
    expect(lines.filter((line) => line.kind === "added").map((line) => line.text)).toEqual([
      "B",
    ]);
  });
});

describe("formatDiffValue", () => {
  it("truncates long values", () => {
    const value = "x".repeat(120);
    expect(formatDiffValue(value).length).toBeLessThan(90);
    expect(formatDiffValue(undefined)).toBe("—");
  });
});
