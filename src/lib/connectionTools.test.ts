import { create } from "@bufbuild/protobuf";
import { describe, expect, it } from "vitest";

import type { ConnectionRow } from "../api/daemon";
import { ConnectionSchema, ProcessInfoSchema } from "../gen/daemon/started_service_pb";
import {
  activeConnectionRows,
  connectionRowsToCSV,
  connectionRowsToJSON,
  defaultConnectionSortDirection,
  endpointIp,
  filterConnectionRows,
  flattenConnectionGroups,
  groupConnectionRows,
  sortConnectionRows,
  withoutClosedConnectionRows,
} from "./connectionTools";

function row(options: {
  id: string;
  network?: string;
  source?: string;
  destination?: string;
  domain?: string;
  outbound?: string;
  rule?: string;
  process?: string;
  createdAt?: bigint;
  upload?: bigint;
  download?: bigint;
  closedAt?: number | null;
  chain?: string[];
}): ConnectionRow {
  return {
    connection: create(ConnectionSchema, {
      id: options.id,
      network: options.network ?? "tcp",
      source: options.source ?? "127.0.0.1:1234",
      destination: options.destination ?? "1.1.1.1:443",
      domain: options.domain ?? "example.com",
      outbound: options.outbound ?? "proxy",
      rule: options.rule ?? "domain_suffix:example.com",
      createdAt: options.createdAt ?? 1_000n,
      chainList: options.chain ?? ["proxy"],
      processInfo: options.process
        ? create(ProcessInfoSchema, { processPath: options.process })
        : undefined,
    }),
    uplinkRate: 10,
    downlinkRate: 20,
    uplinkTotal: options.upload ?? 100n,
    downlinkTotal: options.download ?? 200n,
    closedAt: options.closedAt ?? null,
  };
}

describe("filterConnectionRows", () => {
  const rows = [
    row({ id: "a", domain: "api.example.com", outbound: "proxy-a", upload: 10n }),
    row({ id: "b", network: "udp", domain: "video.example.net", outbound: "proxy-b", closedAt: 2 }),
    row({ id: "c", domain: "direct.example.org", outbound: "direct", rule: "final" }),
  ];

  it("filters by state, network and source", () => {
    expect(
      filterConnectionRows(rows, {
        state: "active",
        search: "",
        source: "127.0.0.1",
        network: "tcp",
        hideChain: "",
      }).map((entry) => entry.connection.id),
    ).toEqual(["a", "c"]);
  });

  it("supports key:value search and hides matching chains", () => {
    expect(
      filterConnectionRows(rows, {
        state: "all",
        search: "outbound:proxy-a",
        source: "",
        network: "all",
        hideChain: "proxy-b",
      }).map((entry) => entry.connection.id),
    ).toEqual(["a"]);
  });

  it("ignores an invalid hide regex instead of throwing", () => {
    expect(
      filterConnectionRows(rows, {
        state: "all",
        search: "",
        source: "",
        network: "all",
        hideChain: "(",
      }),
    ).toHaveLength(3);
  });
});

describe("sortConnectionRows", () => {
  const rows = [
    row({ id: "a", domain: "b.example", upload: 100n, download: 0n }),
    row({ id: "b", domain: "a.example", upload: 300n, download: 0n }),
    row({ id: "c", domain: "c.example", upload: 200n, download: 0n }),
  ];

  it("sorts numeric and text columns in either direction", () => {
    expect(sortConnectionRows(rows, "upload", "desc").map((entry) => entry.connection.id)).toEqual([
      "b",
      "c",
      "a",
    ]);
    expect(sortConnectionRows(rows, "host", "asc").map((entry) => entry.connection.id)).toEqual([
      "b",
      "a",
      "c",
    ]);
  });

  it("uses date as the default descending sort", () => {
    expect(defaultConnectionSortDirection("date")).toBe("desc");
    expect(defaultConnectionSortDirection("host")).toBe("asc");
  });
});

describe("groupConnectionRows", () => {
  it("aggregates bytes per group and expands only selected groups", () => {
    const rows = [
      row({ id: "a", domain: "one.example", upload: 10n, download: 20n }),
      row({ id: "b", domain: "one.example", upload: 5n, download: 5n }),
      row({ id: "c", domain: "two.example", upload: 1n, download: 1n }),
    ];
    const groups = groupConnectionRows(rows, "host");
    expect(groups.map((group) => group.key)).toEqual(["one.example", "two.example"]);
    expect(groups[0].uplink).toBe(15n);
    expect(groups[0].downlink).toBe(25n);
    const items = flattenConnectionGroups(groups, new Set(["one.example"]));
    expect(items.map((item) => item.kind)).toEqual(["group", "row", "row", "group"]);
  });
});

describe("connection export", () => {
  const rows = [row({ id: "a", domain: "example.com", rule: "domain,example.com" })];

  it("writes RFC 4180 CSV and converts bigint fields to strings", () => {
    const csv = connectionRowsToCSV(rows);
    expect(csv).toContain("id,network,host");
    expect(csv).toContain('"domain,example.com"');
    expect(csv).toContain("100");
  });

  it("escapes quotes and newlines in CSV fields", () => {
    const csv = connectionRowsToCSV([
      row({ id: "a", rule: 'payload="quoted"\nnext' }),
    ]);
    expect(csv).toContain('"payload=""quoted""\nnext"');
  });

  it("serializes bigint connection fields to JSON numbers", () => {
    const parsed = JSON.parse(connectionRowsToJSON(rows)) as { id: string; createdAt: number }[];
    expect(parsed[0].id).toBe("a");
    expect(parsed[0].createdAt).toBe(1000);
  });
});

describe("withoutClosedConnectionRows", () => {
  it("keeps active rows and removes closed history", () => {
    const rows = new Map([
      ["active", row({ id: "active" })],
      ["closed", row({ id: "closed", closedAt: 2 })],
    ]);
    const cleared = withoutClosedConnectionRows(rows);
    expect([...cleared.keys()]).toEqual(["active"]);
  });
});

describe("activeConnectionRows", () => {
  it("counts only active connections for filtered close confirmation", () => {
    const rows = [
      row({ id: "a" }),
      row({ id: "b", closedAt: 1 }),
      row({ id: "c" }),
    ];
    expect(activeConnectionRows(rows).map((entry) => entry.connection.id)).toEqual(["a", "c"]);
  });
});

describe("combined connection view", () => {
  it("filters, sorts and groups in one pass", () => {
    const rows = [
      row({ id: "a", domain: "b.example", outbound: "proxy", upload: 10n }),
      row({ id: "b", domain: "a.example", outbound: "direct", upload: 30n }),
      row({ id: "c", domain: "a.example", outbound: "proxy", upload: 20n, closedAt: 1 }),
    ];
    const filtered = filterConnectionRows(rows, {
      state: "active",
      search: "outbound:proxy",
      source: "127.0.0.1",
      network: "tcp",
      hideChain: "",
    });
    const sorted = sortConnectionRows(filtered, "upload", "desc");
    const grouped = groupConnectionRows(sorted, "host");
    expect(grouped.map((group) => group.key)).toEqual(["b.example"]);
    expect(grouped[0].rows.map((entry) => entry.connection.id)).toEqual(["a"]);
  });
});

describe("endpointIp", () => {
  it("strips ports from IPv4, bracketed IPv6 and hostnames", () => {
    expect(endpointIp("1.2.3.4:443")).toBe("1.2.3.4");
    expect(endpointIp("[2001:db8::1]:443")).toBe("2001:db8::1");
    expect(endpointIp("example.com")).toBe("example.com");
  });
});
