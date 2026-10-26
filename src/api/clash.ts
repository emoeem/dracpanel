import { loadServersState, serverConnectUrl } from "./config";
import { getPanelState, hasPanelToken } from "./panel";

export interface ClashApiConfig {
  baseUrl: string;
  secret: string;
}

export class ClashApiError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "ClashApiError";
  }
}

const CACHE_TTL_MS = 30_000;
const DEFAULT_TIMEOUT_MS = 15_000;

let cachedConfig: { value: ClashApiConfig | null; at: number } | null = null;
let pendingConfig: Promise<ClashApiConfig | null> | null = null;

/**
 * sing-box exposes the Clash API address and secret through the panel state.
 * The values can contain 0.0.0.0/[::], which a browser cannot use reliably.
 */
export function normalizeClashBaseUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (trimmed === "") {
    return null;
  }
  try {
    const url = new URL(serverConnectUrl(trimmed));
    if (url.hostname === "0.0.0.0") {
      url.hostname = "127.0.0.1";
    } else if (url.hostname === "[::]" || url.hostname === "::") {
      url.hostname = "[::1]";
    }
    url.hash = "";
    url.search = "";
    const path = url.pathname.replace(/\/+$/, "");
    return `${url.origin}${path}`;
  } catch {
    return null;
  }
}

export async function resolveClashApi(force = false): Promise<ClashApiConfig | null> {
  if (!force && cachedConfig !== null && Date.now() - cachedConfig.at < CACHE_TTL_MS) {
    return cachedConfig.value;
  }
  if (!force && pendingConfig !== null) {
    return pendingConfig;
  }
  pendingConfig = (async () => {
    if (!hasPanelToken()) {
      // Direct mode: the Clash API endpoint comes from the server entry.
      const state = loadServersState();
      const server = state.servers.find((item) => item.id === state.activeId) ?? null;
      const baseUrl = server?.clashUrl ? normalizeClashBaseUrl(server.clashUrl) : null;
      const value =
        baseUrl === null
          ? null
          : { baseUrl, secret: typeof server?.clashSecret === "string" ? server.clashSecret : "" };
      cachedConfig = { value, at: Date.now() };
      return value;
    }
    const state = await getPanelState();
    const baseUrl = state.clash_api ? normalizeClashBaseUrl(state.clash_api) : null;
    const value =
      baseUrl === null
        ? null
        : {
            baseUrl,
            secret: typeof state.clash_secret === "string" ? state.clash_secret : "",
          };
    cachedConfig = { value, at: Date.now() };
    return value;
  })().finally(() => {
    pendingConfig = null;
  });
  return pendingConfig;
}

export function resetClashApiCache(): void {
  cachedConfig = null;
  pendingConfig = null;
}

async function clashFetch(
  path: string,
  init: RequestInit = {},
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<Response> {
  const config = await resolveClashApi();
  if (config === null) {
    throw new ClashApiError("Clash API is not configured");
  }
  const headers = new Headers(init.headers);
  if (config.secret !== "") {
    headers.set("Authorization", `Bearer ${config.secret}`);
  }
  let response: Response;
  try {
    response = await fetch(`${config.baseUrl}${path}`, {
      ...init,
      headers,
      credentials: "omit",
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new ClashApiError(
      `Cannot reach the Clash API at ${config.baseUrl}: ${reason}. Check that the Clash API is enabled and allows this origin.`,
    );
  }
  if (!response.ok) {
    let detail = "";
    try {
      const body = (await response.json()) as { message?: unknown; error?: unknown };
      if (typeof body.message === "string") {
        detail = body.message;
      } else if (typeof body.error === "string") {
        detail = body.error;
      }
    } catch {
      // Non-JSON error bodies fall back to the status line.
    }
    throw new ClashApiError(
      detail !== "" ? detail : `Clash API returned HTTP ${response.status}`,
      response.status,
    );
  }
  return response;
}

export interface ClashDnsRecord {
  name?: string;
  type?: number;
  TTL?: number;
  data?: string;
}

export interface ClashDnsResponse {
  Status?: number;
  Question?: ClashDnsRecord[];
  Answer?: ClashDnsRecord[];
  Authority?: ClashDnsRecord[];
  Additional?: ClashDnsRecord[];
  Server?: string;
  [key: string]: unknown;
}

export async function queryDns(name: string, type: string): Promise<ClashDnsResponse> {
  const params = new URLSearchParams({ name, type });
  const response = await clashFetch(`/dns/query?${params.toString()}`);
  return (await response.json()) as ClashDnsResponse;
}

export async function flushDnsCache(): Promise<void> {
  await clashFetch("/cache/dns/flush", { method: "POST" });
}

export async function flushFakeIpCache(): Promise<void> {
  await clashFetch("/cache/fakeip/flush", { method: "POST" });
}

/**
 * Tests a proxy outbound against an arbitrary URL through the Clash API.
 * The native URLTest RPC only uses the URL configured for the outbound.
 */
export async function testProxyDelay(
  tag: string,
  url: string,
  timeoutMs = 5_000,
): Promise<number> {
  const params = new URLSearchParams({ url, timeout: String(timeoutMs) });
  try {
    const response = await clashFetch(
      `/proxies/${encodeURIComponent(tag)}/delay?${params.toString()}`,
      {},
      timeoutMs + 2_000,
    );
    const body = (await response.json()) as { delay?: unknown };
    if (typeof body.delay !== "number" || body.delay <= 0) {
      throw new ClashApiError("Delay test returned no usable result");
    }
    return body.delay;
  } catch (error) {
    if (!(error instanceof ClashApiError) || error.status !== 404) {
      throw error;
    }
    // Groups are exposed by sing-box under /group rather than /proxies.
    const response = await clashFetch(
      `/group/${encodeURIComponent(tag)}/delay?${params.toString()}`,
      {},
      timeoutMs + 2_000,
    );
    const body = (await response.json()) as Record<string, unknown>;
    const delays = Object.values(body).filter(
      (value): value is number => typeof value === "number" && value > 0,
    );
    if (delays.length === 0) {
      throw new ClashApiError("Delay test returned no usable result");
    }
    return Math.min(...delays);
  }
}
