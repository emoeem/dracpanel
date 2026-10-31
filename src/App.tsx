import {
  Component,
  lazy,
  Suspense,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";

import {
  loadServersState,
  saveServersState,
  type Server,
  type ServersState,
} from "./api/config";
import { DaemonApi } from "./api/daemon";
import { isTerminalCode, useStream } from "./api/stream";
import { ServiceStatus_Type } from "./gen/daemon/started_service_pb";
import {
  ApiContext,
  applyAppearance,
  loadAccentPreference,
  loadAmoledPreference,
  loadPalettePreference,
  loadThemePreference,
  navigate,
  useApi,
  saveAccentPreference,
  saveAmoledPreference,
  savePalettePreference,
  saveThemePreference,
  watchSystemTheme,
  type AccentPreference,
  type PalettePreference,
  type ThemePreference,
} from "./app/context";
import { dismissError, useCurrentError } from "./app/errorStore";
import { useI18n, I18nProvider } from "./app/i18n";
import { useHealthMonitor } from "./app/useHealthMonitor";
import { AUTO_TEST_EVENT, loadAutoTestInterval } from "./app/groupPreferences";
import { openLogsEnabled } from "./app/logToggle";
import { FixtureDaemonApi, installFixtureFetch } from "./lib/fixture/fixtureApi";
import { CommandPalette, type Command } from "./components/CommandPalette";
import { MobileNav } from "./components/MobileNav";
import { Sidebar, useSidebarExpanded, type SidebarItem } from "./components/Sidebar";
import type { IconName } from "./components/Icon";
import { Button, Dialog, Spinner } from "./components/ui";
import { ToastProvider } from "./components/Toast";
import { PanelGate } from "./panel/PanelGate";
import { ConnectionErrorView } from "./views/ConnectionErrorView";
import { SetupView } from "./views/SetupView";
import styles from "./App.module.css";

/* Development-only fixture backend (?fixture=1 on a dev build) so the rebuilt
   pages can be exercised without a running core. Production builds drop it. */
const FIXTURE_MODE =
  import.meta.env.DEV &&
  typeof window !== "undefined" &&
  new URLSearchParams(window.location.search).has("fixture");

if (FIXTURE_MODE) {
  installFixtureFetch();
  localStorage.setItem("panel_token", "fixture");
  localStorage.setItem(
    "sing-box-dashboard.servers",
    JSON.stringify({
      servers: [{ id: "fixture", name: "Fixture Server", url: "127.0.0.1:1", secret: "" }],
      activeId: "fixture",
    }),
  );
}

/* Route views are code-split: a session that only watches the dashboard should
   not have to download the settings editors or the config tools. */
const DashboardView = lazy(() =>
  import("./views/dashboard/DashboardView").then((m) => ({ default: m.DashboardView })),
);
const ProxiesView = lazy(() =>
  import("./views/proxies/ProxiesView").then((m) => ({ default: m.ProxiesView })),
);
const ProfilesView = lazy(() =>
  import("./views/profiles/ProfilesView").then((m) => ({ default: m.ProfilesView })),
);
const ConnectionsView = lazy(() =>
  import("./views/records/RecordsView").then((m) => ({ default: m.ConnectionsView })),
);
const RequestsView = lazy(() =>
  import("./views/records/RecordsView").then((m) => ({ default: m.RequestsView })),
);
const DnsView = lazy(() =>
  import("./views/records/RecordsView").then((m) => ({ default: m.DnsView })),
);
const LogsView = lazy(() => import("./views/LogsView").then((m) => ({ default: m.LogsView })));
const ToolsView = lazy(() => import("./views/tools/ToolsView").then((m) => ({ default: m.ToolsView })));
const ThemeView = lazy(() => import("./views/tools/ThemeView").then((m) => ({ default: m.ThemeView })));
const ResourcesView = lazy(() =>
  import("./views/tools/ResourcesView").then((m) => ({ default: m.ResourcesView })),
);
const BackupView = lazy(() => import("./views/tools/BackupView").then((m) => ({ default: m.BackupView })));
const GeneralView = lazy(() =>
  import("./views/tools/GeneralView").then((m) => ({ default: m.GeneralView })),
);
const AdvancedView = lazy(() =>
  import("./views/tools/AdvancedView").then((m) => ({ default: m.AdvancedView })),
);
const RulesView = lazy(() => import("./views/tools/RulesView").then((m) => ({ default: m.RulesView })));
const RuleSetsView = lazy(() =>
  import("./views/tools/RuleSetsView").then((m) => ({ default: m.RuleSetsView })),
);
const ManageView = lazy(() => import("./views/ManageView").then((m) => ({ default: m.ManageView })));
const ServersView = lazy(() =>
  import("./views/SettingsView").then((m) => ({ default: m.ServersView })),
);
const NetworkQualityView = lazy(() =>
  import("./views/ToolsView").then((m) => ({ default: m.NetworkQualityView })),
);
const STUNTestView = lazy(() =>
  import("./views/ToolsView").then((m) => ({ default: m.STUNTestView })),
);
const ConnectivityTestView = lazy(() =>
  import("./views/ConnectivityTestView").then((m) => ({ default: m.ConnectivityTestView })),
);

export type Route =
  | { page: "dashboard" }
  | { page: "proxies" }
  | { page: "profiles" }
  | { page: "connections" }
  | { page: "logs" }
  | { page: "tools" }
  | { page: "tools/requests" }
  | { page: "tools/dns" }
  | { page: "tools/resources" }
  | { page: "tools/theme" }
  | { page: "tools/backup" }
  | { page: "tools/general" }
  | { page: "tools/advanced" }
  | { page: "tools/rules" }
  | { page: "tools/rulesets" }
  | { page: "tools/config" }
  | { page: "tools/servers" }
  | { page: "tools/network-quality" }
  | { page: "tools/stun" }
  | { page: "tools/connectivity" };

/** Pre-rename hashes kept working as aliases. */
const ROUTE_ALIASES: Record<string, Route["page"]> = {
  overview: "dashboard",
  groups: "proxies",
  manage: "tools/config",
  system: "tools/config",
  settings: "tools",
  requests: "tools/requests",
  dns: "tools/dns",
  rules: "tools/rules",
  speedtest: "proxies",
  "tools/rules": "tools/rules",
};

function routeFromHash(locationHash: string): Route {
  const hash = locationHash.replace(/^#\/?/, "");
  const queryIndex = hash.indexOf("?");
  const segments = (queryIndex >= 0 ? hash.slice(0, queryIndex) : hash)
    .split("/")
    .map((segment) => {
      try {
        return decodeURIComponent(segment);
      } catch {
        return segment;
      }
    });
  const joined = segments.join("/");
  const aliased = ROUTE_ALIASES[joined] ?? (joined as Route["page"]);
  switch (aliased) {
    case "dashboard":
    case "proxies":
    case "profiles":
    case "connections":
    case "logs":
    case "tools":
    case "tools/requests":
    case "tools/dns":
    case "tools/resources":
    case "tools/theme":
    case "tools/backup":
    case "tools/general":
    case "tools/advanced":
    case "tools/rules":
    case "tools/rulesets":
    case "tools/config":
    case "tools/servers":
    case "tools/network-quality":
    case "tools/stun":
    case "tools/connectivity":
      return { page: aliased };
    default:
      return { page: "dashboard" };
  }
}

function subscribeLocationHash(onChange: () => void): () => void {
  window.addEventListener("hashchange", onChange);
  return () => window.removeEventListener("hashchange", onChange);
}

function locationHashSnapshot(): string {
  return location.hash;
}

export function App() {
  if (FIXTURE_MODE) {
    // The fixture has no real panel/native API behind the gate, so skip it.
    return (
      <I18nProvider>
        <ToastProvider>
          <WebApp />
          <GlobalErrorDialog />
        </ToastProvider>
      </I18nProvider>
    );
  }
  return (
    <I18nProvider>
      <ToastProvider>
        <PanelGate>
          <WebApp />
        </PanelGate>
        <GlobalErrorDialog />
      </ToastProvider>
    </I18nProvider>
  );
}

function useAppState() {
  const [serversState, setServersState] = useState<ServersState>(() => loadServersState());
  const [theme, setTheme] = useState<ThemePreference>(() => loadThemePreference());
  const [accent, setAccent] = useState<AccentPreference>(() => loadAccentPreference());
  const [palette, setPalette] = useState<PalettePreference>(() => loadPalettePreference());
  const [amoled, setAmoled] = useState<boolean>(() => loadAmoledPreference());
  const locationHash = useSyncExternalStore(
    subscribeLocationHash,
    locationHashSnapshot,
    locationHashSnapshot,
  );
  const route = useMemo(() => routeFromHash(locationHash), [locationHash]);

  useEffect(() => {
    applyAppearance(theme, accent, palette, amoled);
  }, [theme, accent, palette, amoled]);

  useEffect(
    () =>
      watchSystemTheme(() => {
        applyAppearance(
          loadThemePreference(),
          loadAccentPreference(),
          loadPalettePreference(),
          loadAmoledPreference(),
        );
      }),
    [],
  );

  const updateServers = (next: ServersState) => {
    saveServersState(next);
    setServersState(() => next);
  };

  const updateTheme = (next: ThemePreference) => {
    saveThemePreference(next);
    setTheme(() => next);
  };

  const updateAccent = (next: AccentPreference) => {
    saveAccentPreference(next);
    setAccent(() => next);
  };

  const updatePalette = (next: PalettePreference) => {
    savePalettePreference(next);
    setPalette(() => next);
  };

  const updateAmoled = (next: boolean) => {
    saveAmoledPreference(next);
    setAmoled(() => next);
  };

  return {
    serversState,
    updateServers,
    theme,
    updateTheme,
    accent,
    updateAccent,
    palette,
    updatePalette,
    amoled,
    updateAmoled,
    route,
  };
}

function GlobalErrorDialog() {
  const { t } = useI18n();
  const message = useCurrentError();
  if (message === null) {
    return null;
  }
  return (
    <Dialog onClose={dismissError}>
      <h3>{t("Error")}</h3>
      <p className="dialog-message">{message}</p>
      <div className="row-actions dialog-actions">
        <Button
          onClick={() => {
            void navigator.clipboard.writeText(message).catch(() => {});
          }}
        >
          {t("Copy")}
        </Button>
        <Button variant="primary" onClick={dismissError}>
          {t("Ok")}
        </Button>
      </div>
    </Dialog>
  );
}

interface ShellProps {
  server: Server;
  serversState: ServersState;
  onServersChange: (state: ServersState) => void;
  route: Route;
  theme: ThemePreference;
  onThemeChange: (theme: ThemePreference) => void;
  accent: AccentPreference;
  onAccentChange: (accent: AccentPreference) => void;
  palette: PalettePreference;
  onPaletteChange: (palette: PalettePreference) => void;
  amoled: boolean;
  onAmoledChange: (amoled: boolean) => void;
}

function Shell(props: ShellProps) {
  const { language } = useI18n();
  const [generation, setGeneration] = useState(0);
  const api = useMemo(() => {
    if (FIXTURE_MODE) {
      return new FixtureDaemonApi() as unknown as DaemonApi;
    }
    return new DaemonApi(props.server, language);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.server, language, generation]);
  return (
    <ApiContext.Provider value={api}>
      <ShellContent {...props} onRetry={() => setGeneration(generation + 1)} />
    </ApiContext.Provider>
  );
}

function ShellContent(props: ShellProps & { onRetry: () => void }) {
  const api = useApi();
  const route = props.route;
  const [paletteOpen, setPaletteOpen] = useState(false);
  const serviceStatus = useStream(api.serviceStatus);
  const groups = useStream(api.groups);
  const [autoTestInterval, setAutoTestInterval] = useState(() =>
    loadAutoTestInterval(api.config.id),
  );
  const [logsVisible, setLogsVisible] = useState(openLogsEnabled);
  const [sidebarExpanded, toggleSidebar] = useSidebarExpanded();

  useEffect(() => {
    const refresh = () => setAutoTestInterval(loadAutoTestInterval(api.config.id));
    window.addEventListener(AUTO_TEST_EVENT, refresh);
    return () => window.removeEventListener(AUTO_TEST_EVENT, refresh);
  }, [api.config.id]);

  useEffect(() => {
    const refresh = () => setLogsVisible(openLogsEnabled());
    window.addEventListener("open-logs-changed", refresh);
    return () => window.removeEventListener("open-logs-changed", refresh);
  }, []);

  const statusType = serviceStatus.data.status?.status;
  const started = statusType === ServiceStatus_Type.STARTED;
  const hasProxies = started && groups.data.loaded && groups.data.groups.length > 0;

  useHealthMonitor({
    api,
    serverId: api.config.id,
    intervalMs: autoTestInterval === "off" ? 0 : Number(autoTestInterval) * 60_000,
    active: started,
    groups: groups.data.groups,
    histories: groups.data.latencyHistory,
  });

  useEffect(() => {
    const kick = () => {
      if (!document.hidden) {
        api.reconnectNow();
      }
    };
    document.addEventListener("visibilitychange", kick);
    window.addEventListener("pageshow", kick);
    window.addEventListener("online", kick);
    return () => {
      document.removeEventListener("visibilitychange", kick);
      window.removeEventListener("pageshow", kick);
      window.removeEventListener("online", kick);
    };
  }, [api]);

  // ⌘K / Ctrl+K toggles the command palette from anywhere.
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key !== "k" && event.key !== "K") {
        return;
      }
      if (!(event.ctrlKey || event.metaKey) || event.shiftKey || event.altKey) {
        return;
      }
      event.preventDefault();
      setPaletteOpen((open) => !open);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const commands = useMemo<Command[]>(() => {
    let seq = 0;
    const go = (label: string, page: string, icon: IconName, hint?: string): Command => ({
      id: `nav-${seq++}`,
      label,
      group: "页面",
      icon,
      hint,
      run: () => navigate(page),
    });
    return [
      go("仪表盘", "dashboard", "dashboard", "Ctrl+1"),
      go("代理", "proxies", "public", "Ctrl+2"),
      go("配置", "profiles", "description", "Ctrl+3"),
      go("实时连接", "connections", "hub", "Ctrl+4"),
      go("日志", "logs", "text_snippet"),
      go("工具", "tools", "handyman"),
      go("最近请求", "tools/requests", "swap_vert"),
      go("DNS 查询", "tools/dns", "dns"),
      go("资源", "tools/resources", "memory"),
      go("主题", "tools/theme", "palette"),
      go("备份与恢复", "tools/backup", "backup"),
      go("常规", "tools/general", "settings"),
      go("进阶配置", "tools/advanced", "handyman"),
      go("附加规则", "tools/rules", "rule"),
      go("自定义资源", "tools/rulesets", "rule"),
      go("配置文件", "tools/config", "code"),
    ];
  }, []);

  useEffect(() => {
    const pages: Record<string, string> = {
      "1": "dashboard",
      "2": "proxies",
      "3": "profiles",
      "4": "connections",
    };
    const handler = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.shiftKey || event.altKey) {
        return;
      }
      const target = event.target as HTMLElement | null;
      if (
        target !== null &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable)
      ) {
        return;
      }
      const page = pages[event.key];
      if (page !== undefined) {
        event.preventDefault();
        navigate(page);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const lostError =
    serviceStatus.phase === "error" && isTerminalCode(serviceStatus.errorCode)
      ? (serviceStatus.error ?? "连接已断开")
      : null;

  if (lostError !== null) {
    return (
      <ConnectionErrorView
        server={props.server}
        error={lostError}
        reconnecting={serviceStatus.phase === "connecting"}
        onRetry={props.onRetry}
        serversState={props.serversState}
        onServersChange={props.onServersChange}
      />
    );
  }

  if (serviceStatus.data.status === null && route.page !== "tools/config") {
    return (
      <div className={styles.connectingView}>
        <Spinner className={styles.connectingSpinner} />
      </div>
    );
  }

  const items: SidebarItem[] = [
    { key: "dashboard", label: "仪表盘", icon: "dashboard", page: "dashboard" },
    {
      key: "proxies",
      label: "代理",
      icon: "public",
      page: "proxies",
      hidden: !hasProxies,
    },
    { key: "profiles", label: "配置", icon: "description", page: "profiles" },
    { key: "connections", label: "实时连接", icon: "hub", page: "connections", hidden: !started },
    { key: "logs", label: "日志", icon: "text_snippet", page: "logs", hidden: !logsVisible || !started },
    { key: "tools", label: "工具", icon: "handyman", page: "tools" },
  ];
  const visibleItems = items.filter((item) => !item.hidden);
  const mobileItems = visibleItems.filter(
    (item) => item.key === "logs" || ["dashboard", "proxies", "profiles", "tools"].includes(item.key),
  );

  return (
    <div className={styles.app}>
      <Sidebar
        items={items}
        activePage={route.page}
        expanded={sidebarExpanded}
        onToggle={toggleSidebar}
      />
      <main id="main" tabIndex={-1} className={styles.content}>
        <ErrorBoundaryKeyed routeKey={route.page}>
          <Suspense
            fallback={
              <div className={styles.viewLoading}>
                <Spinner />
              </div>
            }
          >
            <div className={styles.view} key={route.page}>
              {route.page === "dashboard" && <DashboardView />}
              {route.page === "proxies" && <ProxiesView />}
              {route.page === "profiles" && <ProfilesView />}
              {route.page === "connections" && <ConnectionsView />}
              {route.page === "logs" && <LogsView />}
              {route.page === "tools" && <ToolsView />}
              {route.page === "tools/requests" && <RequestsView />}
              {route.page === "tools/dns" && <DnsView />}
              {route.page === "tools/resources" && <ResourcesView />}
              {route.page === "tools/theme" && <ThemeView />}
              {route.page === "tools/backup" && <BackupView />}
              {route.page === "tools/general" && <GeneralView />}
              {route.page === "tools/advanced" && <AdvancedView />}
              {route.page === "tools/rules" && <RulesView />}
              {route.page === "tools/rulesets" && <RuleSetsView />}
              {route.page === "tools/config" && <ManageView />}
              {route.page === "tools/servers" && (
                <ServersView
                  serversState={props.serversState}
                  onServersChange={props.onServersChange}
                />
              )}
              {route.page === "tools/network-quality" && <NetworkQualityView />}
              {route.page === "tools/stun" && <STUNTestView />}
              {route.page === "tools/connectivity" && <ConnectivityTestView />}
            </div>
          </Suspense>
        </ErrorBoundaryKeyed>
      </main>
      {paletteOpen && (
        <CommandPalette commands={commands} onClose={() => setPaletteOpen(false)} />
      )}
      <MobileNav items={mobileItems} activePage={route.page} />
    </div>
  );
}

/* Route-scoped error boundary: a crash in one page does not take the shell down,
   and navigating away remounts a fresh view. */
class ErrorBoundaryKeyed extends Component<{ routeKey: string; children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidUpdate(prevProps: { routeKey: string }) {
    if (prevProps.routeKey !== this.props.routeKey && this.state.error !== null) {
      this.setState({ error: null });
    }
  }

  render() {
    if (this.state.error !== null) {
      return (
        <div className={styles.connectingView}>
          <p className={styles.errorText}>页面出现错误</p>
          <Button variant="primary" onClick={() => this.setState({ error: null })}>
            重试
          </Button>
        </div>
      );
    }
    return this.props.children;
  }
}

function WebApp() {
  const state = useAppState();

  const activeServer =
    state.serversState.servers.find((server) => server.id === state.serversState.activeId) ?? null;

  useEffect(() => {
    if (location.hash !== "") {
      return;
    }
    const last = localStorage.getItem("panel-last-route");
    if (last !== null && ["dashboard", "proxies", "profiles", "connections"].includes(last)) {
      navigate(last);
    }
  }, []);

  useEffect(() => {
    if (!activeServer) {
      return;
    }
    localStorage.setItem("panel-last-route", state.route.page.split("/")[0]);
  }, [activeServer, state.route.page]);

  useEffect(() => {
    if (!activeServer && location.hash !== "") {
      history.replaceState(null, "", location.pathname + location.search);
    }
  }, [activeServer]);

  if (!activeServer) {
    return (
      <>
        <SetupView
          onCreate={(server) => {
            state.updateServers({
              servers: [...state.serversState.servers, server],
              activeId: server.id,
            });
            navigate("dashboard");
          }}
          theme={state.theme}
          onThemeChange={state.updateTheme}
          accent={state.accent}
          onAccentChange={state.updateAccent}
          palette={state.palette}
          onPaletteChange={state.updatePalette}
          amoled={state.amoled}
          onAmoledChange={state.updateAmoled}
        />
        <GlobalErrorDialog />
      </>
    );
  }

  return (
    <>
      <Shell
        key={activeServer.id}
        server={activeServer}
        serversState={state.serversState}
        onServersChange={state.updateServers}
        route={state.route}
        theme={state.theme}
        onThemeChange={state.updateTheme}
        accent={state.accent}
        onAccentChange={state.updateAccent}
        palette={state.palette}
        onPaletteChange={state.updatePalette}
        amoled={state.amoled}
        onAmoledChange={state.updateAmoled}
      />
      <GlobalErrorDialog />
    </>
  );
}
