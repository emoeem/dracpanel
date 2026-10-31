import { useCallback, useEffect, useState } from "react";

import { formatDateTime } from "../../api/format";
import {
  backupPanelConfig,
  downloadPanelBackup,
  getPanelConfig,
  hasPanelToken,
  restorePanelBackup,
  type PanelBackup,
} from "../../api/panel";
import { useApi } from "../../app/context";
import { afterConfigChange } from "../../app/configResync";
import { showError } from "../../app/errorStore";
import { Icon } from "../../components/Icon";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { FcButton, FcCard, FcIconButton } from "../../components/flclash";
import { navigate } from "../../app/context";
import { ToolsPageHeader } from "./ToolsView";
import styles from "./BackupView.module.css";

export function BackupView() {
  const api = useApi();
  const [backups, setBackups] = useState<PanelBackup[]>([]);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [restoreTarget, setRestoreTarget] = useState<PanelBackup | null>(null);

  const load = useCallback(async () => {
    if (!hasPanelToken()) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const config = await getPanelConfig();
      setBackups(config.backups ?? []);
    } catch (error) {
      showError(error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const createBackup = async () => {
    setBusy(true);
    try {
      const result = await backupPanelConfig();
      if (!result.ok) {
        throw new Error(result.message || "备份失败");
      }
      await load();
    } catch (error) {
      showError(error);
    } finally {
      setBusy(false);
    }
  };

  const restore = async (backup: PanelBackup) => {
    setBusy(true);
    try {
      const result = await restorePanelBackup(backup.name);
      if (!result.ok) {
        throw new Error(result.message || "恢复失败");
      }
      setRestoreTarget(null);
      await afterConfigChange(api);
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
        <ToolsPageHeader title="备份与恢复" onBack={() => navigate("tools")} />
        <div className={styles.empty}>备份功能需要面板后端；直接模式下不可用。</div>
      </div>
    );
  }

  return (
    <div className="fc-page">
      <ToolsPageHeader
        title="备份与恢复"
        onBack={() => navigate("tools")}
        actions={
          <FcButton variant="primary" disabled={busy} onClick={() => void createBackup()}>
            <Icon name="backup" size={16} /> 立即备份
          </FcButton>
        }
      />
      <div className="fc-page-body">
        {loading ? (
          <div className={styles.empty}>加载中…</div>
        ) : backups.length === 0 ? (
          <div className={styles.empty}>暂无备份</div>
        ) : (
          <FcCard className={styles.card}>
            {backups.map((backup) => (
              <div key={backup.name} className={styles.row}>
                <span className={styles.rowText}>
                  <span className={styles.rowName}>{backup.name}</span>
                  <span className={styles.rowMeta}>
                    {formatDateTime(backup.mtime * 1000)} · {Math.round(backup.size / 1024)} KB
                  </span>
                </span>
                <span className={styles.rowActions}>
                  <FcIconButton label="下载备份" onClick={() => void downloadPanelBackup(backup.name)}>
                    <Icon name="download" size={16} />
                  </FcIconButton>
                  <FcButton size="small" disabled={busy} onClick={() => setRestoreTarget(backup)}>
                    恢复
                  </FcButton>
                </span>
              </div>
            ))}
          </FcCard>
        )}
        <p className={styles.hint}>
          恢复备份会覆盖当前配置并重启内核；应用任何配置前面板都会自动创建新的备份。
        </p>
      </div>
      {restoreTarget && (
        <ConfirmDialog
          title="恢复备份"
          message={`将配置恢复到 “${restoreTarget.name}” 并重启内核？当前未备份的修改会丢失。`}
          confirmLabel="恢复"
          busy={busy}
          onConfirm={() => void restore(restoreTarget)}
          onClose={() => setRestoreTarget(null)}
        />
      )}
    </div>
  );
}
