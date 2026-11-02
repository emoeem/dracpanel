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
import { useI18n } from "../../app/i18n";
import { Icon } from "../../components/Icon";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { FcButton, FcCard, FcIconButton } from "../../components/flclash";
import { navigate } from "../../app/context";
import { ToolsPageHeader } from "./ToolsView";
import styles from "./BackupView.module.css";

export function BackupView() {
  const api = useApi();
  const { t } = useI18n();
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
        throw new Error(result.message || t("Backup failed"));
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
        throw new Error(result.message || t("Restore failed"));
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
        <ToolsPageHeader title={t("Backup and Restore")} onBack={() => navigate("tools")} />
        <div className={styles.empty}>{t("Backup requires the panel backend; unavailable in direct mode.")}</div>
      </div>
    );
  }

  return (
    <div className="fc-page">
      <ToolsPageHeader
        title={t("Backup and Restore")}
        onBack={() => navigate("tools")}
        actions={
          <FcButton variant="primary" disabled={busy} onClick={() => void createBackup()}>
            <Icon name="backup" size={16} /> {t("Back up now")}
          </FcButton>
        }
      />
      <div className="fc-page-body">
        {loading ? (
          <div className={styles.empty}>{t("Loading...")}</div>
        ) : backups.length === 0 ? (
          <div className={styles.empty}>{t("No backups")}</div>
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
                  <FcIconButton label={t("Download backup")} onClick={() => void downloadPanelBackup(backup.name)}>
                    <Icon name="download" size={16} />
                  </FcIconButton>
                  <FcButton size="small" disabled={busy} onClick={() => setRestoreTarget(backup)}>
                    {t("Restore")}
                  </FcButton>
                </span>
              </div>
            ))}
          </FcCard>
        )}
        <p className={styles.hint}>
          {t(
            "Restoring a backup overwrites the current configuration and restarts the core; the panel creates a fresh backup before every apply.",
          )}
        </p>
      </div>
      {restoreTarget && (
        <ConfirmDialog
          title={t("Restore backup")}
          message={t("Restore the configuration to “{name}” and restart the core? Changes that were not backed up will be lost.", { name: restoreTarget.name })}
          confirmLabel={t("Restore")}
          busy={busy}
          onConfirm={() => void restore(restoreTarget)}
          onClose={() => setRestoreTarget(null)}
        />
      )}
    </div>
  );
}
