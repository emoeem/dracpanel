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
import { FcButton, FcCard, FcIconButton, FcSheet } from "../../components/flclash";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { QRCode } from "../../components/ui";
import { daysUntil, formatExpiryDays } from "../../lib/flclash/format";
import { cx } from "../../lib/cx";
import styles from "./ProfilesView.module.css";

type AddMode = "link" | "file" | null;

export function ProfilesView() {
  const api = useApi();
  const { language } = useI18n();
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
      showError(new Error("请输入有效的订阅链接（http/https）"));
      return;
    }
    setBusy(true);
    try {
      const result = await addSubscription(name.trim(), url.trim());
      if (!result.ok) {
        throw new Error(result.message || "添加配置失败");
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
        throw new Error(result.message || "导入配置失败");
      }
      setAddMode(null);
      await load();
    } catch (error) {
      if (error instanceof PanelFeatureUnavailableError) {
        setFileUnsupported(true);
        showError(new Error("当前面板后端未提供本地导入接口（/api/profiles/import）"));
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
        throw new Error(result.message || "更新失败");
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
        throw new Error(result.message || "更新失败");
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
        throw new Error(result.message || "删除失败");
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
          <h1 className={styles.pageTitle}>配置</h1>
        </div>
        <div className={styles.empty}>
          配置管理需要面板后端；直接模式下不可用。
        </div>
      </div>
    );
  }

  return (
    <div className="fc-page">
      <div className={styles.toolbar}>
        <div className={styles.titleRow}>
          <h1 className={styles.pageTitle}>配置</h1>
          <div className={styles.actions}>
            <FcIconButton label="更新全部" disabled={busy || items.length === 0} onClick={() => void syncAll()}>
              {busy ? <span className={styles.spinner} /> : <Icon name="sync" size={18} />}
            </FcIconButton>
            <FcIconButton label="写入配置" disabled={busy || items.length === 0} onClick={() => void writeAndApply()}>
              <Icon name="system_update_alt" size={18} />
            </FcIconButton>
            <div className={styles.menuAnchor} ref={menuRef}>
              <FcIconButton label="添加配置" aria-expanded={menuOpen} onClick={() => setMenuOpen((value) => !value)}>
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
                    <Icon name="link" size={16} /> 链接
                  </button>
                  <label className={cx(styles.menuRow, styles.menuFileRow)}>
                    <Icon name="upload_file" size={16} /> 文件
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
                    title={fileUnsupported ? "当前面板后端未提供本地导入接口" : "需扫描二维码导入，可先使用链接"}
                  >
                    <Icon name="qr_code" size={16} /> 二维码
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
            <p>暂无配置</p>
            <FcButton variant="primary" onClick={() => setAddMode("link")}>
              添加配置
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
                        {item.name || "未命名配置"}
                      </span>
                      {days !== null && days <= 7 && (
                        <span className={cx(styles.expiryChip, styles.expiryWarning)}>
                          {formatExpiryDays(days)}
                        </span>
                      )}
                    </div>
                    <div className={styles.cardSubtitle}>
                      {hasTotal ? `${formatBytes(used)} / ${formatBytes(userinfo.total ?? 0)}` : "远程"}
                    </div>
                    <div className={styles.cardTrailing}>
                      {item.last_update ? formatRelativeTime(item.last_update * 1000, now, language) : "—"}
                      <span className={styles.cardMenu}>
                        <FcIconButton
                          label="配置操作"
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
          title="添加配置"
          subtitle="从订阅链接导入节点"
          onClose={() => setAddMode(null)}
          footer={
            <>
              <FcButton variant="text" disabled={busy} onClick={() => setAddMode(null)}>
                取消
              </FcButton>
              <FcButton variant="primary" disabled={busy} onClick={() => void addFromLink()}>
                {busy ? "添加中…" : "添加"}
              </FcButton>
            </>
          }
        >
          <label className={styles.field}>
            <span>名称（可选）</span>
            <input value={name} onChange={(event) => setName(event.target.value)} placeholder="我的订阅" />
          </label>
          <label className={styles.field}>
            <span>订阅链接</span>
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
        <FcSheet title="配置二维码" subtitle={qrTarget.name || "订阅链接"} onClose={() => setQrTarget(null)}>
          <div className={styles.qrWrap}>
            <QRCode value={qrTarget.url} />
            <p className={styles.qrText}>{qrTarget.url}</p>
          </div>
        </FcSheet>
      )}

      {deleteTarget && (
        <ConfirmDialog
          title="删除配置"
          message={`删除 “${deleteTarget.name || deleteTarget.url}”？下次“写入配置”时会从内核配置中移除对应节点。`}
          confirmLabel="删除"
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
        throw new Error(result.message || "写入失败");
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
  const { language } = useI18n();
  const now = useNow(30_000);
  const item = props.item;
  const userinfo = item.userinfo ?? {};
  return (
    <FcSheet title={item.name || "未命名配置"} subtitle={item.url} onClose={props.onClose}>
      <div className={styles.contextMeta}>
        <span>更新于 {item.last_update ? formatDateTime(item.last_update * 1000, language) : "—"}</span>
        <span>{item.node_count ?? 0} 个节点</span>
        {typeof userinfo.expire === "number" && userinfo.expire > 0 && (
          <span>{formatExpiryDays(daysUntil(userinfo.expire, now))}</span>
        )}
        {item.last_error && <span className={styles.contextError}>失败：{item.last_error}</span>}
      </div>
      <div className={styles.contextActions}>
        <FcButton onClick={props.onSync} disabled={props.busy}>
          <Icon name="sync" size={16} /> 同步
        </FcButton>
        <FcButton onClick={props.onShowQr}>
          <Icon name="qr_code" size={16} /> 二维码
        </FcButton>
        <FcButton
          onClick={() => {
            void navigator.clipboard.writeText(item.url).catch(() => {});
          }}
        >
          <Icon name="content_copy" size={16} /> 复制链接
        </FcButton>
        <FcButton variant="danger" onClick={props.onDelete} disabled={props.busy}>
          <Icon name="delete" size={16} /> 删除
        </FcButton>
      </div>
    </FcSheet>
  );
}


/** 当前生效的内核配置文件：即使没有任何订阅，配置页也有实际内容。 */
function CurrentConfigCard() {
  const panel = usePanelState();
  const state = panel.state;
  const { language } = useI18n();
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
        <span className={styles.currentBadge}>当前配置</span>
        <span className={styles.currentName} title={state.config_path}>
          {name}
        </span>
      </div>
      <div className={styles.currentMeta}>
        <span>{size}</span>
        <span>更新于 {updated}</span>
        {state.config_error && <span className={styles.contextError}>{state.config_error}</span>}
      </div>
      <FcButton
        variant="tonal"
        size="small"
        onClick={() => navigate("tools/config")}
      >
        <Icon name="code" size={14} /> 打开配置编辑器
      </FcButton>
    </FcCard>
  );
}
