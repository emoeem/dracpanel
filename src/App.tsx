import {
  lazy,
  Suspense,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";

import {
  loadServersState,
  saveServersState,
  serverDisplayName,
  type Server,
  type ServersState,
} from "./api/config";
import { DaemonApi } from "./api/daemon";
import { formatDateTime, formatUptime, isHttpUrl } from "./api/format";
import { isTerminalCode, useStream } from "./api/stream";
import { ServiceStatus_Type, type DeprecatedWarning } from "./gen/daemon/started_service_pb";
import {
  ApiContext,
  applyAppearance,
  loadAccentPreference,
  loadAmoledPreference,
  loadPalettePreference,
  loadThemePreference,
  navigate,
  saveAccentPreference,
  saveAmoledPreference,
  savePalettePreference,
  saveThemePreference,
  useApi,
  useIsMobile,
  useIsPhone,
  useNow,
  watchSystemTheme,
  type AccentPreference,
  type PalettePreference,
  type ThemePreference,
} from "./app/context";
import { loadDisableDeprecatedWarnings } from "./app/deprecatedWarnings";
import { dismissError, showError, useCurrentError } from "./app/errorStore";
import {
  AUTO_TEST_EVENT,
  loadAutoTestInterval,
  type AutoTestInterval,
} from "./app/groupPreferences";
import { useDismiss, useStreamOutage, useUnaryOnce } from "./app/hooks";
import { I18nProvider, useI18n, type MessageKey } from "./app/i18n";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { Icon, type IconName } from "./components/Icon";
import { CommandPalette, type Command } from "./components/CommandPalette";
import { BottomNav } from "./components/BottomNav";;
import { WebTopbar } from "./components/WebTopbar";
import { ToastProvider } from "./components/Toast";
import { AppearanceMenuContent, Brand, Button, Dialog, IconButton, Spinner, StateDot } from "./components/ui";
import { notify } from "./lib/notifier";
import { useDrawerGestures } from "./app/useDrawerGestures";
import { useHealthMonitor } from "./app/useHealthMonitor";
import { useLatestRef } from "./app/useLatest";
import { PanelGate } from "./panel/PanelGate";
import { ConnectionErrorView } from "./views/ConnectionErrorView";
import { SetupView } from "./views/SetupView";
import styles from "./App.module.css";
import { cx } from "./lib/cx";

// Route views are code-split: a session that only watches the dashboard should
// not have to download the settings editors or the config tools.
const OverviewView = lazy(() =>
  import("./views/OverviewView").then((m) => ({ default: m.OverviewView })),
);
const GroupsView = lazy(() => import("./views/GroupsView").then((m) => ({ default: m.GroupsView })));
const ProfilesView = lazy(() =>
  import("./views/ProfilesView").then((m) => ({ default: m.ProfilesView })),
);
const ConnectionsView = lazy(() =>
  import("./views/ConnectionsView").then((m) => ({ default: m.ConnectionsView })),
);
const RequestsView = lazy(() =>
  import("./views/RequestsView").then((m) => ({ default: m.RequestsView })),
);
const LogsView = lazy(() => import("./views/LogsView").then((m) => ({ default: m.LogsView })));
const RulesView = lazy(() => import("./views/RulesView").then((m) => ({ default: m.RulesView })));
const SpeedTestView = lazy(() =>
  import("./views/SpeedTestView").then((m) => ({ default: m.SpeedTestView })),
);
const ManageView = lazy(() => import("./views/ManageView").then((m) => ({ default: m.ManageView })));
const ToolsView = lazy(() => import("./views/ToolsView").then((m) => ({ default: m.ToolsView })));
const NetworkQualityView = lazy(() =>
  import("./views/ToolsView").then((m) => ({ default: m.NetworkQualityView })),
);
const STUNTestView = lazy(() =>
  import("./views/ToolsView").then((m) => ({ default: m.STUNTestView })),
);
const DnsToolsView = lazy(() =>
  import("./views/DnsToolsView").then((m) => ({ default: m.DnsToolsView })),
);
const ConnectivityTestView = lazy(() =>
  import("./views/ConnectivityTestView").then((m) => ({ default: m.ConnectivityTestView })),
);
const SettingsView = lazy(() =>
  import("./views/SettingsView").then((m) => ({ default: m.SettingsView })),
);
const PreferencesView = lazy(() =>
  import("./views/SettingsView").then((m) => ({ default: m.PreferencesView })),
);
const ServersView = lazy(() =>
  import("./views/SettingsView").then((m) => ({ default: m.ServersView })),
);

export type Route =
  | { page: "dashboard" }
  | { page: "proxies" }
  | { page: "profiles" }
  | { page: "requests" }
  | { page: "connections" }
  | { page: "dns" }
  | { page: "logs" }
  | { page: "rules" }
  | { page: "speedtest" }
  | { page: "system" }
  | { page: "tools" }
  | { page: "tools/network-quality" }
  | { page: "tools/stun" }
  | { page: "tools/connectivity" }
  | { page: "settings" }
  | { page: "settings/preferences" }
  | { page: "settings/servers" };

/** Pre-rename hashes kept working as aliases. */
const ROUTE_ALIASES: Record<string, Route["page"]> = {
  overview: "dashboard",
  groups: "proxies",
  manage: "system",
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
  const aliased = ROUTE_ALIASES[segments[0]] ?? segments[0];
  switch (aliased) {
    case "proxies":
      return { page: "proxies" };
    case "profiles":
      return { page: "profiles" };
    case "requests":
      return { page: "requests" };
    case "dns":
      return { page: "dns" };
    case "connections":
      return { page: "connections" };
    case "logs":
      return { page: "logs" };
    case "rules":
      return { page: "rules" };
    case "speedtest":
      return { page: "speedtest" };
    case "system":
      return { page: "system" };
    case "tools":
      switch (segments[1]) {
        case "network-quality":
          return { page: "tools/network-quality" };
        case "stun":
          return { page: "tools/stun" };
        case "dns":
          // DNS was promoted to a top-level page; keep the old hash working.
          return { page: "dns" };
        case "connectivity":
          return { page: "tools/connectivity" };
        default:
          return { page: "tools" };
      }
    case "settings":
      switch (segments[1]) {
        case "preferences":
          return { page: "settings/preferences" };
        case "servers":
          return { page: "settings/servers" };
        default:
          return { page: "settings" };
      }
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

  const appearanceRef = useRef({ theme, accent, palette, amoled });
  appearanceRef.current = { theme, accent, palette, amoled };

  useEffect(
    () =>
      watchSystemTheme(() => {
        const current = appearanceRef.current;
        applyAppearance(current.theme, current.accent, current.palette, current.amoled);
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

function WebApp() {
  const state = useAppState();

  const activeServer =
    state.serversState.servers.find((server) => server.id === state.serversState.activeId) ?? null;

  useEffect(() => {
    if (location.hash !== "") {
      return;
    }
    const last = localStorage.getItem("panel-last-route");
    if (
      last !== null &&
      ["dashboard", "proxies", "connections", "logs", "rules", "speedtest", "settings", "system"].includes(last)
    ) {
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
    );
  }

  return (
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
  );
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
      {/* Error strings are raised as English text; translate the ones we know
          about and pass anything else (backend messages) through unchanged. */}
      <p className="dialog-message">{t(message as MessageKey)}</p>
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
  const api = useMemo(
    () => new DaemonApi(props.server, language),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [props.server, language, generation],
  );
  return (
    <ApiContext.Provider value={api}>
      <ShellContent {...props} onRetry={() => setGeneration(generation + 1)} />
    </ApiContext.Provider>
  );
}

function ShellContent(props: ShellProps & { onRetry: () => void }) {
  const api = useApi();
  const { t } = useI18n();
  const translateRef = useLatestRef(t);
  const route = props.route;
  const serviceStatus = useStream(api.serviceStatus);
  const groups = useStream(api.groups);
  const [autoTestInterval, setAutoTestInterval] = useState<AutoTestInterval>(() =>
    loadAutoTestInterval(api.config.id),
  );
  const [menuOpen, setMenuOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [appearanceOpen, setAppearanceOpen] = useState(false);
  const appearanceRef = useRef<HTMLDivElement>(null);
  useDismiss(appearanceRef, appearanceOpen, () => setAppearanceOpen(false));
  const reportedFatalError = useRef<string | null>(null);
  const sidebarRef = useRef<HTMLElement | null>(null);
  const isMobile = useIsMobile();
  const isPhone = useIsPhone();
  const drawerGestures = useDrawerGestures({
    open: menuOpen,
    enabled: isMobile,
    drawerRef: sidebarRef,
    onOpenChange: setMenuOpen,
  });

  useEffect(() => {
    const refresh = () => setAutoTestInterval(loadAutoTestInterval(api.config.id));
    window.addEventListener(AUTO_TEST_EVENT, refresh);
    return () => window.removeEventListener(AUTO_TEST_EVENT, refresh);
  }, [api.config.id]);

  const serviceStatusType = serviceStatus.data.status?.status;
  const fatalError =
    serviceStatusType === ServiceStatus_Type.FATAL
      ? serviceStatus.data.status?.errorMessage || t("Service failed to start")
      : null;
  useEffect(() => {
    if (fatalError === null) {
      reportedFatalError.current = null;
      return;
    }
    if (reportedFatalError.current !== fatalError) {
      reportedFatalError.current = fatalError;
      showError(fatalError);
      notify("service", translateRef.current("Fatal sing-box core error"), fatalError);
    }
  }, [fatalError, translateRef]);

  const lostError = useStreamOutage(
    serviceStatus,
    isTerminalCode(serviceStatus.errorCode) || serviceStatus.data.status === null,
  );

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

  const reachable = serviceStatus.phase === "active";
  const serverInfo = useUnaryOnce(() => api.serverInfo(), reachable);

  useEffect(() => {
    setMenuOpen(false);
  }, [route]);

  const started = serviceStatusType === ServiceStatus_Type.STARTED;
  const hasGroups = started && groups.data.loaded && groups.data.groups.length > 0;

  const health = useHealthMonitor({
    api,
    serverId: api.config.id,
    intervalMs: autoTestInterval === "off" ? 0 : Number(autoTestInterval) * 60_000,
    active: started,
    groups: groups.data.groups,
    histories: groups.data.latencyHistory,
  });
  const known = serviceStatus.phase !== "connecting" || serviceStatus.data.status !== null;

  const groupsKnown = groups.data.loaded || groups.phase === "error";
  useEffect(() => {
    if (!known) {
      return;
    }
    const invisible =
      (route.page === "proxies" && (!started || (groupsKnown && !hasGroups))) ||
      (route.page === "connections" && !started);
    if (invisible) {
      navigate("dashboard");
    }
  }, [known, started, groupsKnown, hasGroups, route]);

  useEffect(() => {
    const pages: Record<string, string> = {
      "1": "dashboard",
      "2": "proxies",
      "3": "connections",
      "4": "logs",
      "5": "rules",
      "6": "speedtest",
      "7": "settings",
      "8": "system",
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

  // ⌘K / Ctrl+K toggles the command palette from anywhere, including text fields,
  // where the Ctrl+1…8 page shortcuts deliberately do not fire.
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

  // Declared before the early returns below so the hook order stays stable.
  const commands = useMemo<Command[]>(() => {
    const go = (id: string, label: string, page: string, icon: IconName, hint?: string) => ({
      id,
      label,
      group: t("Navigate"),
      icon,
      hint,
      keywords: page,
      run: () => {
        setMenuOpen(false);
        navigate(page);
      },
    });
    const items: Command[] = [
      go("nav-dashboard", t("Dashboard"), "dashboard", "dashboard", "Ctrl+1"),
      go("nav-proxies", t("Proxies"), "proxies", "folder", "Ctrl+2"),
      go("nav-profiles", t("Profiles"), "profiles", "cloud_sync"),
      go("nav-requests", t("Requests"), "requests", "swap_vert"),
      go("nav-connections", t("Connections"), "connections", "swap_vert", "Ctrl+3"),
      go("nav-logs", t("Logs"), "logs", "text_snippet", "Ctrl+4"),
      go("nav-rules", t("Rules"), "rules", "filter_list", "Ctrl+5"),
      go("nav-speedtest", t("Speed Test"), "speedtest", "speed", "Ctrl+6"),
      go("nav-settings", t("Settings"), "settings", "settings", "Ctrl+7"),
      go("nav-system", t("System"), "system", "tune", "Ctrl+8"),
      go("nav-tools", t("Tools"), "tools", "terminal"),
      go("nav-tools-network-quality", t("Network Quality"), "tools/network-quality", "network_check"),
      go("nav-tools-stun", t("STUN Test"), "tools/stun", "hub"),
      go("nav-dns", t("DNS"), "dns", "dns"),
      go("nav-tools-connectivity", t("Connectivity Test"), "tools/connectivity", "cable"),
    ];
    if (started) {
      items.push({
        id: "action-clear-logs",
        label: t("Clear Logs"),
        group: t("Actions"),
        icon: "delete",
        run: () => {
          void api.clearLogs().catch(showError);
        },
      });
    }
    return items;
  }, [api, started, t]);

  if (lostError !== null && route.page !== "system") {
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

  if (serviceStatus.data.status === null && route.page !== "system") {
    return (
      <div className={styles.connectingView}>
        <Brand className={styles.connectingBrand} />
        <Spinner className={styles.connectingSpinner} />
      </div>
    );
  }

  const navItem = (
    page: string,
    title: string,
    icon: IconName,
    active: boolean,
    accessory?: ReactNode,
  ) => (
    <button
      type="button"
      key={page}
      className={cx(styles.navItem, active && styles.active)}
      onClick={() => {
        setMenuOpen(false);
        navigate(page);
      }}
    >
      <Icon name={icon} />
      {title}
      {accessory}
    </button>
  );

  const mainPages = (
    <>
      {navItem("logs", t("Logs"), "text_snippet", route.page === "logs")}
      {navItem("rules", t("Rules"), "filter_list", route.page === "rules")}
      {started && navItem("speedtest", t("Speed Test"), "speed", route.page === "speedtest")}
      {navItem("tools", t("Tools"), "terminal", route.page.startsWith("tools"))}
      {navItem("settings", t("Settings"), "settings", route.page.startsWith("settings"))}
      {navItem("system", t("System"), "tune", route.page === "system")}
    </>
  );

  const skipToContent = (event: { preventDefault: () => void }) => {
    // preventDefault keeps the hash router out of it; #main is not a route.
    event.preventDefault();
    document.getElementById("main")?.focus();
  };

  const mainContent = (
    <>
      <a className="sr-only skip-link" href="#main" onClick={skipToContent}>
        {t("Skip to content")}
      </a>
      <main id="main" tabIndex={-1} className={styles.content}>
      <ErrorBoundary key={route.page}>
        <Suspense
          fallback={
            <div className={styles.viewLoading}>
              <Spinner />
            </div>
          }
        >
          {route.page === "dashboard" && <OverviewView />}
          {route.page === "proxies" && <GroupsView />}
          {route.page === "profiles" && <ProfilesView />}
          {route.page === "requests" && <RequestsView />}
          {route.page === "connections" && <ConnectionsView />}
          {route.page === "dns" && <DnsToolsView />}
          {route.page === "logs" && <LogsView />}
          {route.page === "rules" && <RulesView />}
          {route.page === "speedtest" && <SpeedTestView />}
          {route.page === "system" && <ManageView />}
          {route.page === "tools" && <ToolsView />}
          {route.page === "tools/network-quality" && <NetworkQualityView />}
          {route.page === "tools/stun" && <STUNTestView />}
          {route.page === "tools/connectivity" && <ConnectivityTestView />}
          {route.page === "settings" && <SettingsView />}
          {route.page === "settings/preferences" && (
            <PreferencesView
              theme={props.theme}
              onThemeChange={props.onThemeChange}
              accent={props.accent}
              onAccentChange={props.onAccentChange}
              palette={props.palette}
              onPaletteChange={props.onPaletteChange}
              amoled={props.amoled}
              onAmoledChange={props.onAmoledChange}
            />
          )}
          {route.page === "settings/servers" && (
            <ServersView serversState={props.serversState} onServersChange={props.onServersChange} />
          )}
        </Suspense>
      </ErrorBoundary>
      </main>
    </>
  );

  return (
    <div
      className={cx(styles.app, styles.webApp, isPhone && styles.withBottomNav)}
      {...(isMobile ? drawerGestures : {})}
    >
      {paletteOpen && (
        <CommandPalette commands={commands} onClose={() => setPaletteOpen(false)} />
      )}
      <header className={styles.mobileTopbar}>
        {!isPhone && (
          <IconButton
            aria-label={t("Toggle navigation")}
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen(!menuOpen)}
          >
            <Icon name={menuOpen ? "close" : "menu"} size={18} />
          </IconButton>
        )}
        <div className={styles.mobileTopbarBrand}>DracPanel</div>
        <div className={styles.mobileTopbarActions}>
          <div className="menu-anchor" ref={appearanceRef}>
            <IconButton
              aria-label={t("Appearance")}
              aria-expanded={appearanceOpen}
              onClick={() => setAppearanceOpen(!appearanceOpen)}
            >
              <Icon name="palette" size={18} />
            </IconButton>
            {appearanceOpen && (
              <div className="menu align-right accent-menu">
                <AppearanceMenuContent
                  theme={props.theme}
                  onThemeChange={props.onThemeChange}
                  accent={props.accent}
                  onChangeAccent={(accent) => props.onAccentChange(accent)}
                  palette={props.palette}
                  onPaletteChange={props.onPaletteChange}
                  amoled={props.amoled}
                  onAmoledChange={props.onAmoledChange}
                />
              </div>
            )}
          </div>
        </div>
      </header>
      {menuOpen && (
        <button
          type="button"
          className={styles.sidebarScrim}
          aria-label={t("Close")}
          onClick={() => setMenuOpen(false)}
        />
      )}
      <nav ref={sidebarRef} className={cx(styles.sidebar, menuOpen && styles.open)}>
        <div className={styles.sidebarBrand}>
          DracPanel
          {serverInfo && <span className={styles.sidebarBrandVersion}>{serverInfo.version}</span>}
        </div>
        {navItem("dashboard", t("Dashboard"), "dashboard", route.page === "dashboard")}
        {hasGroups && navItem("proxies", t("Proxies"), "folder", route.page === "proxies")}
        {navItem("profiles", t("Profiles"), "cloud_sync", route.page === "profiles")}
        {started && navItem("requests", t("Requests"), "swap_vert", route.page === "requests")}
        {started && navItem("connections", t("Connections"), "swap_vert", route.page === "connections")}
        {started && navItem("dns", t("DNS"), "dns", route.page === "dns")}
        {mainPages}
        {health.summary.down > 0 && (
          <div className={styles.healthAlert} role="status">
            <Icon name="warning_amber" size={14} />
            {t("{count} nodes unavailable", { count: health.summary.down })}
          </div>
        )}
        <ServerPicker
          serversState={props.serversState}
          onServersChange={props.onServersChange}
          connected={reachable}
          started={started}
        />
      </nav>
      <div className={styles.webColumn}>
        <WebTopbar
          version={serverInfo?.version ?? null}
          theme={props.theme}
          onThemeChange={props.onThemeChange}
          accent={props.accent}
          onAccentChange={props.onAccentChange}
          palette={props.palette}
          onPaletteChange={props.onPaletteChange}
          amoled={props.amoled}
          onAmoledChange={props.onAmoledChange}
        />
        {mainContent}
      </div>
      {serviceStatus.phase !== "active" && (
        <div className={styles.reconnectPill} role="status">
          <Spinner />
          {t("Reconnecting...")}
        </div>
      )}
      {started && <DeprecatedWarningsGate />}
      {isPhone && (
        <BottomNav
          active={
            route.page === "dashboard"
              ? "dashboard"
              : route.page === "proxies"
                ? "proxies"
                : route.page === "connections"
                  ? "connections"
                  : route.page === "logs"
                    ? "logs"
                    : "more"
          }
          onSelect={(target) => {
            if (target === "more") {
              setMenuOpen(true);
              return;
            }
            navigate(target);
          }}
        />
      )}
    </div>
  );
}

function ServerPicker(props: {
  serversState: ServersState;
  onServersChange: (state: ServersState) => void;
  connected: boolean;
  started: boolean;
}) {
  const { t } = useI18n();
  const { servers, activeId } = props.serversState;
  const active = servers.find((server) => server.id === activeId);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useDismiss(ref, open, () => setOpen(false));

  if (!active) {
    return null;
  }

  return (
    <div className={styles.serverPicker} ref={ref}>
      <button type="button" className={styles.serverPickerButton} aria-expanded={open} onClick={() => setOpen(!open)}>
        <span className={styles.serverPickerText}>
          <span className={styles.serverPickerLine}>
            <StateDot tone={props.connected ? "good" : undefined} className={styles.serverDot} />
            <span className={styles.serverName}>{serverDisplayName(active)}</span>
          </span>
          {props.started && <ServerUptime />}
        </span>
        <Icon name="unfold_more" size={13} />
      </button>
      {open && (
        <div className="menu open-up">
          {servers.map((server) => (
            <button
              type="button"
              key={server.id}
              className="menu-item"
              onClick={() => {
                setOpen(false);
                if (server.id !== activeId) {
                  props.onServersChange({ ...props.serversState, activeId: server.id });
                }
              }}
            >
              <span className="menu-check">{server.id === activeId && <Icon name="check" size={13} />}</span>
              {serverDisplayName(server)}
            </button>
          ))}
          <div className="menu-divider" />
          <button
            type="button"
            className="menu-item"
            onClick={() => {
              setOpen(false);
              navigate("settings/servers");
            }}
          >
            <span className="menu-check">
              <Icon name="settings" size={13} />
            </span>
            {t("Manage servers...")}
          </button>
        </div>
      )}
    </div>
  );
}

function ServerUptime() {
  const api = useApi();
  const { t, language } = useI18n();
  const now = useNow();
  const startedAt = useUnaryOnce(() => api.getStartedAt());

  if (startedAt === null) {
    return null;
  }
  return (
    <span className={styles.serverUptime} title={`${t("Uptime")} — ${formatDateTime(startedAt, language)}`}>
      <Icon name="power_settings_new" size={10} />
      {formatUptime(startedAt, now)}
    </span>
  );
}

function DeprecatedWarningsGate() {
  const api = useApi();
  const warnings = useUnaryOnce(() => api.getDeprecatedWarnings());
  const [index, setIndex] = useState(0);
  const [visible, setVisible] = useState(true);

  if (loadDisableDeprecatedWarnings()) {
    return null;
  }

  const current = warnings?.[index];
  if (!current || !visible) {
    return null;
  }

  return (
    <DeprecatedWarningDialog
      warning={current}
      onDismiss={() => {
        setVisible(false);
        setTimeout(() => {
          setIndex((value) => value + 1);
          setVisible(true);
        }, 300);
      }}
    />
  );
}

function DeprecatedWarningDialog(props: { warning: DeprecatedWarning; onDismiss: () => void }) {
  const { t } = useI18n();
  return (
    <Dialog onClose={props.onDismiss}>
      <h3>{t("Deprecated Warning")}</h3>
      <p className="dialog-message">{props.warning.message}</p>
      <div className="row-actions dialog-actions">
        <Button onClick={props.onDismiss}>
          {t("Ok")}
        </Button>
        {isHttpUrl(props.warning.migrationLink) && (
          <Button
            variant="primary"
            href={props.warning.migrationLink}
            target="_blank"
            rel="noreferrer"
            onClick={props.onDismiss}
          >
            {t("Documentation")}
          </Button>
        )}
      </div>
    </Dialog>
  );
}
