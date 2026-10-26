// @vitest-environment node
import { describe, expect, it } from "vitest";

import type { ConnectionRow } from "../api/daemon";
import { buildRequestLedger, filterLedgerEntries } from "./requestLedger";

function row(overrides: Partial<ConnectionRow> & { id: string }): ConnectionRow {
  const { connection: connectionOverride, ...rest } = overrides;
  const base = {
    id: overrides.id,
    createdAt: 1000n,
    closedAt: 0n,
    network: "tcp",
    inbound: "mixed-in",
    destination: "1.2.3.4:443",
    domain: "example.com",
    rule: "example.com",
    outbound: "Proxy",
    chainList: ["Proxy", "direct-out"],
    uplinkTotal: 100n,
    downlinkTotal: 500n,
  };
  return {
    connection: { ...base, ...(connectionOverride as object | undefined) },
    uplinkRate: 0,
    downlinkRate: 0,
    uplinkTotal: 100n,
    downlinkTotal: 500n,
    closedAt: null,
    ...rest,
  } as unknown as ConnectionRow;
}

describe("buildRequestLedger", () => {
  it("derives one entry per connection, newest first", () => {
    const entries = buildRequestLedger(
      [row({ id: "a", connection: { createdAt: 3000n } as never }), row({ id: "b" })],
      5000,
    );
    expect(entries.map((entry) => entry.id)).toEqual(["a", "b"]);
    expect(entries[1].host).toBe("example.com");
    expect(entries[1].network).toBe("TCP");
    expect(entries[1].chain).toBe("Proxy / direct-out");
  });

  it("marks closed rows and measures duration up to closedAt", () => {
    const entries = buildRequestLedger([row({ id: "c", closedAt: 4500 })], 5000);
    expect(entries[0].closed).toBe(true);
    expect(entries[0].durationMs).toBe(3500);
  });

  it("caps the ledger length", () => {
    const many = Array.from({ length: 50 }, (_, index) => row({ id: String(index) }));
    expect(buildRequestLedger(many, 5000, 10)).toHaveLength(10);
  });
});

describe("filterLedgerEntries", () => {
  const entries = buildRequestLedger(
    [row({ id: "active" }), row({ id: "closed", closedAt: 2000 })],
    5000,
  );

  it("filters by state", () => {
    expect(filterLedgerEntries(entries, "active", "").map((e) => e.id)).toEqual(["active"]);
    expect(filterLedgerEntries(entries, "closed", "").map((e) => e.id)).toEqual(["closed"]);
    expect(filterLedgerEntries(entries, "all", "")).toHaveLength(2);
  });

  it("filters by search across host, chain, rule and network", () => {
    expect(filterLedgerEntries(entries, "all", "example.com")).toHaveLength(2);
    expect(filterLedgerEntries(entries, "all", "proxy")).toHaveLength(2);
    expect(filterLedgerEntries(entries, "all", "udp")).toHaveLength(0);
  });
});
