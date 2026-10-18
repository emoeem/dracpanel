import { createContext, useContext } from "react";

import { probePanelEndpoint, type PanelState } from "./panel";

/**
 * Features added after the base 0.1.0 panel build. The backend can advertise
 * them in `PanelState.features`; older panels are probed once per page load.
 */
export const PANEL_FEATURES = [
  "subscriptions.schedule",
  "subscriptions.managed",
  "subscriptions.userinfo",
  "config.backup.download",
  "logs",
  "clash.version",
  "geoip",
] as const;

export type PanelFeature = (typeof PANEL_FEATURES)[number];

const PANEL_FEATURE_SET: ReadonlySet<string> = new Set(PANEL_FEATURES);

function isPanelFeature(value: string): value is PanelFeature {
  return PANEL_FEATURE_SET.has(value);
}

export type PanelCapabilitySource = "backend" | "probe" | "unknown";

export interface PanelCapabilities {
  /** True once the backend feature list or a probe result is available. */
  detected: boolean;
  source: PanelCapabilitySource;
  panelVersion?: string;
  supports(feature: PanelFeature): boolean;
  /** Features explicitly known to be unavailable. */
  missing: PanelFeature[];
}

function buildCapabilities(
  known: ReadonlyMap<PanelFeature, boolean | null>,
  source: "backend" | "probe",
  panelVersion?: string,
): PanelCapabilities {
  return {
    detected: true,
    source,
    panelVersion,
    // A null probe means "unknown"; keep the control usable in that case.
    supports: (feature) => known.get(feature) !== false,
    missing: PANEL_FEATURES.filter((feature) => known.get(feature) === false),
  };
}

export function unknownPanelCapabilities(): PanelCapabilities {
  return {
    detected: false,
    source: "unknown",
    supports: () => true,
    missing: [],
  };
}

export function capabilitiesFromFeatures(
  features: readonly string[],
  panelVersion?: string,
): PanelCapabilities {
  const available = new Set(features.filter(isPanelFeature));
  const known = new Map<PanelFeature, boolean | null>(
    PANEL_FEATURES.map((feature) => [feature, available.has(feature)]),
  );
  return buildCapabilities(known, "backend", panelVersion);
}

export const PanelCapabilitiesContext = createContext<PanelCapabilities>(
  unknownPanelCapabilities(),
);

export function usePanelCapabilities(): PanelCapabilities {
  return useContext(PanelCapabilitiesContext);
}

export function useSupportsPanelFeature(feature: PanelFeature): boolean {
  return usePanelCapabilities().supports(feature);
}

export type PanelProbe = (
  path: string,
  init?: RequestInit,
) => Promise<{ supported: boolean | null }>;

interface FeatureProbe {
  feature: PanelFeature;
  path: string;
  init?: RequestInit;
}

const FEATURE_PROBES: FeatureProbe[] = [
  { feature: "subscriptions.managed", path: "/subscriptions/managed" },
  { feature: "config.backup.download", path: "/config/backups/__panel_probe__" },
  { feature: "logs", path: "/logs?n=1" },
  { feature: "clash.version", path: "/clash/version" },
  { feature: "geoip", path: "/geoip?ip=127.0.0.1" },
];

/**
 * Prefer the backend feature list. For older panels, probe only the routes
 * that changed after the base build and cache the result for this page.
 */
export async function detectPanelCapabilities(
  state: PanelState,
  probe: PanelProbe = probePanelEndpoint,
): Promise<PanelCapabilities> {
  if (Array.isArray(state.features)) {
    return capabilitiesFromFeatures(state.features, state.panel_version);
  }

  const results = await Promise.allSettled(
    FEATURE_PROBES.map(async ({ feature, path, init }) => {
      const result = await probe(path, init);
      return [feature, result.supported] as const;
    }),
  );

  const known = new Map<PanelFeature, boolean | null>();
  for (const result of results) {
    if (result.status === "fulfilled") {
      known.set(result.value[0], result.value[1]);
    }
  }

  const definitive = [...known.values()].some((value) => value !== null);
  if (!definitive) {
    return unknownPanelCapabilities();
  }

  // The schedule and Userinfo endpoints ship with the managed-subscriptions
  // release; infer both instead of probing schedule with a write request.
  const managed = known.get("subscriptions.managed");
  if (managed !== undefined) {
    known.set("subscriptions.schedule", managed);
    known.set("subscriptions.userinfo", managed);
  }
  return buildCapabilities(known, "probe", state.panel_version);
}
