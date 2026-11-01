import { describe, expect, it } from "vitest";

import type { ConnectionRow } from "../api/daemon";
import {
  buildFlowTopology,
  flowFirstLabel,
  projectFlowView,
  type FlowTopology,
} from "./flowTopology";

function row(overrides: {
  rule?: string;
  source?: string;
  outbound?: string;
  chain?: string[];
  download?: number;
}): ConnectionRow {
  const chain = overrides.chain ?? [overrides.outbound ?? "proxy"];
  return {
    closedAt: null,
    uplinkTotal: BigInt(10),
    downlinkTotal: BigInt(overrides.download ?? 90),
    uplinkRate: 0,
    downlinkRate: 0,
    connection: {
      id: Math.random().toString(36).slice(2),
      inbound: "mixed-in",
      inboundType: "mixed",
      ipVersion: 4,
      network: "tcp",
      source: overrides.source ?? "192.168.31.30:44300",
      destination: "93.184.216.34:443",
      domain: "",
      protocol: "tls",
      user: "",
      fromOutbound: "",
      createdAt: BigInt(1700000000000),
      uplink: BigInt(0),
      downlink: BigInt(0),
      rule: overrides.rule ?? "",
      outbound: overrides.outbound ?? "proxy",
      outboundType: "selector",
      chainList: chain,
    } as ConnectionRow["connection"],
  };
}

function topology(rows: ConnectionRow[], dim: "rule" | "device" = "rule"): FlowTopology {
  return buildFlowTopology(rows, dim);
}

describe("buildFlowTopology", () => {
  it("builds one path per rule→outbound→node triple with counts", () => {
    const rows = [
      row({ rule: "ruleA", chain: ["node1", "Auto", "Proxy"] }),
      row({ rule: "ruleA", chain: ["node1", "Auto", "Proxy"] }),
      row({ rule: "ruleB", outbound: "direct", chain: ["direct"] }),
    ];
    const topo = topology(rows);
    expect(topo.paths).toHaveLength(2);
    expect(topo.paths.find((path) => path.first === "ruleA")).toMatchObject({
      second: "Proxy",
      third: "node1",
      count: 2,
    });
    expect(topo.col1.map((node) => node.key)).toEqual(["ruleA", "ruleB"]);
    expect(topo.col2.map((node) => node.key)).toEqual(["Proxy", "direct"]);
    expect(topo.col3.map((node) => node.key)).toEqual(["node1", "direct"]);
  });

  it("labels unmatched rules as final and single-chain rows keep their outbound", () => {
    const topo = topology([row({ outbound: "direct", chain: ["direct"] })]);
    expect(topo.paths[0]).toMatchObject({ first: "final", second: "direct", third: "direct" });
  });

  it("device dimension uses the source IP without the port", () => {
    const rows = [row({ source: "192.168.31.30:44300" }), row({ source: "10.0.0.2:5000" })];
    const topo = topology(rows, "device");
    expect(topo.col1.map((node) => node.key)).toEqual(["10.0.0.2", "192.168.31.30"]);
    expect(flowFirstLabel(rows[0]!, "device")).toBe("192.168.31.30");
  });
});

describe("projectFlowView", () => {
  const rows = [
    row({ rule: "ruleA", chain: ["node1", "Auto", "Proxy"] }),
    row({ rule: "ruleA", chain: ["node1", "Auto", "Proxy"] }),
    row({ rule: "ruleA", chain: ["node2", "Auto", "Proxy"] }),
    row({ rule: "ruleB", outbound: "direct", chain: ["direct"] }),
  ];
  const topo = topology(rows);

  it("caps columns at the limit and keeps links within displayed nodes", () => {
    const view = projectFlowView(topo, null, 1);
    expect(view.col1).toHaveLength(1);
    expect(view.col1[0]?.key).toBe("ruleA");
    expect(view.col2.map((node) => node.key)).toEqual(["Proxy"]);
    expect(view.col3).toHaveLength(1);
    // Paths through nodes the limit dropped are not part of the view.
    expect(view.total).toBe(2);
  });

  it("selecting a first-column node narrows the whole view to its paths", () => {
    const view = projectFlowView(topo, { dim: 1, key: "ruleB" }, 8);
    expect(view.col1.map((node) => node.key)).toEqual(["ruleB"]);
    expect(view.col2.map((node) => node.key)).toEqual(["direct"]);
    expect(view.col3.map((node) => node.key)).toEqual(["direct"]);
    expect(view.total).toBe(1);
    expect(view.links12).toEqual([{ from: 0, to: 0, count: 1 }]);
  });

  it("selecting a middle node keeps every rule and node feeding it", () => {
    const view = projectFlowView(topo, { dim: 2, key: "Proxy" }, 8);
    expect(view.col1.map((node) => node.key)).toEqual(["ruleA"]);
    expect(view.col3.map((node) => node.key)).toEqual(["node1", "node2"]);
    expect(view.total).toBe(3);
  });

  it("merges link counts where several rules share one outbound", () => {
    const extra = topology([
      row({ rule: "ruleA", chain: ["node1", "Auto", "Proxy"] }),
      row({ rule: "ruleC", chain: ["node1", "Auto", "Proxy"] }),
    ]);
    const view = projectFlowView(extra, { dim: 3, key: "node1" }, 8);
    expect(view.col1.map((node) => node.key)).toEqual(["ruleA", "ruleC"]);
    expect(view.links12).toEqual([
      { from: 0, to: 0, count: 1 },
      { from: 1, to: 0, count: 1 },
    ]);
    expect(view.links23).toEqual([{ from: 0, to: 0, count: 2 }]);
    expect(view.total).toBe(2);
  });

  it("returns an empty view when the selected node lost all paths", () => {
    const view = projectFlowView(topo, { dim: 1, key: "gone" }, 8);
    expect(view).toEqual({ col1: [], col2: [], col3: [], links12: [], links23: [], total: 0 });
  });
});
