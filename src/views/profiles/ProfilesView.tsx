import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { formatBytes, formatDateTime, formatRelativeTime, isHttpUrl } from "../../api/format";
import {
  addSubscription,
  applySubscriptions,
  deleteSubscription,
  importProfileFile,
  listSubscriptions,
  updateAllSubscriptions,
  updateSubscription,
  hasPanelToken,
  PanelFeatureUnavailableError,
  type PanelSubscription,
} from "../../api/panel";
import { navigate, useApi, useNow } from "../../app/context";
import { usePanelState } from "../../app/usePanelState";
import { afterConfigChange } from "../../app/configResync";
import { showError } from "../../app/errorStore";
import { useDismiss } from "../../app/hooks";
import { useI18n } from "../../app/i18n";
import { Icon } from "../../components/Icon";
import { FcBadge, FcButton, FcCard, FcIconButton, FcSheet } from "../../components/flclash";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { QRCode } from "../../components/ui";
import { daysUntil, formatExpiryDays } from "../../lib/flclash/format";
import { cx } from "../../lib/cx";
import styles from "./ProfilesView.module.css";

type AddMode = "link" | "file" | null;

export function ProfilesView() {
  const api = useApi();
  const { t, language } = useI18n();
  const now = useNow(30_000);
  const [items, setItems] = useState<PanelSubscription[]>([]);
  const [loading, setLoading] = useState(true);
  const [menuOpen, setMenuOpen] = useState(false);
  const [addMode, setAddMode] = useState<AddMode>(null);
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [contextTarget, setContextTarget] = useState<PanelSubscription | null>(null);
  const [qrTarget, setQrTarget] = useState<PanelSubscription | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<PanelSubscription | null>(null);
  const [fileUnsupported, setFileUnsupported] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  useDismiss(menuRef, menuOpen, () => setMenuOpen(false));

  const load = useCallback(async () => {
    if (!hasPanelToken()) {
      setItems([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const result = await listSubscriptions();
      setItems(result.subscriptions ?? []);
    } catch (error) {
      showError(error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const sorted = useMemo(
    () =>
      [...items].sort((left, right) => {
        const leftTime = left.last_update ?? left.last_attempt ?? 0;
        const rightTime = right.last_update ?? right.last_attempt ?? 0;
        return rightTime - leftTime;
      }),
    [items],
  );

  const addFromLink = async () => {
    if (!isHttpUrl(url.trim())) {
      showError(new Error(t("Enter a valid subscription URL (http/https)")));
      return;
    }
    setBusy(true);
    try {
      const result = await addSubscription(name.trim(), url.trim());
      if (!result.ok) {
        throw new Error(result.message || t("Failed to add the subscription"));
      }
      setAddMode(null);
      setName("");
      setUrl("");
      await load();
    } catch (error) {
      showError(error);
    } finally {
      setBusy(false);
    }
  };

  const addFromFile = async (file: File) => {
    setBusy(true);
    try {
      const result = await importProfileFile(file);
      if (!result.ok) {
        throw new Error(result.message || t("Failed to import the subscription"));
      }
      setAddMode(null);
      await load();
    } catch (error) {
      if (error instanceof PanelFeatureUnavailableError) {
        setFileUnsupported(true);
        showError(new Error(t("The panel backend has no local import endpoint")));
      } else {
        showError(error);
      }
    } finally {
      setBusy(false);
    }
  };

  const syncAll = async () => {
    setBusy(true);
    try {
      const result = await updateAllSubscriptions();
      if (!result.ok) {
        throw new Error(result.message || t("Failed to update"));
      }
      await load();
    } catch (error) {
      showError(error);
    } finally {
      setBusy(false);
    }
  };

  const syncOne = async (item: PanelSubscription) => {
    setBusy(true);
    try {
      const result = await updateSubscription(item.id);
      if (!result.ok) {
        throw new Error(result.message || t("Failed to update"));
      }
      await load();
    } catch (error) {
      showError(error);
    } finally {
      setBusy(false);
      setContextTarget(null);
    }
  };

  const remove = async (item: PanelSubscription) => {
    setBusy(true);
    try {
      const result = await deleteSubscription(item.id);
      if (!result.ok) {
        throw new Error(result.message || t("Failed to delete"));
      }
      setDeleteTarget(null);
      await load();
    } catch (error) {
      showError(error);
    } finally {
      setBusy(false);
    }
  };

  if (!hasPanelToken()) {
    return (
      <div className="fc-page">
        <div className={styles.toolbar}>
          <h1 className={styles.pageTitle}>{t("Profiles")}</h1>
        </div>
        <div className={styles.empty}>
          {t("Profile management requires the panel backend; unavailable in direct mode.")}
        </div>
      </div>
    );
  }

  return (
    <div className="fc-page">
      <div className={styles.toolbar}>
        <div className={styles.titleRow}>
          <h1 className={styles.pageTitle}>{t("Profiles")}</h1>
          <div className={styles.actions}>
            <FcIconButton label={t("Update all")} disabled={busy || items.length === 0} onClick={() => void syncAll()}>
              {busy ? <span className={styles.spinner} /> : <Icon name="sync" size={18} />}
            </FcIconButton>
            <FcIconButton label={t("Write configuration")} disabled={busy || items.length === 0} onClick={() => void writeAndApply()}>
              <Icon name="system_update_alt" size={18} />
            </FcIconButton>
            <div className={styles.menuAnchor} ref={menuRef}>
              <FcIconButton label={t("Add subscription")} aria-expanded={menuOpen} onClick={() => setMenuOpen((value) => !value)}>
                <Icon name="add" size={20} />
              </FcIconButton>
              {menuOpen && (
                <div className={styles.menu} role="menu">
                  <button
                    type="button"
                    role="menuitem"
                    className={styles.menuRow}
                    onClick={() => {
                      setMenuOpen(false);
                      setAddMode("link");
                    }}
                  >
                    <Icon name="link" size={16} /> {t("Link")}
                  </button>
                  <label className={cx(styles.menuRow, styles.menuFileRow)}>
                    <Icon name="upload_file" size={16} /> {t("File")}
                    <input
                      type="file"
                      accept=".yaml,.yml,.json,.txt"
                      hidden
                      onChange={(event) => {
                        const file = event.target.files?.[0];
                        event.target.value = "";
                        if (file) {
                          setMenuOpen(false);
                          void addFromFile(file);
                        }
                      }}
                    />
                  </label>
                  <button
                    type="button"
                    role="menuitem"
                    className={cx(styles.menuRow, styles.menuDisabled)}
                    disabled
                    title={
                      fileUnsupported
                        ? t("The panel backend has no local import endpoint")
                        : t("Scan a QR code to import; use a link for now")
                    }
                  >
                    <Icon name="qr_code" size={16} /> {t("QR code")}
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="fc-page-body">
        <CurrentConfigCard />
        {loading && items.length === 0 ? (
          <div className={styles.skeletonGrid}>
            {Array.from({ length: 3 }, (_, index) => (
              <div key={index} className={styles.skeletonCard} />
            ))}
          </div>
        ) : sorted.length === 0 ? (
          <div className={styles.empty}>
            <p>{t("No profiles")}</p>
            <FcButton variant="primary" onClick={() => setAddMode("link")}>
              {t("Add subscription")}
            </FcButton>
          </div>
        ) : (
          <div className={styles.grid}>
            {sorted.map((item) => {
              const userinfo = item.userinfo ?? {};
              const used = (userinfo.upload ?? 0) + (userinfo.download ?? 0);
              const hasTotal = typeof userinfo.total === "number" && userinfo.total > 0;
              const days = daysUntil(userinfo.expire, now);
              return (
                <div
                  key={item.id}
                  className={styles.cardWrap}
                  onContextMenu={(event) => {
                    event.preventDefault();
                    setContextTarget(item);
                  }}
                >
                  <FcCard shape="profile" className={styles.card}>
                    <div className={styles.cardMain}>
                      <span className={styles.cardTitle} title={item.name || item.url}>
                        {item.name || t("Untitled profile")}
                      </span>
                      {days !== null && days <= 7 && (
                        <span className={cx(styles.expiryChip, styles.expiryWarning)}>
                          {formatExpiryDays(days, t)}
                        </span>
                      )}
                    </div>
                    <div className={styles.cardSubtitle}>
                      {hasTotal ? `${formatBytes(used)} / ${formatBytes(userinfo.total ?? 0)}` : t("Remote")}
                    </div>
                    <div className={styles.cardTrailing}>
                      {item.last_update ? formatRelativeTime(item.last_update * 1000, now, language) : "—"}
                      <span className={styles.cardMenu}>
                        <FcIconButton
                          label={t("Profile actions")}
                          onClick={(event) => {
                            event.stopPropagation();
                            setContextTarget(item);
                          }}
                        >
                          <Icon name="more_vert" size={16} />
                        </FcIconButton>
                      </span>
                    </div>
                  </FcCard>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {addMode === "link" && (
        <FcSheet
          title={t("Add subscription")}
          subtitle={t("Import nodes from a subscription link")}
          onClose={() => setAddMode(null)}
          footer={
            <>
              <FcButton variant="text" disabled={busy} onClick={() => setAddMode(null)}>
                {t("Cancel")}
              </FcButton>
              <FcButton variant="primary" disabled={busy} onClick={() => void addFromLink()}>
                {busy ? t("Adding...") : t("Add")}
              </FcButton>
            </>
          }
        >
          <label className={styles.field}>
            <span>{t("Name (optional)")}</span>
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder={t("My subscription")}
            />
          </label>
          <label className={styles.field}>
            <span>{t("Subscription URL")}</span>
            <input
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              placeholder="https://example.com/subscription"
              spellCheck={false}
              inputMode="url"
            />
          </label>
        </FcSheet>
      )}

      {contextTarget && (
        <ContextSheet
          item={contextTarget}
          busy={busy}
          onClose={() => setContextTarget(null)}
          onSync={() => void syncOne(contextTarget)}
          onShowQr={() => {
            setQrTarget(contextTarget);
            setContextTarget(null);
          }}
          onDelete={() => {
            setDeleteTarget(contextTarget);
            setContextTarget(null);
          }}
        />
      )}

      {qrTarget && (
        <FcSheet
          title={t("Profile QR code")}
          subtitle={qrTarget.name || t("Subscription URL")}
          onClose={() => setQrTarget(null)}
        >
          <div className={styles.qrWrap}>
            <QRCode value={qrTarget.url} />
            <p className={styles.qrText}>{qrTarget.url}</p>
          </div>
        </FcSheet>
      )}

      {deleteTarget && (
        <ConfirmDialog
          title={t("Delete profile")}
          message={t("Delete “{name}”? The next “Write configuration” removes the matching nodes from the core configuration.", {
            name: deleteTarget.name || deleteTarget.url,
          })}
          confirmLabel={t("Delete")}
          danger
          busy={busy}
          onConfirm={() => void remove(deleteTarget)}
          onClose={() => setDeleteTarget(null)}
        />
      )}
    </div>
  );

  async function writeAndApply() {
    setBusy(true);
    try {
      const result = await applySubscriptions();
      if (!result.ok) {
        throw new Error(result.message || t("Failed to write"));
      }
      await afterConfigChange(api);
    } catch (error) {
      showError(error);
    } finally {
      setBusy(false);
    }
  }
}

function ContextSheet(props: {
  item: PanelSubscription;
  busy: boolean;
  onClose: () => void;
  onSync: () => void;
  onShowQr: () => void;
  onDelete: () => void;
}) {
  const { t, language } = useI18n();
  const now = useNow(30_000);
  const item = props.item;
  const userinfo = item.userinfo ?? {};
  return (
    <FcSheet title={item.name || t("Untitled profile")} subtitle={item.url} onClose={props.onClose}>
      <div className={styles.contextMeta}>
        <span>
          {t("Updated {time}", {
            time: item.last_update ? formatDateTime(item.last_update * 1000, language) : "—",
          })}
        </span>
        <span>{t("{count} nodes", { count: item.node_count ?? 0 })}</span>
        {typeof userinfo.expire === "number" && userinfo.expire > 0 && (
          <span>{formatExpiryDays(daysUntil(userinfo.expire, now), t)}</span>
        )}
        {item.last_error && (
          <span className={styles.contextError}>{t("Failed: {error}", { error: item.last_error })}</span>
        )}
      </div>
      <div className={styles.contextActions}>
        <FcButton onClick={props.onSync} disabled={props.busy}>
          <Icon name="sync" size={16} /> {t("Sync")}
        </FcButton>
        <FcButton onClick={props.onShowQr}>
          <Icon name="qr_code" size={16} /> {t("QR code")}
        </FcButton>
        <FcButton
          onClick={() => {
            void navigator.clipboard.writeText(item.url).catch(() => {});
          }}
        >
          <Icon name="content_copy" size={16} /> {t("Copy link")}
        </FcButton>
        <FcButton variant="danger" onClick={props.onDelete} disabled={props.busy}>
          <Icon name="delete" size={16} /> {t("Delete")}
        </FcButton>
      </div>
    </FcSheet>
  );
}


/** 当前生效的内核配置文件：即使没有任何订阅，配置页也有实际内容。 */
function CurrentConfigCard() {
  const panel = usePanelState();
  const state = panel.state;
  const { t, language } = useI18n();
  const now = useNow(30_000);
  if (!state?.config_path) {
    return null;
  }
  const name = state.config_path.split("/").pop() || state.config_path;
  const size = typeof state.config_bytes === "number" ? formatBytes(state.config_bytes) : "—";
  const updated = state.config_mtime ? formatRelativeTime(state.config_mtime * 1000, now, language) : "—";
  return (
    <FcCard shape="profile" className={styles.currentCard}>
      <div className={styles.currentMain}>
        <FcBadge tone="accent">{t("Current profile")}</FcBadge>
        <span className={styles.currentName} title={state.config_path}>
          {name}
        </span>
        <span className={styles.currentMeta}>
          <span>{size}</span>
          <span>{t("Updated {time}", { time: updated })}</span>
        </span>
        {state.config_error && <span className={styles.contextError}>{state.config_error}</span>}
        <FcButton
          variant="tonal"
          size="small"
          className={styles.currentAction}
          onClick={() => navigate("tools/config")}
        >
          <Icon name="code" size={14} /> {t("Open config editor")}
        </FcButton>
      </div>
    </FcCard>
  );
}
