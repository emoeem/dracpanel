import { loadServersState, removeServer, saveServersState, type Server } from "./config";
import { loadStoredJson, removeStoredValue, saveStoredJson } from "../lib/storage";

/**
 * Client for the privileged sing-box-panel HTTP API.
 *
 * The panel is served from the same origin as this UI (127.0.0.1:9096), so
 * requests are plain same-origin fetches authenticated with X-Panel-Token.
 * The native sing-box API (9091) is a separate origin and is configured by
 * `ensureNativeServer` from the panel's live config.
 */

export const PANEL_TOKEN_KEY = "panel_token";
export const MANAGED_SERVER_ID = "panel-local";
const API_CACHE_NAME = "panel-api-cache";

export interface PanelServiceStatus {
  active: boolean;
  enabled: boolean;
  since: string;
  pid: string;
  raw?: string;
}

export interface PanelState {
  ok: boolean;
  version?: string;
  panel_version?: string;
  mode?: string;
  inbounds?: string[];
  service?: PanelServiceStatus;
  config_path?: string;
  config_mtime?: number;
  config_bytes?: number;
  config_error?: string;
  dry_run?: boolean;
  clash_api?: string;
  clash_secret?: string;
  zash_setup_url?: string;
  zashboard_available?: boolean;
  official_dashboard_url?: string;
  official_dashboard_available?: boolean;
  metacubexd_url?: string;
  managed_group?: string;
  managed_urltest?: string;
  egress_ip?: string;
  token_file?: string;
}

export interface GeoIpInfo {
  ip?: string;
  lon: number;
  lat: number;
  country?: string;
  city?: string;
}

export interface PanelBackup {
  name: string;
  size: number;
  mtime: number;
}

export interface PanelConfig {
  ok: boolean;
  path: string;
  text: string;
  backups: PanelBackup[];
}

export interface PanelResult {
  ok: boolean;
  message?: string;
  backup?: string;
}

export interface PanelSubscriptionUserinfo {
  upload?: number;
  download?: number;
  total?: number;
  expire?: number;
}

export interface PanelSubscription {
  id: string;
  name: string;
  url: string;
  enabled?: boolean;
  node_count?: number;
  last_update?: number | null;
  last_attempt?: number;
  update_interval?: number;
  next_update?: number;
  last_error?: string | null;
  userinfo?: PanelSubscriptionUserinfo;
}

export interface PanelSubscriptionUpdate extends PanelResult {
  nodes?: number;
  skipped?: string[];
}

export interface PanelSubscriptionUpdateResult extends PanelSubscriptionUpdate {
  id?: string;
  name?: string;
}

export interface PanelSubscriptionResult extends PanelResult {
  results?: PanelSubscriptionUpdateResult[];
}

export interface PanelManagedSubscriptions {
  ok: boolean;
  outbound_tags: string[];
  group_members: Record<string, string[]>;
  updated?: number;
  by_subscription?: Record<string, string[]>;
  managed_group?: string;
  managed_urltest?: string;
}

export interface PanelEbpfPolicy {
  ok: boolean;
  present: boolean;
  mode: "off" | "blacklist" | "whitelist" | "none";
  uids: number[];
  include?: number[];
  exclude?: number[];
  data_plane?: string;
  dns_mode?: string;
  ipv6?: boolean;
  shared?: Record<string, unknown>;
}

export interface PanelApp {
  uid: number;
  label: string;
  execs: string[];
  pids: number[];
  names?: string[];
  icon?: string;
}

export interface PanelEbpfFinding {
  status?: string;
  feature?: string;
  scope?: string;
  importance?: string;
  detail?: string;
}

export interface PanelEbpfProbeData {
  ok?: boolean;
  result?: string;
  findings?: PanelEbpfFinding[];
  summary?: {
    pass?: number;
    fail?: number;
    unknown?: number;
    required_issues?: number;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export class PanelAuthError extends Error {
  constructor() {
    super("面板令牌无效或已失效");
    this.name = "PanelAuthError";
  }
}

export class PanelHttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "PanelHttpError";
  }
}

export class GeoIpUnavailableError extends Error {
  constructor() {
    super("missing GeoIP database, see README");
    this.name = "GeoIpUnavailableError";
  }
}

export function getPanelToken(): string {
  return localStorage.getItem(PANEL_TOKEN_KEY) ?? "";
}

export function setPanelToken(token: string): void {
  localStorage.setItem(PANEL_TOKEN_KEY, token);
}

export function clearPanelToken(): void {
  localStorage.removeItem(PANEL_TOKEN_KEY);
}

const REQUEST_TIMEOUT_MS = 15_000;
const LONG_REQUEST_TIMEOUT_MS = 120_000;
const APPLY_TIMEOUT_MS = 180_000;
const SUBSCRIPTION_UPDATE_TIMEOUT_MS = 300_000;
const PROBE_TIMEOUT_MS = 150_000;

function requestSignal(external: AbortSignal | null, timeoutMs: number): AbortSignal {
  if (external !== null) {
    return external;
  }
  if (typeof AbortSignal.timeout === "function") {
    return AbortSignal.timeout(timeoutMs);
  }
  const controller = new AbortController();
  setTimeout(() => controller.abort(), timeoutMs);
  return controller.signal;
}

async function panelFetch(
  path: string,
  init: RequestInit = {},
  timeoutMs: number = REQUEST_TIMEOUT_MS,
): Promise<Response> {
  const token = getPanelToken();
  const headers = new Headers(init.headers);
  if (token) {
    headers.set("X-Panel-Token", token);
  }
  if (init.body !== undefined && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  const externalSignal = init.signal ?? null;
  let response: Response;
  try {
    response = await fetch(`/api${path}`, {
      ...init,
      headers,
      signal: requestSignal(externalSignal, timeoutMs),
    });
  } catch (error) {
    if (
      externalSignal === null &&
      error instanceof DOMException &&
      (error.name === "TimeoutError" || error.name === "AbortError")
    ) {
      throw new Error(
        `面板请求超时（${Math.round(timeoutMs / 1000)} 秒），请检查 sing-box-panel 是否正常响应`,
        { cause: error },
      );
    }
    throw error;
  }
  if (response.status === 401) {
    window.dispatchEvent(new CustomEvent("panel-auth-error"));
    throw new PanelAuthError();
  }
  if (!response.ok) {
    let detail = "";
    try {
      const body = (await response.json()) as { message?: unknown; error?: unknown };
      if (typeof body.message === "string") {
        detail = body.message.trim();
      } else if (typeof body.error === "string") {
        detail = body.error.trim();
      }
    } catch {
      // Non-JSON error bodies fall back to the status line.
    }
    const suffix =
      detail !== ""
        ? `：${detail}`
        : response.statusText !== ""
          ? `（${response.statusText}）`
          : "";
    throw new PanelHttpError(response.status, `面板返回 HTTP ${response.status}${suffix}`);
  }
  return response;
}

async function request<T>(
  path: string,
  init: RequestInit = {},
  timeoutMs: number = REQUEST_TIMEOUT_MS,
): Promise<T> {
  const response = await panelFetch(path, init, timeoutMs);
  try {
    return (await response.json()) as T;
  } catch {
    throw new Error("面板返回了非 JSON 响应");
  }
}

function jsonBody(value: unknown): string {
  return JSON.stringify(value);
}

/* ── status / service ─────────────────────────────────────── */

export function getPanelState(): Promise<PanelState> {
  return request<PanelState>("/state");
}

export function getPanelLogs(lines = 200): Promise<{ ok: boolean; lines: string }> {
  return request<{ ok: boolean; lines: string }>(
    `/logs?n=${lines}`,
    {},
    LONG_REQUEST_TIMEOUT_MS,
  );
}

export async function getGeoIp(ip: string): Promise<GeoIpInfo | null> {
  try {
    return await request<GeoIpInfo>(`/geoip?ip=${encodeURIComponent(ip)}`);
  } catch (error) {
    if (error instanceof PanelHttpError) {
      if (error.status === 404) {
        return null;
      }
      if (error.status === 503) {
        throw new GeoIpUnavailableError();
      }
    }
    throw error;
  }
}

export interface ClashVersion {
  ok: boolean;
  data?: { version?: string } & Record<string, unknown>;
}

export function getClashVersion(): Promise<ClashVersion> {
  return request<ClashVersion>("/clash/version");
}

export function serviceAction(action: "start" | "stop" | "restart" | "reload"): Promise<PanelResult> {
  return request<PanelResult>(
    "/service",
    {
      method: "POST",
      body: jsonBody({ action }),
    },
    LONG_REQUEST_TIMEOUT_MS,
  );
}

/* ── config ───────────────────────────────────────────────── */

export function getPanelConfig(): Promise<PanelConfig> {
  return request<PanelConfig>("/config");
}

/** Download one panel-side config backup as a file (requires the panel token). */
export async function downloadPanelBackup(name: string): Promise<void> {
  const response = await panelFetch(
    `/config/backups/${encodeURIComponent(name)}`,
    {},
    LONG_REQUEST_TIMEOUT_MS,
  );
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function validatePanelConfig(text: string): Promise<PanelResult> {
  return request<PanelResult>(
    "/config/validate",
    {
      method: "POST",
      body: jsonBody({ text }),
    },
    APPLY_TIMEOUT_MS,
  );
}

export function applyPanelConfig(text: string): Promise<PanelResult> {
  return request<PanelResult>(
    "/config",
    {
      method: "POST",
      body: jsonBody({ text }),
    },
    APPLY_TIMEOUT_MS,
  );
}

export function backupPanelConfig(): Promise<PanelResult> {
  return request<PanelResult>("/config/backup", { method: "POST" }, LONG_REQUEST_TIMEOUT_MS);
}

export function restorePanelBackup(name: string): Promise<PanelResult> {
  return request<PanelResult>(
    "/config/restore",
    {
      method: "POST",
      body: jsonBody({ name }),
    },
    APPLY_TIMEOUT_MS,
  );
}

/* ── subscriptions ────────────────────────────────────────── */

export function listSubscriptions(): Promise<{ ok: boolean; subscriptions: PanelSubscription[] }> {
  return request<{ ok: boolean; subscriptions: PanelSubscription[] }>("/subscriptions");
}

export function getManagedSubscriptions(): Promise<PanelManagedSubscriptions> {
  return request<PanelManagedSubscriptions>("/subscriptions/managed");
}

export function addSubscription(name: string, url: string): Promise<PanelSubscriptionUpdate> {
  return request<PanelSubscriptionUpdate>(
    "/subscriptions",
    {
      method: "POST",
      body: jsonBody({ name, url }),
    },
    LONG_REQUEST_TIMEOUT_MS,
  );
}

export function updateAllSubscriptions(): Promise<PanelSubscriptionResult> {
  return request<PanelSubscriptionResult>(
    "/subscriptions/update_all",
    { method: "POST" },
    SUBSCRIPTION_UPDATE_TIMEOUT_MS,
  );
}

export function applySubscriptions(): Promise<PanelResult> {
  return request<PanelResult>("/subscriptions/apply", { method: "POST" }, APPLY_TIMEOUT_MS);
}

export function updateSubscription(id: string): Promise<PanelSubscriptionUpdate> {
  return request<PanelSubscriptionUpdate>(
    `/subscriptions/${encodeURIComponent(id)}/update`,
    { method: "POST" },
    LONG_REQUEST_TIMEOUT_MS,
  );
}

export function setSubscriptionSchedule(
  id: string,
  updateInterval: number,
): Promise<PanelResult> {
  return request<PanelResult>(`/subscriptions/${encodeURIComponent(id)}/schedule`, {
    method: "POST",
    body: jsonBody({ update_interval: updateInterval }),
  });
}

export function deleteSubscription(id: string): Promise<PanelResult> {
  return request<PanelResult>(`/subscriptions/${encodeURIComponent(id)}`, { method: "DELETE" });
}

/* ── eBPF ─────────────────────────────────────────────────── */

export function getEbpfPolicy(): Promise<PanelEbpfPolicy> {
  return request<PanelEbpfPolicy>("/ebpf/policy");
}

export function setEbpfPolicy(mode: "off" | "blacklist" | "whitelist", uids: number[]): Promise<PanelResult> {
  return request<PanelResult>(
    "/ebpf/policy",
    {
      method: "POST",
      body: jsonBody({ mode, uids }),
    },
    APPLY_TIMEOUT_MS,
  );
}

export function probeEbpf(
  iface: string,
): Promise<{ ok: boolean; data?: PanelEbpfProbeData }> {
  return request<{ ok: boolean; data?: PanelEbpfProbeData }>(
    "/ebpf/probe",
    {
      method: "POST",
      body: jsonBody({ interface: iface }),
    },
    PROBE_TIMEOUT_MS,
  );
}

export function listApps(): Promise<{ ok: boolean; apps: PanelApp[] }> {
  return request<{ ok: boolean; apps: PanelApp[] }>("/apps");
}

/* ── native API bootstrap ─────────────────────────────────── */

export interface NativeApiService {
  port: number;
  secret: string;
}

interface ApiCache {
  mtime: number;
  bytes: number;
  port: number;
  secret: string;
}

/**
 * sing-box accepts JSON with `//` / block comments and trailing commas, but
 * not the rest of JSON5 (unquoted keys, single-quoted strings). Strip those
 * two extensions before JSON.parse so a valid config is not mistaken for one
 * without services.api. Full JSON5 is intentionally not accepted here: it
 * would let the panel load a config that sing-box itself rejects.
 */
export function normalizeConfigJson(text: string): string {
  let withoutComments = "";
  let inString = false;
  let escaped = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (inString) {
      withoutComments += char;
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }
    if (char === '"') {
      inString = true;
      withoutComments += char;
      continue;
    }
    if (char === "/" && text[index + 1] === "/") {
      index += 2;
      while (index < text.length && text[index] !== "\n" && text[index] !== "\r") {
        index += 1;
      }
      if (index < text.length) {
        withoutComments += text[index];
      }
      continue;
    }
    if (char === "/" && text[index + 1] === "*") {
      index += 2;
      while (index + 1 < text.length && !(text[index] === "*" && text[index + 1] === "/")) {
        index += 1;
      }
      index += 1;
      continue;
    }
    withoutComments += char;
  }

  let normalized = "";
  inString = false;
  escaped = false;
  for (let index = 0; index < withoutComments.length; index += 1) {
    const char = withoutComments[index];
    if (inString) {
      normalized += char;
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }
    if (char === '"') {
      inString = true;
      normalized += char;
      continue;
    }
    if (char === ",") {
      let next = index + 1;
      while (next < withoutComments.length && /\s/.test(withoutComments[next])) {
        next += 1;
      }
      if (next < withoutComments.length && (withoutComments[next] === "}" || withoutComments[next] === "]")) {
        continue;
      }
    }
    normalized += char;
  }
  return normalized;
}

export function extractApiService(text: string): NativeApiService | null {
  let config: unknown;
  try {
    config = JSON.parse(normalizeConfigJson(text));
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`sing-box 配置解析失败：${detail}`, { cause: error });
  }
  if (typeof config !== "object" || config === null || Array.isArray(config)) {
    throw new Error("sing-box 配置必须是 JSON 对象");
  }
  const services = (config as { services?: unknown }).services;
  if (!Array.isArray(services)) {
    return null;
  }
  for (const service of services) {
    if (typeof service !== "object" || service === null) {
      continue;
    }
    const entry = service as Record<string, unknown>;
    if (entry.type !== "api") {
      continue;
    }
    const port = entry.listen_port;
    if (typeof port !== "number" || !Number.isInteger(port) || port < 1 || port > 65535) {
      throw new Error("services.api 缺少有效的 listen_port（1-65535）");
    }
    const secret = typeof entry.secret === "string" ? entry.secret : "";
    return { port, secret };
  }
  return null;
}

function loadApiCache(): ApiCache | null {
  const value = loadStoredJson(API_CACHE_NAME);
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const cache = value as Partial<ApiCache>;
  if (
    typeof cache.mtime !== "number" ||
    typeof cache.bytes !== "number" ||
    typeof cache.port !== "number" ||
    typeof cache.secret !== "string"
  ) {
    return null;
  }
  return cache as ApiCache;
}

function saveApiCache(cache: ApiCache): void {
  saveStoredJson(API_CACHE_NAME, cache);
}

export interface NativeBootstrap {
  server: Server;
  serverChanged: boolean;
  state: PanelState;
}

/**
 * Ensure the official dashboard server list points at the local native API.
 *
 * The panel's `/api/state` exposes the config mtime cheaply, so a full
 * `/api/config` pull only happens on first login or when the config actually
 * changed. The API secret/port are cached in the server list afterwards.
 */
export async function ensureNativeServer(
  options: { force?: boolean; state?: PanelState } = {},
): Promise<NativeBootstrap> {
  const state = options.state ?? (await getPanelState());
  const mtime = Number(state.config_mtime ?? 0);
  const bytes = Number(state.config_bytes ?? 0);
  const cache = loadApiCache();
  const servers = loadServersState();
  const existing = servers.servers.find((server) => server.id === MANAGED_SERVER_ID);

  if (
    !options.force &&
    existing !== undefined &&
    cache !== null &&
    mtime !== 0 &&
    cache.mtime === mtime &&
    cache.bytes === bytes
  ) {
    return { server: existing, serverChanged: false, state };
  }

  const config = await getPanelConfig();
  const api = extractApiService(config.text);
  if (api === null) {
    throw new Error("sing-box 配置中没有 services.api（原生 API 未启用）");
  }

  const url = `127.0.0.1:${api.port}`;
  const server: Server = {
    id: MANAGED_SERVER_ID,
    name: "本机 sing-box",
    url,
    secret: api.secret,
  };
  const serverChanged =
    existing === undefined || existing.url !== server.url || existing.secret !== server.secret;

  if (serverChanged) {
    const nextServers = [...servers.servers.filter((item) => item.id !== MANAGED_SERVER_ID), server];
    const activeValid =
      servers.activeId !== null && servers.servers.some((item) => item.id === servers.activeId);
    saveServersState({
      servers: nextServers,
      activeId: activeValid ? servers.activeId : server.id,
    });
  }

  saveApiCache({ mtime, bytes, port: api.port, secret: api.secret });
  return { server, serverChanged, state };
}

/** Re-sync after a config-changing operation without a full app reload when possible. */
export async function resyncAfterConfigChange(): Promise<{ serverChanged: boolean }> {
  const result = await ensureNativeServer({ force: true });
  return { serverChanged: result.serverChanged };
}

/**
 * Drop every credential the panel bootstrap cached. Removing the token also
 * fires a storage event in other tabs; PanelGate reloads them so no tab keeps
 * a live native connection behind the lock screen.
 */
export function lockPanel(): void {
  clearPanelToken();
  removeStoredValue(API_CACHE_NAME);
  saveServersState(removeServer(loadServersState(), MANAGED_SERVER_ID));
}
