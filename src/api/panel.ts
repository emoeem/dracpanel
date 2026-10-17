import { loadServersState, saveServersState, type Server } from "./config";
import { loadStoredJson, saveStoredJson } from "../lib/storage";

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
  managed_group?: string;
  managed_urltest?: string;
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

export interface PanelSubscription {
  id: string;
  name: string;
  url: string;
  node_count?: number;
  last_update?: number | null;
  last_error?: string | null;
}

export interface PanelSubscriptionResult extends PanelResult {
  results?: { id?: string; ok: boolean; message?: string }[];
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
}

export class PanelAuthError extends Error {
  constructor() {
    super("面板令牌无效或已失效");
    this.name = "PanelAuthError";
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

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = getPanelToken();
  const headers = new Headers(init.headers);
  if (token) {
    headers.set("X-Panel-Token", token);
  }
  if (init.body !== undefined && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  const response = await fetch(`/api${path}`, { ...init, headers });
  if (response.status === 401) {
    window.dispatchEvent(new CustomEvent("panel-auth-error"));
    throw new PanelAuthError();
  }
  if (!response.ok) {
    throw new Error(`面板返回 HTTP ${response.status}`);
  }
  return (await response.json()) as T;
}

function jsonBody(value: unknown): string {
  return JSON.stringify(value);
}

/* ── status / service ─────────────────────────────────────── */

export function getPanelState(): Promise<PanelState> {
  return request<PanelState>("/state");
}

export function serviceAction(action: "start" | "stop" | "restart" | "reload"): Promise<PanelResult> {
  return request<PanelResult>("/service", {
    method: "POST",
    body: jsonBody({ action }),
  });
}

export function getPanelLogs(lines = 200): Promise<{ ok: boolean; lines: string }> {
  return request<{ ok: boolean; lines: string }>(`/logs?n=${lines}`);
}

/* ── config ───────────────────────────────────────────────── */

export function getPanelConfig(): Promise<PanelConfig> {
  return request<PanelConfig>("/config");
}

export function validatePanelConfig(text: string): Promise<PanelResult> {
  return request<PanelResult>("/config/validate", {
    method: "POST",
    body: jsonBody({ text }),
  });
}

export function applyPanelConfig(text: string): Promise<PanelResult> {
  return request<PanelResult>("/config", {
    method: "POST",
    body: jsonBody({ text }),
  });
}

export function backupPanelConfig(): Promise<PanelResult> {
  return request<PanelResult>("/config/backup", { method: "POST" });
}

export function restorePanelBackup(name: string): Promise<PanelResult> {
  return request<PanelResult>("/config/restore", {
    method: "POST",
    body: jsonBody({ name }),
  });
}

/* ── subscriptions ────────────────────────────────────────── */

export function listSubscriptions(): Promise<{ ok: boolean; subscriptions: PanelSubscription[] }> {
  return request<{ ok: boolean; subscriptions: PanelSubscription[] }>("/subscriptions");
}

export function addSubscription(name: string, url: string): Promise<PanelResult> {
  return request<PanelResult>("/subscriptions", {
    method: "POST",
    body: jsonBody({ name, url }),
  });
}

export function updateAllSubscriptions(): Promise<PanelSubscriptionResult> {
  return request<PanelSubscriptionResult>("/subscriptions/update_all", { method: "POST" });
}

export function applySubscriptions(): Promise<PanelResult> {
  return request<PanelResult>("/subscriptions/apply", { method: "POST" });
}

export function updateSubscription(id: string): Promise<PanelResult> {
  return request<PanelResult>(`/subscriptions/${encodeURIComponent(id)}/update`, { method: "POST" });
}

export function deleteSubscription(id: string): Promise<PanelResult> {
  return request<PanelResult>(`/subscriptions/${encodeURIComponent(id)}`, { method: "DELETE" });
}

/* ── eBPF ─────────────────────────────────────────────────── */

export function getEbpfPolicy(): Promise<PanelEbpfPolicy> {
  return request<PanelEbpfPolicy>("/ebpf/policy");
}

export function setEbpfPolicy(mode: "off" | "blacklist" | "whitelist", uids: number[]): Promise<PanelResult> {
  return request<PanelResult>("/ebpf/policy", {
    method: "POST",
    body: jsonBody({ mode, uids }),
  });
}

export function probeEbpf(iface: string): Promise<{ ok: boolean; data?: unknown }> {
  return request<{ ok: boolean; data?: unknown }>("/ebpf/probe", {
    method: "POST",
    body: jsonBody({ interface: iface }),
  });
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
  port: number;
  secret: string;
}

export function extractApiService(text: string): NativeApiService | null {
  let config: unknown;
  try {
    config = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof config !== "object" || config === null) {
    return null;
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
    const port = typeof entry.listen_port === "number" ? entry.listen_port : 9091;
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
  if (typeof cache.mtime !== "number" || typeof cache.port !== "number" || typeof cache.secret !== "string") {
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
export async function ensureNativeServer(options: { force?: boolean } = {}): Promise<NativeBootstrap> {
  const state = await getPanelState();
  const mtime = Number(state.config_mtime ?? 0);
  const cache = loadApiCache();
  const servers = loadServersState();
  const existing = servers.servers.find((server) => server.id === MANAGED_SERVER_ID);

  if (
    !options.force &&
    existing !== undefined &&
    cache !== null &&
    mtime !== 0 &&
    cache.mtime === mtime
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

  saveApiCache({ mtime, port: api.port, secret: api.secret });
  return { server, serverChanged, state };
}

/** Re-sync after a config-changing operation without a full app reload when possible. */
export async function resyncAfterConfigChange(): Promise<{ serverChanged: boolean }> {
  const result = await ensureNativeServer({ force: true });
  return { serverChanged: result.serverChanged };
}
