import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";

import {
  ensureNativeServer,
  getPanelState,
  getPanelToken,
  clearPanelToken,
  serviceAction,
  setPanelToken,
  PanelAuthError,
  type PanelState,
} from "../api/panel";
import styles from "./PanelGate.module.css";

type Phase = "checking" | "gate" | "error" | "recovery" | "ready";

function DraculaMark() {
  return (
    <svg className={styles.mark} viewBox="0 0 64 64" aria-hidden="true">
      <rect width="64" height="64" rx="14" fill="var(--surface)" />
      <path d="M32 8l18 10.4v20.8L32 49.6 14 39.2V18.4z" fill="none" stroke="var(--accent)" strokeWidth="3" />
      <path d="M32 19l10 5.8v11.6L32 42.2l-10-5.8V24.8z" fill="var(--accent)" />
      <circle cx="32" cy="31" r="3.2" fill="var(--info)" />
    </svg>
  );
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function PanelGate(props: { children: ReactNode }) {
  const [phase, setPhase] = useState<Phase>(() => (getPanelToken() ? "checking" : "gate"));
  const [message, setMessage] = useState("");
  const [tokenInput, setTokenInput] = useState("");
  const [state, setState] = useState<PanelState | null>(null);
  const [busy, setBusy] = useState(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const bootstrap = useCallback(async () => {
    setBusy(true);
    setMessage("");
    try {
      const current = await getPanelState();
      if (!mounted.current) {
        return;
      }
      setState(current);
      await ensureNativeServer();
      if (!mounted.current) {
        return;
      }
      if (current.service && !current.service.active) {
        setPhase("recovery");
      } else {
        setPhase("ready");
      }
    } catch (error) {
      if (!mounted.current) {
        return;
      }
      if (error instanceof PanelAuthError) {
        clearPanelToken();
        setPhase("gate");
        setMessage("令牌无效或已失效，请重新输入。");
      } else {
        setPhase("error");
        setMessage(error instanceof Error ? error.message : String(error));
      }
    } finally {
      if (mounted.current) {
        setBusy(false);
      }
    }
  }, []);

  useEffect(() => {
    if (getPanelToken()) {
      void bootstrap();
    }
  }, [bootstrap]);

  useEffect(() => {
    const onAuthError = () => {
      clearPanelToken();
      setPhase("gate");
      setMessage("面板令牌已失效，请重新登录。");
    };
    window.addEventListener("panel-auth-error", onAuthError);
    return () => window.removeEventListener("panel-auth-error", onAuthError);
  }, []);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const token = tokenInput.trim();
    if (token === "") {
      setMessage("请输入访问令牌。");
      return;
    }
    setPanelToken(token);
    setTokenInput("");
    void bootstrap();
  };

  const runServiceAction = async (action: "start" | "restart") => {
    setBusy(true);
    setMessage("");
    try {
      const result = await serviceAction(action);
      if (!result.ok) {
        setMessage(result.message ?? "服务操作失败");
        return;
      }
      for (let attempt = 0; attempt < 45; attempt += 1) {
        await sleep(1000);
        const current = await getPanelState();
        if (!mounted.current) {
          return;
        }
        setState(current);
        if (current.service?.active) {
          setPhase("checking");
          await bootstrap();
          return;
        }
      }
      setMessage("服务启动超时，请查看面板日志。");
    } catch (error) {
      if (error instanceof PanelAuthError) {
        return;
      }
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      if (mounted.current) {
        setBusy(false);
      }
    }
  };

  if (phase === "ready") {
    return <>{props.children}</>;
  }

  return (
    <div className={styles.screen}>
      <div className={styles.glow} aria-hidden="true" />
      <div className={styles.card}>
        <div className={styles.brandRow}>
          <DraculaMark />
          <div>
            <h1 className={styles.title}>Dracula Panel</h1>
            <p className={styles.subtitle}>for sing-box</p>
          </div>
        </div>

        {phase === "checking" && (
          <div className={styles.center}>
            <span className={styles.spinner} aria-hidden="true" />
            <p className={styles.muted}>正在校验面板令牌并同步原生 API…</p>
          </div>
        )}

        {phase === "gate" && (
          <form onSubmit={submit} className={styles.form}>
            <label className={styles.field}>
              <span>访问令牌</span>
              <input
                type="password"
                autoFocus
                value={tokenInput}
                onChange={(event) => setTokenInput(event.target.value)}
                placeholder="粘贴 sing-box-panel 访问令牌"
                autoComplete="current-password"
                spellCheck={false}
              />
            </label>
            <button type="submit" className={styles.primary} disabled={busy}>
              {busy ? "正在登录…" : "进入面板"}
            </button>
            <p className={styles.hint}>
              令牌位于 <code>/var/lib/sing-box-panel/token</code>，可用 <code>sudo cat</code> 查看。
            </p>
            {message !== "" && <p className={styles.error}>{message}</p>}
          </form>
        )}

        {phase === "error" && (
          <div className={styles.form}>
            <p className={styles.error}>{message}</p>
            <div className={styles.actions}>
              <button type="button" className={styles.primary} onClick={() => void bootstrap()} disabled={busy}>
                重试
              </button>
              <button
                type="button"
                className={styles.secondary}
                onClick={() => {
                  clearPanelToken();
                  setPhase("gate");
                }}
              >
                重新登录
              </button>
            </div>
          </div>
        )}

        {phase === "recovery" && (
          <div className={styles.form}>
            <div className={styles.recoveryStatus}>
              <span className={styles.dotOffline} aria-hidden="true" />
              <div>
                <strong>sing-box 核心未运行</strong>
                <p className={styles.muted}>
                  {state?.service?.active === false ? "服务已停止，启动后即可进入控制台。" : "正在等待核心就绪…"}
                </p>
              </div>
            </div>
            {state?.version && <p className={styles.hint}>内核版本：{state.version}</p>}
            {state?.config_path && <p className={styles.hint}>配置：{state.config_path}</p>}
            <div className={styles.actions}>
              <button type="button" className={styles.primary} onClick={() => void runServiceAction("start")} disabled={busy}>
                启动核心
              </button>
              <button type="button" className={styles.secondary} onClick={() => void runServiceAction("restart")} disabled={busy}>
                重启核心
              </button>
            </div>
            {message !== "" && <p className={styles.error}>{message}</p>}
          </div>
        )}

        {phase !== "gate" && phase !== "checking" && (
          <p className={styles.footerLink}>
            <a href="/dash/" target="_blank" rel="noreferrer">
              回退面板
            </a>
            <span aria-hidden="true"> · </span>
            <button
              type="button"
              className={styles.textButton}
              onClick={() => {
                clearPanelToken();
                setPhase("gate");
              }}
            >
              切换令牌
            </button>
          </p>
        )}
      </div>
    </div>
  );
}
