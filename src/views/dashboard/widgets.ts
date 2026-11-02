import type { MessageKey } from "../../app/translations";
import { loadStoredJson, saveStoredJson } from "../../lib/storage";

/**
 * Dashboard widget registry (doona parity, batch 3).
 *
 * The layout is a flat, ordered list of placements so persistence can survive
 * new widgets: `normalizeLayout` keeps stored order, drops ids that no longer
 * exist, clamps sizes to the widget's own constraints and appends widgets that
 * were introduced after the layout was saved. Every function here is pure so
 * the layout can be unit-tested without a DOM; only load/save touch storage.
 */

export type WidgetKind = "metric" | "chart" | "list" | "table" | "controls";

export interface WidgetDef {
  id: string;
  /** Message key used for the widget title in the editor. */
  title: MessageKey;
  kind: WidgetKind;
  defaultSpan: number;
  minSpan: number;
  maxSpan: number;
  /** 0 means "auto height"; otherwise a multiple of the 88px card row. */
  defaultRows: number;
  minRows: number;
  maxRows: number;
  defaultVisible: boolean;
}

export interface WidgetPlacement {
  id: string;
  visible: boolean;
  span: number;
  rows: number;
}

export interface WidgetLayout {
  version: 1;
  placements: WidgetPlacement[];
}

export const DASHBOARD_GRID_COLUMNS = 4;

export const WIDGET_DEFS: readonly WidgetDef[] = [
  { id: "status", title: "Status", kind: "metric", defaultSpan: 2, minSpan: 1, maxSpan: 4, defaultRows: 2, minRows: 1, maxRows: 3, defaultVisible: true },
  { id: "upload", title: "Upload", kind: "metric", defaultSpan: 1, minSpan: 1, maxSpan: 2, defaultRows: 2, minRows: 1, maxRows: 3, defaultVisible: true },
  { id: "download", title: "Download", kind: "metric", defaultSpan: 1, minSpan: 1, maxSpan: 2, defaultRows: 2, minRows: 1, maxRows: 3, defaultVisible: true },
  { id: "mode", title: "Outbound mode", kind: "controls", defaultSpan: 2, minSpan: 1, maxSpan: 4, defaultRows: 1, minRows: 1, maxRows: 2, defaultVisible: true },
  { id: "global-outbound", title: "Global outbound", kind: "controls", defaultSpan: 1, minSpan: 1, maxSpan: 2, defaultRows: 1, minRows: 1, maxRows: 2, defaultVisible: true },
  { id: "system-proxy", title: "System proxy", kind: "controls", defaultSpan: 1, minSpan: 1, maxSpan: 2, defaultRows: 1, minRows: 1, maxRows: 2, defaultVisible: true },
  { id: "tun", title: "TUN", kind: "controls", defaultSpan: 1, minSpan: 1, maxSpan: 2, defaultRows: 1, minRows: 1, maxRows: 2, defaultVisible: true },
  { id: "intranet", title: "LAN access", kind: "controls", defaultSpan: 1, minSpan: 1, maxSpan: 2, defaultRows: 1, minRows: 1, maxRows: 2, defaultVisible: true },
  { id: "quota", title: "Subscription quota", kind: "metric", defaultSpan: 1, minSpan: 1, maxSpan: 2, defaultRows: 1, minRows: 1, maxRows: 3, defaultVisible: true },
  { id: "memory", title: "Memory", kind: "metric", defaultSpan: 1, minSpan: 1, maxSpan: 2, defaultRows: 1, minRows: 1, maxRows: 3, defaultVisible: true },
  { id: "services", title: "Connectivity", kind: "list", defaultSpan: 2, minSpan: 1, maxSpan: 2, defaultRows: 1, minRows: 1, maxRows: 3, defaultVisible: true },
  { id: "stats", title: "Active connections", kind: "metric", defaultSpan: 1, minSpan: 1, maxSpan: 4, defaultRows: 1, minRows: 1, maxRows: 2, defaultVisible: true },
  { id: "cpu", title: "CPU usage", kind: "metric", defaultSpan: 1, minSpan: 1, maxSpan: 2, defaultRows: 1, minRows: 1, maxRows: 3, defaultVisible: true },
  { id: "traffic", title: "Traffic", kind: "chart", defaultSpan: 2, minSpan: 1, maxSpan: 4, defaultRows: 2, minRows: 1, maxRows: 3, defaultVisible: true },
  { id: "outbound-share", title: "Outbound download", kind: "chart", defaultSpan: 1, minSpan: 1, maxSpan: 2, defaultRows: 2, minRows: 1, maxRows: 3, defaultVisible: true },
  { id: "ranking", title: "Traffic ranking", kind: "list", defaultSpan: 1, minSpan: 1, maxSpan: 2, defaultRows: 2, minRows: 1, maxRows: 3, defaultVisible: true },
  { id: "latency", title: "Node latency", kind: "chart", defaultSpan: 2, minSpan: 1, maxSpan: 4, defaultRows: 2, minRows: 1, maxRows: 3, defaultVisible: true },
  { id: "outbound-connections", title: "Connections by outbound", kind: "chart", defaultSpan: 1, minSpan: 1, maxSpan: 2, defaultRows: 2, minRows: 1, maxRows: 3, defaultVisible: true },
  { id: "dns-results", title: "DNS results", kind: "table", defaultSpan: 1, minSpan: 1, maxSpan: 4, defaultRows: 2, minRows: 1, maxRows: 3, defaultVisible: true },
  { id: "policy-groups", title: "Policy groups", kind: "list", defaultSpan: 2, minSpan: 1, maxSpan: 4, defaultRows: 2, minRows: 1, maxRows: 3, defaultVisible: true },
  { id: "notifications", title: "Notifications", kind: "list", defaultSpan: 2, minSpan: 1, maxSpan: 4, defaultRows: 2, minRows: 1, maxRows: 3, defaultVisible: true },
  { id: "connections", title: "Connections", kind: "table", defaultSpan: 4, minSpan: 2, maxSpan: 4, defaultRows: 2, minRows: 1, maxRows: 3, defaultVisible: true },
];

const DEFS_BY_ID = new Map(WIDGET_DEFS.map((def) => [def.id, def]));

export const WIDGET_IDS = WIDGET_DEFS.map((def) => def.id);

export function widgetDef(id: string): WidgetDef | null {
  return DEFS_BY_ID.get(id) ?? null;
}

export function clampSpan(def: WidgetDef, span: number): number {
  if (!Number.isFinite(span)) {
    return def.defaultSpan;
  }
  return Math.max(def.minSpan, Math.min(def.maxSpan, Math.round(span)));
}

export function clampRows(def: WidgetDef, rows: number): number {
  if (!Number.isFinite(rows)) {
    return def.defaultRows;
  }
  return Math.max(def.minRows, Math.min(def.maxRows, Math.round(rows)));
}

/** Editor slider bound; 0 is the explicit "auto height" choice. */
export function rowChoices(def: WidgetDef): number[] {
  const choices = [0];
  for (let rows = def.minRows; rows <= def.maxRows; rows += 1) {
    choices.push(rows);
  }
  return choices;
}

function defaultPlacement(def: WidgetDef): WidgetPlacement {
  return {
    id: def.id,
    visible: def.defaultVisible,
    span: def.defaultSpan,
    rows: def.defaultRows,
  };
}

export function defaultLayout(): WidgetLayout {
  return { version: 1, placements: WIDGET_DEFS.map(defaultPlacement) };
}

function placementFrom(raw: unknown): WidgetPlacement | null {
  if (typeof raw !== "object" || raw === null) {
    return null;
  }
  const candidate = raw as Partial<Record<keyof WidgetPlacement, unknown>>;
  if (typeof candidate.id !== "string") {
    return null;
  }
  const def = widgetDef(candidate.id);
  if (def === null) {
    return null;
  }
  return {
    id: def.id,
    visible: candidate.visible !== false,
    span: clampSpan(def, typeof candidate.span === "number" ? candidate.span : def.defaultSpan),
    rows:
      candidate.rows === 0
        ? 0
        : clampRows(def, typeof candidate.rows === "number" ? candidate.rows : def.defaultRows),
  };
}

/**
 * Rebuild a persisted layout into a complete, ordered placement list:
 * unknown ids and duplicates are dropped, surviving order is preserved, and
 * widgets added since the layout was stored are appended with defaults.
 */
export function normalizeLayout(raw: unknown): WidgetLayout {
  const source =
    typeof raw === "object" && raw !== null && Array.isArray((raw as { placements?: unknown }).placements)
      ? ((raw as { placements: unknown[] }).placements)
      : [];
  const seen = new Set<string>();
  const placements: WidgetPlacement[] = [];
  for (const entry of source) {
    const placement = placementFrom(entry);
    if (placement === null || seen.has(placement.id)) {
      continue;
    }
    seen.add(placement.id);
    placements.push(placement);
  }
  for (const def of WIDGET_DEFS) {
    if (!seen.has(def.id)) {
      placements.push(defaultPlacement(def));
    }
  }
  return { version: 1, placements };
}

export function findPlacement(layout: WidgetLayout, id: string): WidgetPlacement | null {
  return layout.placements.find((placement) => placement.id === id) ?? null;
}

/**
 * Moves a widget one step within the *visible* order.
 *
 * Swapping with the raw neighbour made the button look dead whenever that
 * neighbour was hidden (the visible order did not change, yet the layout was
 * rewritten and marked dirty).
 */
export function movePlacement(layout: WidgetLayout, id: string, delta: number): WidgetLayout {
  const visible = layout.placements.filter((placement) => placement.visible);
  const visibleIndex = visible.findIndex((placement) => placement.id === id);
  const visibleTarget = visibleIndex + delta;
  if (visibleIndex < 0 || visibleTarget < 0 || visibleTarget >= visible.length) {
    return layout;
  }
  const otherId = visible[visibleTarget].id;
  const index = layout.placements.findIndex((placement) => placement.id === id);
  const placements = [...layout.placements];
  const [moved] = placements.splice(index, 1);
  const insertAt = placements.findIndex((placement) => placement.id === otherId);
  placements.splice(insertAt + (delta > 0 ? 1 : 0), 0, moved);
  return { ...layout, placements };
}

export function updatePlacement(
  layout: WidgetLayout,
  id: string,
  patch: Partial<Omit<WidgetPlacement, "id">>,
): WidgetLayout {
  const def = widgetDef(id);
  if (def === null) {
    return layout;
  }
  const placements = layout.placements.map((placement) => {
    if (placement.id !== id) {
      return placement;
    }
    return {
      ...placement,
      visible: patch.visible === undefined ? placement.visible : patch.visible,
      span: patch.span === undefined ? placement.span : clampSpan(def, patch.span),
      rows: patch.rows === undefined ? placement.rows : patch.rows === 0 ? 0 : clampRows(def, patch.rows),
    };
  });
  return { ...layout, placements };
}

export function visiblePlacements(layout: WidgetLayout): WidgetPlacement[] {
  return layout.placements.filter((placement) => placement.visible);
}

export function hiddenCount(layout: WidgetLayout): number {
  return layout.placements.filter((placement) => !placement.visible).length;
}

/** Clamp a span to the grid actually available at this breakpoint. */
export function effectiveSpan(placement: WidgetPlacement, columns: number): number {
  return Math.max(1, Math.min(placement.span, Math.max(1, columns)));
}

const STORAGE_KEY = "dashboard-widgets-v1";

export function loadWidgetLayout(): WidgetLayout {
  const stored = loadStoredJson(STORAGE_KEY);
  return stored === null ? defaultLayout() : normalizeLayout(stored);
}

export function saveWidgetLayout(layout: WidgetLayout): void {
  saveStoredJson(STORAGE_KEY, layout);
}

export function isWidgetVisible(layout: WidgetLayout, id: string): boolean {
  return findPlacement(layout, id)?.visible ?? false;
}
