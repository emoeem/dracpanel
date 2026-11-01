/**
 * Path topology behind the flows page: every live connection becomes a
 * rule (or device) → outbound → node path, and the page renders the three
 * columns plus the links between them. Pure aggregation lives here so the
 * path semantics stay unit-testable and out of the component.
 */

import type { ConnectionRow } from "../api/daemon";
import { endpointIp } from "./connectionTools";

export type FlowDimension = "rule" | "device";

export interface FlowPath {
  first: string;
  second: string;
  third: string;
  count: number;
  bytes: number;
}

export interface FlowNode {
  key: string;
  count: number;
  bytes: number;
}

export interface FlowLink {
  /** Indices into the two displayed columns the link connects. */
  from: number;
  to: number;
  count: number;
}

export interface FlowSelection {
  dim: 1 | 2 | 3;
  key: string;
}

export interface FlowTopology {
  paths: FlowPath[];
  col1: FlowNode[];
  col2: FlowNode[];
  col3: FlowNode[];
}

export interface FlowView {
  col1: FlowNode[];
  col2: FlowNode[];
  col3: FlowNode[];
  links12: FlowLink[];
  links23: FlowLink[];
  /** Connections covered by the displayed (possibly filtered) view. */
  total: number;
}

/** First column: matched rule, or the device IP when browsing by device. */
export function flowFirstLabel(row: ConnectionRow, dimension: FlowDimension): string {
  if (dimension === "device") {
    return endpointIp(row.connection.source) || "本机";
  }
  return row.connection.rule || "final";
}

/** Middle column: the outbound group the connection left through. */
export function flowOutboundLabel(row: ConnectionRow): string {
  const chains = row.connection.chainList;
  return chains.length > 1
    ? (chains[chains.length - 1] ?? row.connection.outbound)
    : row.connection.outbound;
}

/** Last column: the concrete exit node (front of the chain). */
export function flowNodeLabel(row: ConnectionRow): string {
  const chains = row.connection.chainList;
  return chains[0] || row.connection.outbound;
}

function rowBytes(row: ConnectionRow): number {
  return Number(row.downlinkTotal) + Number(row.uplinkTotal);
}

/** Aggregates live connections into path triples plus per-column totals. */
export function buildFlowTopology(
  rows: readonly ConnectionRow[],
  dimension: FlowDimension,
): FlowTopology {
  const pathMap = new Map<string, FlowPath>();
  const maps = [new Map<string, FlowNode>(), new Map<string, FlowNode>(), new Map<string, FlowNode>()];
  const bump = (map: Map<string, FlowNode>, key: string, bytes: number) => {
    const entry = map.get(key);
    if (entry) {
      entry.count += 1;
      entry.bytes += bytes;
    } else {
      map.set(key, { key, count: 1, bytes });
    }
  };
  for (const row of rows) {
    const first = flowFirstLabel(row, dimension);
    const second = flowOutboundLabel(row);
    const third = flowNodeLabel(row);
    const bytes = rowBytes(row);
    const id = `${first}\u0000${second}\u0000${third}`;
    const path = pathMap.get(id);
    if (path) {
      path.count += 1;
      path.bytes += bytes;
    } else {
      pathMap.set(id, { first, second, third, count: 1, bytes });
    }
    bump(maps[0]!, first, bytes);
    bump(maps[1]!, second, bytes);
    bump(maps[2]!, third, bytes);
  }
  const byCount = (a: FlowNode, b: FlowNode) => b.count - a.count || a.key.localeCompare(b.key);
  return {
    paths: [...pathMap.values()],
    col1: [...maps[0]!.values()].sort(byCount),
    col2: [...maps[1]!.values()].sort(byCount),
    col3: [...maps[2]!.values()].sort(byCount),
  };
}

/**
 * Projects a topology into the displayed columns (capped at `limit`) and the
 * links between them. When a node is selected, only paths through it remain
 * and the columns shrink to the nodes those paths actually touch.
 */
export function projectFlowView(
  topology: FlowTopology,
  selection: FlowSelection | null,
  limit: number,
): FlowView {
  const empty: FlowView = { col1: [], col2: [], col3: [], links12: [], links23: [], total: 0 };
  let keptFirst: Set<string> | null = null;
  let keptSecond: Set<string> | null = null;
  let keptThird: Set<string> | null = null;
  if (selection !== null) {
    keptFirst = new Set();
    keptSecond = new Set();
    keptThird = new Set();
    for (const path of topology.paths) {
      const matches =
        selection.dim === 1
          ? path.first === selection.key
          : selection.dim === 2
            ? path.second === selection.key
            : path.third === selection.key;
      if (!matches) {
        continue;
      }
      keptFirst.add(path.first);
      keptSecond.add(path.second);
      keptThird.add(path.third);
    }
    // A selection whose paths all vanished (the stream moved on) shows nothing.
    if (keptFirst.size === 0) {
      return empty;
    }
  }
  const pick = (nodes: FlowNode[], allowed: Set<string> | null): FlowNode[] => {
    const list = allowed === null ? nodes : nodes.filter((node) => allowed.has(node.key));
    return list.slice(0, limit);
  };
  const col1 = pick(topology.col1, keptFirst);
  const col2 = pick(topology.col2, keptSecond);
  const col3 = pick(topology.col3, keptThird);
  const index = (nodes: FlowNode[]) => {
    const map = new Map<string, number>();
    nodes.forEach((node, position) => map.set(node.key, position));
    return map;
  };
  const i1 = index(col1);
  const i2 = index(col2);
  const i3 = index(col3);
  const links12 = new Map<string, FlowLink>();
  const links23 = new Map<string, FlowLink>();
  let total = 0;
  for (const path of topology.paths) {
    const a = i1.get(path.first);
    const b = i2.get(path.second);
    const c = i3.get(path.third);
    if (a === undefined || b === undefined || c === undefined) {
      continue;
    }
    const key12 = `${a}\u0000${b}`;
    const existing12 = links12.get(key12);
    if (existing12) {
      existing12.count += path.count;
    } else {
      links12.set(key12, { from: a, to: b, count: path.count });
    }
    const key23 = `${b}\u0000${c}`;
    const existing23 = links23.get(key23);
    if (existing23) {
      existing23.count += path.count;
    } else {
      links23.set(key23, { from: b, to: c, count: path.count });
    }
    total += path.count;
  }
  const byCount = (a: FlowLink, b: FlowLink) => b.count - a.count;
  return {
    col1,
    col2,
    col3,
    links12: [...links12.values()].sort(byCount),
    links23: [...links23.values()].sort(byCount),
    total,
  };
}
