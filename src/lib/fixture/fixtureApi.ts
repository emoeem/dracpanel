import { create } from "@bufbuild/protobuf";

import {
  ConnectionEventType,
  ConnectionSchema,
  ConnectionEventSchema,
  ConnectionEventsSchema,
  GroupSchema,
  GroupItemSchema,
  LogLevel,
  ServiceStatusSchema,
  ServiceStatus_Type,
  StatusSchema,
  type Connection,
  type Group,
  type GroupItem,
} from "../../gen/daemon/started_service_pb";
import { StreamStore, type StreamSnapshot } from "../../api/stream";
import type {
  ClashModeData,
  ConnectionRow,
  ConnectionsData,
  GroupsData,
  LogsData,
  OutboundsData,
  ServerInfo,
  ServiceStatusData,
  StatusData,
} from "../../api/daemon";

/**
 * Development-only fixture backend, enabled with `?fixture=1` on a dev build.
 * It mirrors the DaemonApi surface with synthetic streams so every rebuilt
 * page can be exercised (and screenshotted) without a running core.
 * Production bundles tree-shake this module away: it is only imported from
 * App.tsx behind `import.meta.env.DEV && new URLSearchParams(location.search).has("fixture")`.
 */

const NODE_NAMES: [string, string][] = [
  ["🇭🇰 香港 IEPL 01", "vmess"],
  ["🇭🇰 香港 BGP 02", "trojan"],
  ["🇯🇵 东京 NTT 01", "vless"],
  ["🇯🇵 大阪 IIJ 02", "vmess"],
  ["🇸🇬 新加坡 01", "hysteria2"],
  ["🇺🇸 洛杉矶 01", "trojan"],
  ["🇺🇸 圣何塞 02", "vless"],
  ["🇩🇪 法兰克福 01", "vmess"],
  ["🇬🇧 伦敦 01", "shadowsocks"],
  ["🇦🇺 悉尼 01", "trojan"],
];

const DELAYS: Record<string, number> = {
  "🇭🇰 香港 IEPL 01": 42,
  "🇭🇰 香港 BGP 02": 58,
  "🇯🇵 东京 NTT 01": 88,
  "🇯🇵 大阪 IIJ 02": 96,
  "🇸🇬 新加坡 01": 130,
  "🇺🇸 洛杉矶 01": 620,
  "🇺🇸 圣何塞 02": 705,
  "🇩🇪 法兰克福 01": 910,
  "🇬🇧 伦敦 01": 980,
  "🇦🇺 悉尼 01": 1240,
};

function item(tag: string, type: string, delay: number): GroupItem {
  return create(GroupItemSchema, {
    tag,
    type,
    urlTestTime: delay > 0 ? BigInt(Date.now() * 1_000_000) : 0n,
    urlTestDelay: delay,
  });
}

function buildGroups(): Group[] {
  const nodes = NODE_NAMES.map(([tag, type]) => item(tag, type, DELAYS[tag] ?? 0));
  return [
    create(GroupSchema, {
      tag: "自动选择",
      type: "urltest",
      selectable: false,
      selected: "🇭🇰 香港 IEPL 01",
      isExpand: false,
      items: nodes,
    }),
    create(GroupSchema, {
      tag: "节点选择",
      type: "selector",
      selectable: true,
      selected: "🇭🇰 香港 IEPL 01",
      isExpand: true,
      items: nodes,
    }),
    create(GroupSchema, {
      tag: "故障转移",
      type: "fallback",
      selectable: false,
      selected: "🇭🇰 香港 BGP 02",
      isExpand: false,
      items: nodes,
    }),
  ];
}

function connection(
  id: string,
  host: string,
  network: string,
  outbound: string,
  rule: string,
  process: string,
  downRate: number,
  upRate: number,
  ageMs: number,
): Connection {
  const now = Date.now();
  return create(ConnectionSchema, {
    id,
    inbound: "mixed-in",
    inboundType: "mixed",
    ipVersion: 4,
    network,
    source: "192.168.31.30:51000",
    destination: `${host}:443`,
    domain: host,
    protocol: network === "tcp" ? "tcp" : "udp",
    fromOutbound: "mixed-in",
    createdAt: BigInt(now - ageMs),
    uplink: BigInt(upRate * 3),
    downlink: BigInt(downRate * 12),
    uplinkTotal: BigInt(upRate * 40),
    downlinkTotal: BigInt(downRate * 120),
    rule,
    outbound,
    outboundType: "selector",
    chainList: ["节点选择", outbound],
    processInfo: {
      processId: 1000 + (id.charCodeAt(0) % 500),
      userId: 1000,
      userName: "emo",
      processPath: `/usr/bin/${process}`,
      packageNames: [],
    },
  });
}

function buildConnectionEvents(reset: boolean) {
  const rows = [
    connection("c1", "www.google.com", "tcp", "香港 IEPL 01", " geosite:geolocation-!cn", "chrome", 35_500, 1_700, 42_000),
    connection("c2", "github.com", "tcp", "香港 IEPL 01", "geosite:github", "code", 5_600, 1_700, 120_000),
    connection("c3", "api.openai.com", "tcp", "日本 NTT 01", "geosite:openai", "node", 12_400, 3_100, 8_000),
    connection("c4", "www.youtube.com", "udp", "香港 BGP 02", "geosite:youtube", "mpv", 182_000, 4_200, 400_000),
    connection("c5", "registry.npmjs.org", "tcp", "direct", "rule-set:cn", "node", 0, 900, 5_000),
    connection("c6", "dns.google", "udp", "direct", "sniff", "system", 300, 120, 1_000),
  ];
  return create(ConnectionEventsSchema, {
    reset,
    events: rows.map((row) =>
      create(ConnectionEventSchema, {
        type: ConnectionEventType.CONNECTION_EVENT_NEW,
        id: row.id,
        connection: row,
      }),
    ),
  });
}

export function isFixtureMode(): boolean {
  return (
    import.meta.env.DEV &&
    new URLSearchParams(window.location.search).has("fixture")
  );
}

export class FixtureDaemonApi {
  readonly config = {
    id: "fixture",
    name: "Fixture Server",
    url: "127.0.0.1:1",
    secret: "",
  } as const;

  readonly serviceStatus: StreamStore<ServiceStatusData>;
  readonly status: StreamStore<StatusData>;
  readonly groups: StreamStore<GroupsData>;
  readonly clashMode: StreamStore<ClashModeData>;
  readonly logs: StreamStore<LogsData>;
  readonly connections: StreamStore<ConnectionsData>;
  readonly outbounds: StreamStore<OutboundsData>;

  private logSequence = 0;
  private tick = 0;
  private timers: ReturnType<typeof setInterval>[] = [];

  constructor() {
    this.serviceStatus = new StreamStore<ServiceStatusData>(
      () => ({ status: null }),
      async ({ update }) => {
        update(() => ({
          status: create(ServiceStatusSchema, {
            status: ServiceStatus_Type.STARTED,
            errorMessage: "",
          }),
        }));
        await new Promise<never>(() => {});
      },
    );

    this.status = new StreamStore<StatusData>(
      () => ({ current: null, uplinkHistory: [], downlinkHistory: [], history: [] }),
      async ({ update }) => {
        const push = () => {
          this.tick += 1;
          const wave = Math.sin(this.tick / 4) * 0.5 + 0.5;
          const uplink = Math.round(1200 + wave * 18_000);
          const downlink = Math.round(30_000 + wave * 1_400_000);
          update((current) => ({
            current: create(StatusSchema, {
              memory: BigInt(407 * 1024 * 1024),
              goroutines: 115,
              connectionsIn: 13,
              connectionsOut: 15,
              trafficAvailable: true,
              uplink: BigInt(uplink),
              downlink: BigInt(downlink),
              uplinkTotal: (current.current?.uplinkTotal ?? 0n) + BigInt(uplink),
              downlinkTotal: (current.current?.downlinkTotal ?? 0n) + BigInt(downlink),
            }),
            uplinkHistory: [...current.uplinkHistory, uplink].slice(-30),
            downlinkHistory: [...current.downlinkHistory, downlink].slice(-30),
            history: [
              ...current.history,
              {
                at: Date.now(),
                uplink,
                downlink,
                connections: 28,
                memory: 407 * 1024 * 1024,
              },
            ].slice(-3600),
          }));
        };
        push();
        this.timers.push(setInterval(push, 1000));
      },
    );

    this.groups = new StreamStore<GroupsData>(
      () => ({ groups: [], loaded: false, latencyHistory: {} }),
      async ({ update }) => {
        update(() => ({ groups: buildGroups(), loaded: true, latencyHistory: {} }));
        await new Promise<never>(() => {});
      },
    );

    this.clashMode = new StreamStore<ClashModeData>(
      () => ({ modeList: [], currentMode: "", loaded: false }),
      async ({ update }) => {
        update(() => ({ modeList: ["Rule", "Proxy", "Direct"], currentMode: "Rule", loaded: true }));
        await new Promise<never>(() => {});
      },
    );

    this.logs = new StreamStore<LogsData>(
      () => ({ entries: [], defaultLevel: LogLevel.INFO }),
      async ({ update }) => {
        const lines: [LogLevel, string][] = [
          [LogLevel.INFO, "inbound/mixed[0]: tcp connection from 192.168.31.30:51000"],
          [LogLevel.INFO, "router: match[geosite:geolocation-!cn] -> 节点选择 -> 香港 IEPL 01"],
          [LogLevel.INFO, "outbound/vmess[0]: connection opened to www.google.com:443"],
          [LogLevel.WARN, "dns: upstream timeout for dns.google, retrying via dns-direct"],
          [LogLevel.INFO, "inbound/tun[0]: udp packet from 192.168.31.30 to 8.8.8.8:443"],
        ];
        update(() => ({
          entries: lines.map(([level, message], index) => ({
            id: this.logSequence++,
            level,
            message: `${message} (fixture #${index})`,
          })),
          defaultLevel: LogLevel.INFO,
        }));
        await new Promise<never>(() => {});
      },
    );

    this.connections = new StreamStore<ConnectionsData>(
      () => ({ rows: new Map(), loaded: false }),
      async ({ update }) => {
        const push = (reset: boolean) => {
          update(() => {
            const rows = new Map<string, ConnectionRow>();
            const events = buildConnectionEvents(reset);
            for (const event of events.events) {
              if (!event.connection) {
                continue;
              }
              const rateSeed = (event.connection.id.charCodeAt(1) % 4) + 1;
              rows.set(event.connection.id, {
                connection: event.connection,
                uplinkRate: rateSeed * 900,
                downlinkRate: rateSeed * 15_000,
                uplinkTotal: event.connection.uplinkTotal,
                downlinkTotal: event.connection.downlinkTotal,
                closedAt: null,
              });
            }
            return { rows, loaded: true };
          });
        };
        push(true);
        await new Promise<never>(() => {});
      },
    );

    this.outbounds = new StreamStore<OutboundsData>(
      () => ({ outbounds: [], loaded: false }),
      async ({ update }) => {
        update(() => ({
          outbounds: buildGroups().flatMap((group) => group.items),
          loaded: true,
        }));
        await new Promise<never>(() => {});
      },
    );
  }

  openBidirectionalStream(): never {
    throw new Error("fixture mode does not support bidirectional streams");
  }

  retryNow(): void {}

  reconnectNow(): void {}

  async urlTest(outboundTag: string): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 200 + Math.random() * 600));
    const jitter = () => Math.max(20, Math.round((DELAYS[outboundTag] ?? 300) * (0.6 + Math.random() * 0.8)));
    this.groups.mutate((data) => ({
      ...data,
      groups: data.groups.map((group) => ({
        ...group,
        items: group.items.map((node) =>
          node.tag === outboundTag
            ? { ...node, urlTestDelay: jitter(), urlTestTime: BigInt(Date.now() * 1_000_000) }
            : node,
        ),
      })),
    }));
  }

  async selectOutbound(groupTag: string, outboundTag: string): Promise<void> {
    this.groups.mutate((data) => ({
      ...data,
      groups: data.groups.map((group) =>
        group.tag === groupTag ? { ...group, selected: outboundTag } : group,
      ),
    }));
  }

  async setGroupExpand(groupTag: string, isExpand: boolean): Promise<void> {
    this.groups.mutate((data) => ({
      ...data,
      groups: data.groups.map((group) =>
        group.tag === groupTag ? { ...group, isExpand } : group,
      ),
    }));
  }

  async setClashMode(mode: string): Promise<void> {
    this.clashMode.mutate((data) => ({ ...data, currentMode: mode }));
  }

  async closeConnection(id: string): Promise<void> {
    this.connections.mutate((data) => {
      const rows = new Map(data.rows);
      const row = rows.get(id);
      if (row) {
        rows.set(id, { ...row, closedAt: Date.now() });
      }
      return { ...data, rows };
    });
  }

  async closeAllConnections(): Promise<void> {
    this.connections.mutate((data) => {
      const rows = new Map<string, ConnectionRow>();
      for (const [id, row] of data.rows) {
        rows.set(id, { ...row, closedAt: Date.now() });
      }
      return { ...data, rows };
    });
  }

  clearConnectionHistory(): void {
    this.connections.mutate((data) => {
      const rows = new Map<string, ConnectionRow>();
      for (const [id, row] of data.rows) {
        if (row.closedAt === null) {
          rows.set(id, row);
        }
      }
      return { ...data, rows };
    });
  }

  async clearLogs(): Promise<void> {
    this.logs.mutate(() => ({ entries: [], defaultLevel: LogLevel.INFO }));
  }

  async serverInfo(): Promise<ServerInfo> {
    return { version: "v1.12.0-fixture", apiVersion: 3 };
  }

  async getStartedAt(): Promise<number> {
    return Date.now() - 11 * 60_000 - 34_000;
  }

  async getDeprecatedWarnings(): Promise<never[]> {
    return [];
  }

  snapshotOf<T>(store: StreamStore<T>): StreamSnapshot<T> {
    return store.getSnapshot();
  }
}

export function installFixtureFetch(): void {
  const original = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const path = new URL(url, window.location.href).pathname;
    const json = (body: unknown) =>
      Promise.resolve(new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json" } }));
    if (path === "/api/state") {
      return json({
        ok: true,
        version: "1.0.0",
        panel_version: "fixture",
        api_version: 3,
        features: ["subscriptions", "subscriptions.managed", "subscriptions.schedule", "config.backup.download", "logs", "clash.version", "geoip"],
        inbounds: ["tun", "mixed"],
        service: { active: true, enabled: true, since: new Date().toISOString(), pid: "4242" },
        config_path: "/etc/sing-box/config.json",
        config_mtime: Math.floor(Date.now() / 1000) - 3600 * 10,
        config_bytes: 18_432,
        clash_api: "http://127.0.0.1:9090",
        clash_secret: "fixture",
        egress_ip: "103.151.172.34",
        local_ip: "192.168.31.30",
        ip_type: "机房",
        ip_quality: "普通",
        memory_app: 310 * 1024 * 1024,
        memory_kernel: 97 * 1024 * 1024,
      });
    }
    if (path === "/api/system-proxy") {
      if (init?.method === "POST") {
        return json({ ok: true });
      }
      return json({ enabled: false, port: 7890 });
    }
    if (path === "/api/geoip") {
      return json({
        ip: "103.151.172.34",
        lon: 114.17,
        lat: 22.32,
        country: "HK",
        city: "Hong Kong",
        asn: 133210,
        organization: "Kidc Limited",
      });
    }
    if (path === "/api/subscriptions") {
      return json({
        ok: true,
        subscriptions: [
          {
            id: "sub-1",
            name: "iKuuu_V2.yaml",
            url: "https://example.com/sub/ikuuu",
            enabled: true,
            node_count: 10,
            last_update: Math.floor(Date.now() / 1000) - 3600 * 10,
            update_interval: 86400,
            next_update: Math.floor(Date.now() / 1000) + 3600 * 14,
            userinfo: { upload: 1.2e9, download: 102.5e9, total: 300.6e9, expire: Math.floor(Date.now() / 1000) + 86400 * 49 },
          },
        ],
      });
    }
    if (path === "/api/subscriptions/managed") {
      return json({
        ok: true,
        outbound_tags: ["香港 IEPL 01", "香港 BGP 02"],
        group_members: {},
        managed_group: "节点选择",
      });
    }
    if (path === "/api/config") {
      if (init?.method === "POST") {
        return json({ ok: true, backup: "config.json.bak.fixture" });
      }
      return json({
        ok: true,
        path: "/etc/sing-box/config.json",
        backups: [
          { name: "config.json.bak.20261031", size: 18_432, mtime: Math.floor(Date.now() / 1000) - 7200 },
          { name: "config.json.bak.20261030", size: 18_210, mtime: Math.floor(Date.now() / 1000) - 86400 },
        ],
        text: JSON.stringify(
          {
            log: { level: "warn" },
            inbounds: [
              { type: "tun", tag: "tun-in", interface_name: "singbox0" },
              { type: "mixed", tag: "mixed-in", listen: "127.0.0.1", listen_port: 2080 },
            ],
            route: {
              rule_set: [{ type: "remote", tag: "geosite/cn", format: "binary", url: "https://example.com/geosite-cn.srs" }],
              rules: [
                { action: "sniff" },
                { ip_is_private: true, outbound: "direct" },
                { rule_set: ["geosite/cn"], outbound: "direct" },
              ],
              final: "节点选择",
            },
            experimental: { clash_api: { default_mode: "Rule" } },
          },
          null,
          2,
        ),
      });
    }
    if (path === "/api/config/validate" || path === "/api/config/backup" || path === "/api/config/restore") {
      return json({ ok: true });
    }
    if (path === "/api/service") {
      return json({ ok: true });
    }
    if (path === "/api/clash/version") {
      return json({ ok: true, data: { version: "v1.12.0" } });
    }
    if (path === "/api/logs") {
      return json({ ok: true, lines: "oct 31 11:00:00 sing-box[4242]: started" });
    }
    if (path.startsWith("/api/subscriptions/")) {
      return json({ ok: true });
    }
    // Clash API delay tests (service status, connectivity).
    if (path.includes("/delay")) {
      return json({ delay: Math.round(40 + Math.random() * 600) });
    }
    if (path === "/dns/query") {
      return json({ Status: 0, Answer: [{ name: "example.com.", type: 1, TTL: 300, data: "93.184.216.34" }] });
    }
    if (path === "/cache/dns/flush" || path === "/cache/fakeip/flush") {
      return json({});
    }
    if (path === "/api/ebpf/policy") {
      return json({ ok: true, present: false, mode: "off", uids: [] });
    }
    return original(input, init);
  };
}
