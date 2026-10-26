import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";

import {
  ensureNativeServer,
  getPanelState,
  getPanelToken,
  lockPanel,
  PANEL_TOKEN_KEY,
  serviceAction,
  setPanelToken,
  PanelAuthError,
  type PanelState,
} from "../api/panel";
import {
  detectPanelCapabilities,
  PanelCapabilitiesContext,
  unknownPanelCapabilities,
  type PanelCapabilities,
} from "../api/panelCapabilities";
import {
  clearLoginThrottle,
  noteLoginFailure,
  readLoginThrottle,
  throttleLockRemaining,
} from "./loginThrottle";
import { useI18n, type Translate } from "../app/i18n";
import { useLatestRef } from "../app/useLatest";
import { loadStoredString, removeStoredValue, saveStoredString } from "../lib/storage";
import styles from "./PanelGate.module.css";

type Phase = "checking" | "gate" | "error" | "recovery" | "ready";

/** Direct mode: talk to the sing-box API service without the privileged panel. */
const DIRECT_MODE_KEY = "direct-mode";

function directModeActive(): boolean {
  return getPanelToken() === "" && loadStoredString(DIRECT_MODE_KEY) === "true";
}

function lockMessage(t: Translate, remaining: number): string {
  return t("Too many attempts, retry in {seconds} seconds.", {
    seconds: Math.ceil(remaining / 1000),
  });
}

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
  const { t } = useI18n();
  const translateRef = useLatestRef(t);
  const [phase, setPhase] = useState<Phase>(() =>
    getPanelToken() ? "checking" : directModeActive() ? "ready" : "gate",
  );
  const [directMode, setDirectMode] = useState(() => directModeActive());
  const [message, setMessage] = useState("");
  const [tokenInput, setTokenInput] = useState("");
  const [state, setState] = useState<PanelState | null>(null);
  const [capabilities, setCapabilities] = useState<PanelCapabilities>(() =>
    unknownPanelCapabilities(),
  );
  const [busy, setBusy] = useState(false);
  const [lockRemaining, setLockRemaining] = useState(() =>
    throttleLockRemaining(readLoginThrottle(), Date.now()),
  );
  const mounted = useRef(true);
  const locked = lockRemaining > 0;

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    if (!locked) {
      return;
    }
    const timer = setInterval(() => {
      const remaining = throttleLockRemaining(readLoginThrottle(), Date.now());
      setLockRemaining(remaining);
      if (remaining === 0) {
        setMessage("");
      }
    }, 1000);
    return () => clearInterval(timer);
  }, [locked]);

  const bootstrap = useCallback(async () => {
    setBusy(true);
    setMessage("");
    try {
      const current = await getPanelState();
      if (!mounted.current) {
        return;
      }
      setState(current);
      // The recovery screen only needs the panel API. Do not let a failed
      // native bootstrap (unreadable config, missing services.api) hide the
      // start/restart controls when we already know the core is stopped.
      if (current.service && !current.service.active) {
        setPhase("recovery");
        return;
      }
      await ensureNativeServer({ state: current });
      if (!mounted.current) {
        return;
      }
      setCapabilities(unknownPanelCapabilities());
      setPhase("ready");
      clearLoginThrottle();
      // Do not make login wait for the probes; unknown capabilities stay
      // optimistic until the backend list or probe results arrive.
      void detectPanelCapabilities(current)
        .then((next) => {
          if (mounted.current) {
            setCapabilities(next);
          }
        })
        .catch(() => {});
    } catch (error) {
      if (!mounted.current) {
        return;
      }
      if (error instanceof PanelAuthError) {
        lockPanel();
        const remaining = throttleLockRemaining(noteLoginFailure(), Date.now());
        setPhase("gate");
        setLockRemaining(remaining);
        setMessage(
          remaining > 0
            ? lockMessage(translateRef.current, remaining)
            : translateRef.current("The token is invalid or expired. Please enter it again."),
        );
      } else {
        setPhase("error");
        setMessage(error instanceof Error ? error.message : String(error));
      }
    } finally {
      if (mounted.current) {
        setBusy(false);
      }
    }
  }, [translateRef]);

  useEffect(() => {
    if (getPanelToken()) {
      void bootstrap();
    }
  }, [bootstrap]);

  useEffect(() => {
    const onAuthError = () => {
      lockPanel();
      setPhase("gate");
      setMessage(t("The panel token expired. Please sign in again."));
    };
    window.addEventListener("panel-auth-error", onAuthError);
    return () => window.removeEventListener("panel-auth-error", onAuthError);
  }, [t]);

  useEffect(() => {
    // Locking in one tab removes panel_token; reload every other tab so no
    // in-memory native connection survives behind the lock screen.
    const onStorage = (event: StorageEvent) => {
      if (event.key === PANEL_TOKEN_KEY && event.newValue === null) {
        window.location.reload();
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const remaining = throttleLockRemaining(readLoginThrottle(), Date.now());
    if (remaining > 0) {
      setLockRemaining(remaining);
      setMessage(lockMessage(t, remaining));
      return;
    }
    const token = tokenInput.trim();
    if (token === "") {
      setMessage(t("Enter the access token."));
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
        setMessage(result.message ?? t("Service action failed"));
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
      setMessage(
        t("The service did not start in time; check the system log: journalctl -u sing-box."),
      );
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

  const fallbackUrl = state?.zash_setup_url ?? "/dash/";
  const showFallback = state?.zashboard_available !== false;

  if (phase === "ready") {
    return (
      <PanelCapabilitiesContext.Provider value={capabilities}>
        {props.children}
      </PanelCapabilitiesContext.Provider>
    );
  }

  return (
    <div className={styles.screen}>
      <div className={styles.glow} aria-hidden="true" />
      <div className={styles.card}>
        <div className={styles.brandRow}>
          <DraculaMark />
          <div>
            <h1 className={styles.title}>DracPanel</h1>
            <p className={styles.subtitle}>for sing-box</p>
          </div>
        </div>

        {phase === "checking" && (
          <div className={styles.center}>
            <span className={styles.spinner} aria-hidden="true" />
            <p className={styles.muted}>
              {t("Verifying the panel token and syncing the native API…")}
            </p>
          </div>
        )}

        {phase === "gate" && (
          <form onSubmit={submit} className={styles.form}>
            <label className={styles.field}>
              <span>{t("Access token")}</span>
              <input
                type="password"
                autoFocus
                value={tokenInput}
                onChange={(event) => setTokenInput(event.target.value)}
                placeholder={t("Paste the sing-box-panel access token")}
                autoComplete="current-password"
                spellCheck={false}
                disabled={locked}
              />
            </label>
            <button type="submit" className={styles.primary} disabled={busy || locked}>
              {busy
                ? t("Signing in…")
                : locked
                  ? t("Locked, retry in {seconds}s", {
                      seconds: Math.ceil(lockRemaining / 1000),
                    })
                  : t("Open panel")}
            </button>
            <p className={styles.hint}>
              {t("The token is stored at {path}; read it with sudo cat.", {
                path: "/var/lib/sing-box-panel/token",
              })}
            </p>
            {message !== "" && (
              <p className={styles.error} role="alert" aria-live="assertive">
                {message}
              </p>
            )}
            <button
              type="button"
              className={styles.secondary}
              disabled={locked}
              onClick={() => {
                saveStoredString(DIRECT_MODE_KEY, "true");
                setDirectMode(true);
                setCapabilities(unknownPanelCapabilities());
                setPhase("ready");
              }}
            >
              {t("Connect to a core directly")}
            </button>
            <p className={styles.hint}>
              {t(
                "Direct mode manages a sing-box API service without the privileged panel; subscriptions and service control are unavailable there.",
              )}
            </p>
          </form>
        )}

        {phase === "error" && (
          <div className={styles.form}>
            <p className={styles.error}>{message}</p>
            <div className={styles.actions}>
              <button type="button" className={styles.primary} onClick={() => void bootstrap()} disabled={busy}>
                {t("Retry")}
              </button>
              <button
                type="button"
                className={styles.secondary}
                onClick={() => {
                  lockPanel();
                  setPhase("gate");
                }}
              >
                {t("Sign in again")}
              </button>
            </div>
          </div>
        )}

        {phase === "recovery" && (
          <div className={styles.form}>
            <div className={styles.recoveryStatus}>
              <span className={styles.dotOffline} aria-hidden="true" />
              <div>
                <strong>{t("The sing-box core is not running")}</strong>
                <p className={styles.muted}>
                  {state?.service?.active === false
                    ? t("The service is stopped; start it to open the dashboard.")
                    : t("Waiting for the core to be ready…")}
                </p>
              </div>
            </div>
            {state?.version && (
              <p className={styles.hint}>
                {t("Core version: {version}", { version: state.version })}
              </p>
            )}
            {state?.config_path && (
              <p className={styles.hint}>{t("Config: {path}", { path: state.config_path })}</p>
            )}
            {state?.config_error ? (
              <p className={styles.error}>
                {t("Failed to read the configuration: {error}", { error: state.config_error })}
              </p>
            ) : null}
            <div className={styles.actions}>
              <button type="button" className={styles.primary} onClick={() => void runServiceAction("start")} disabled={busy}>
                {t("Start core")}
              </button>
              <button type="button" className={styles.secondary} onClick={() => void runServiceAction("restart")} disabled={busy}>
                {t("Restart core")}
              </button>
            </div>
            {message !== "" && <p className={styles.error}>{message}</p>}
          </div>
        )}

        {phase !== "gate" && phase !== "checking" && (
          <p className={styles.footerLink}>
            {showFallback && !directMode ? (
              <>
                <a href={fallbackUrl} target="_blank" rel="noreferrer">
                  {t("Fallback panel")}
                </a>
                <span aria-hidden="true"> · </span>
              </>
            ) : null}
            {directMode ? (
              <>
                <button
                  type="button"
                  className={styles.textButton}
                  onClick={() => {
                    removeStoredValue(DIRECT_MODE_KEY);
                    setDirectMode(false);
                    lockPanel();
                    setPhase("gate");
                  }}
                >
                  {t("Sign in with a panel token")}
                </button>
                <span aria-hidden="true"> · </span>
              </>
            ) : null}
            <button
              type="button"
              className={styles.textButton}
              onClick={() => {
                lockPanel();
                setPhase("gate");
              }}
            >
              {t("Switch token")}
            </button>
          </p>
        )}
      </div>
    </div>
  );
}
