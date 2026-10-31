import { useCallback, useEffect, useMemo, useState } from "react";

import type { DaemonApi } from "../api/daemon";
import {
  applyPanelConfig,
  getPanelConfig,
  getSystemProxy,
  hasPanelToken,
  setSystemProxy,
  validatePanelConfig,
  type PanelState,
  type PanelResult,
} from "../api/panel";
import {
  appendTunInbound,
  lanProxyInfo,
  removeTunInbounds,
  setLanProxyEnabled,
} from "../lib/flclash/configEdit";
import { loadTunPreset, saveTunPreset } from "../lib/flclash/tunPreset";
import { afterConfigChange } from "./configResync";
import { showError } from "./errorStore";
import type { PanelStateResult } from "./usePanelState";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function validateAndApply(api: DaemonApi, text: string): Promise<PanelResult> {
  const validation = await validatePanelConfig(text);
  if (!validation.ok) {
    throw new Error(validation.message || "配置校验失败，未应用");
  }
  const result = await applyPanelConfig(text);
  if (!result.ok) {
    throw new Error(result.message || "配置应用失败，面板已回滚");
  }
  await afterConfigChange(api);
  return result;
}

export interface SystemProxyControl {
  supported: boolean;
  enabled: boolean;
  port: number | null;
  busy: boolean;
  toggle: (enabled: boolean) => Promise<void>;
  refresh: () => Promise<void>;
}

/** System proxy is an OS-level action and therefore requires the panel API. */
export function useSystemProxy(): SystemProxyControl {
  const [state, setState] = useState({
    supported: hasPanelToken(),
    enabled: false,
    port: null as number | null,
    busy: true,
  });

  const refresh = useCallback(async () => {
    if (!hasPanelToken()) {
      setState({ supported: false, enabled: false, port: null, busy: false });
      return;
    }
    try {
      const feature = await getSystemProxy();
      if (!feature.supported) {
        setState({ supported: false, enabled: false, port: null, busy: false });
        return;
      }
      setState({
        supported: true,
        enabled: feature.value?.enabled ?? false,
        port: typeof feature.value?.port === "number" ? feature.value.port : null,
        busy: false,
      });
    } catch {
      setState({ supported: false, enabled: false, port: null, busy: false });
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const toggle = useCallback(
    async (enabled: boolean) => {
      setState((current) => ({ ...current, enabled, busy: true }));
      try {
        const result = await setSystemProxy(enabled);
        if (!result.ok) {
          throw new Error(result.message || "系统代理设置失败");
        }
        await refresh();
      } catch (error) {
        setState((current) => ({ ...current, enabled: !enabled, busy: false }));
        showError(error);
      }
    },
    [refresh],
  );

  return { ...state, toggle, refresh };
}

export interface ConfigToggleControl {
  supported: boolean;
  enabled: boolean;
  port: number | null;
  busy: boolean;
  pending: boolean | null;
  request: (enabled: boolean) => void;
  confirm: () => Promise<void>;
  cancel: () => void;
  reason: string | null;
  /** 流量由配置中的 ebpf 入站接管（reF1nd fork 数据面）。 */
  ebpfMode?: boolean;
}

/** TUN is toggled by removing/restoring the inbound through the config API. */
export function useTunControl(api: DaemonApi, panel: PanelStateResult): ConfigToggleControl {
  const inbounds = panel.state?.inbounds ?? [];
  const installed = inbounds.includes("tun");
  const ebpfMode = inbounds.includes("ebpf");
  const configPath = panel.state?.config_path ?? null;
  const preset = useMemo(
    () => (hasPanelToken() ? loadTunPreset(api.config.id, configPath) : null),
    [api.config.id, configPath],
  );
  const [enabled, setEnabled] = useState(installed);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<boolean | null>(null);

  useEffect(() => {
    setEnabled(installed);
  }, [installed]);

  const reason = !hasPanelToken()
    ? "直接模式无法修改虚拟网卡"
    : ebpfMode
      ? "eBPF 模式下流量由内核 ebpf 入站接管；如需 TUN 请在配置编辑器中调整"
      : !enabled && preset === null
        ? "配置中没有可恢复的 TUN 入站"
        : null;

  const request = (next: boolean) => {
    if (!hasPanelToken()) {
      showError(new Error("直接模式无法修改虚拟网卡"));
      return;
    }
    if (next && !enabled && preset === null) {
      showError(new Error("配置中没有可恢复的 TUN 入站；请先在配置编辑器中添加 tun inbound"));
      return;
    }
    setPending(next);
  };

  const confirm = async () => {
    if (pending === null) {
      return;
    }
    setBusy(true);
    try {
      const config = await getPanelConfig();
      if (!config.ok) {
        throw new Error("读取配置失败");
      }
      const nextText = pending
        ? (() => {
            const stored =
              loadTunPreset(api.config.id, config.path ?? configPath) ??
              loadTunPreset(api.config.id, configPath);
            if (stored === null) {
              throw new Error("没有可恢复的 TUN 入站预设");
            }
            return appendTunInbound(config.text, stored.inbound);
          })()
        : (() => {
            const result = removeTunInbounds(config.text);
            if (result.removed.length === 0) {
              throw new Error("当前配置中没有 TUN 入站");
            }
            saveTunPreset(api.config.id, config.path ?? configPath, result.removed[0]);
            return result.text;
          })();
      await validateAndApply(api, nextText);
      setEnabled(pending);
      setPending(null);
      panel.refresh();
    } catch (error) {
      showError(new Error(errorMessage(error)));
    } finally {
      setBusy(false);
    }
  };

  return {
    supported: hasPanelToken(),
    enabled,
    port: null,
    busy,
    pending,
    request,
    confirm,
    cancel: () => setPending(null),
    reason,
    ebpfMode,
  };
}

/** LAN proxy changes the first mixed/http/socks inbound's listen address. */
export function useLanControl(api: DaemonApi): ConfigToggleControl {
  const [enabled, setEnabled] = useState(false);
  const [port, setPort] = useState<number | null>(null);
  const [supported, setSupported] = useState(hasPanelToken());
  const [busy, setBusy] = useState(true);
  const [pending, setPending] = useState<boolean | null>(null);

  const refresh = useCallback(async () => {
    if (!hasPanelToken()) {
      setSupported(false);
      setBusy(false);
      return;
    }
    try {
      const config = await getPanelConfig();
      const info = lanProxyInfo(config.text);
      setSupported(info.inboundType !== null);
      setEnabled(info.enabled);
      setPort(info.port);
    } catch {
      setSupported(false);
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const request = (next: boolean) => {
    if (!supported) {
      showError(new Error("配置中没有可切换的 mixed/http/socks 入站"));
      return;
    }
    setPending(next);
  };

  const confirm = async () => {
    if (pending === null) {
      return;
    }
    setBusy(true);
    try {
      const config = await getPanelConfig();
      if (!config.ok) {
        throw new Error("读取配置失败");
      }
      const nextText = setLanProxyEnabled(config.text, pending);
      await validateAndApply(api, nextText);
      setEnabled(pending);
      setPending(null);
      await refresh();
    } catch (error) {
      showError(new Error(errorMessage(error)));
    } finally {
      setBusy(false);
    }
  };

  return {
    supported,
    enabled,
    port,
    busy,
    pending,
    request,
    confirm,
    cancel: () => setPending(null),
    reason: !hasPanelToken()
      ? "直接模式无法修改局域网代理"
      : !supported
        ? "配置中没有可切换的 mixed/http/socks 入站"
        : null,
  };
}

export interface TunStateInfo {
  installed: boolean;
  presetAvailable: boolean;
}

export function tunStateOf(
  panelState: PanelState | null,
  serverId: string,
): TunStateInfo {
  return {
    installed: (panelState?.inbounds ?? []).includes("tun"),
    presetAvailable: loadTunPreset(serverId, panelState?.config_path ?? null) !== null,
  };
}
