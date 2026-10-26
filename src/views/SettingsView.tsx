import { useState, type ReactNode } from "react";

import {
  removeServer,
  serverDisplayName,
  upsertServer,
  type Server,
  type ServersState,
} from "../api/config";
import { navigate } from "../app/context";
import { buildLabel } from "../app/version";
import { LanguageSelect, useI18n } from "../app/i18n";
import { Icon } from "../components/Icon";
import { PageHeader } from "../components/PageHeader";
import {
  IconButton,
  NavRow,
  ThemeMenu,
  ThemeSelect,
} from "../components/ui";
import type { AccentPreference, PalettePreference, ThemePreference } from "../app/context";
import { ServerDialog } from "./ServerDialog";
import styles from "./SettingsView.module.css";

export function SettingsView() {
  const { t } = useI18n();

  return (
    <div className="page">
      <PageHeader title={t("Settings")} />
      <div className="settings-stack">
        <div className="nav-list">
          <NavRow
            icon="tune"
            title={t("Preferences")}
            onClick={() => navigate("settings/preferences")}
          />
          <NavRow
            icon="dns"
            title={t("Servers")}
            onClick={() => navigate("settings/servers")}
          />
        </div>
        <div>
          <div className="list-section-title">{t("About")}</div>
          <div className="nav-list">
            <NavRow
              icon="description"
              title={t("Documentation")}
              href="https://sing-box.sagernet.org"
            />
            <NavRow
              icon="code"
              title={t("Upstream project")}
              href="https://github.com/SagerNet/sing-box-dashboard"
            />
            <NavRow
              icon="description"
              title={t("About this build")}
              href="/README.md"
            />
          </div>
          <p className="hint" style={{ padding: "10px 14px 0", lineHeight: 1.6 }}>
            {t(
              "An unofficial DracPanel build, not affiliated with the SagerNet or sing-box projects. Source and documentation live in the project repository.",
            )}
          </p>
          <p className="hint" style={{ padding: "10px 14px 0" }}>
            {t("UI build {build}", { build: buildLabel() })}
          </p>
        </div>
      </div>
    </div>
  );
}

function SettingsPageHeader(props: {
  title: string;
  action?: ReactNode;
  back?: string;
  backLabel?: string;
}) {
  const { t } = useI18n();
  const back = props.back ?? "settings";
  return (
    <PageHeader
      title={props.title}
      actions={props.action}
      back={{ label: props.backLabel ?? t("Settings"), onClick: () => navigate(back) }}
    />
  );
}

export function PreferencesView(props: {
  theme: ThemePreference;
  onThemeChange: (theme: ThemePreference) => void;
  accent: AccentPreference;
  onAccentChange: (accent: AccentPreference) => void;
  palette: PalettePreference;
  onPaletteChange: (palette: PalettePreference) => void;
  amoled: boolean;
  onAmoledChange: (amoled: boolean) => void;
}) {
  const { t } = useI18n();
  return (
    <div className="page">
      <SettingsPageHeader title={t("Preferences")} />
      <div className="settings-stack">
        <div className={styles.settingsList}>
          <div className="settings-row">
            <Icon name="brightness_auto" size={15} />
            <span className="settings-row-label">{t("Appearance")}</span>
            <ThemeSelect theme={props.theme} onChange={props.onThemeChange} />
          </div>
          <div className="settings-row">
            <Icon name="palette" size={15} />
            <span className="settings-row-label">{t("Theme")}</span>
            <ThemeMenu
              theme={props.theme}
              onThemeChange={props.onThemeChange}
              accent={props.accent}
              onChange={props.onAccentChange}
              palette={props.palette}
              onPaletteChange={props.onPaletteChange}
              amoled={props.amoled}
              onAmoledChange={props.onAmoledChange}
            />
          </div>
          <div className="settings-row">
            <Icon name="language" size={15} />
            <span className="settings-row-label">{t("Language")}</span>
            <LanguageSelect />
          </div>
        </div>
      </div>
    </div>
  );
}

export function ServersView(props: {
  serversState: ServersState;
  onServersChange: (state: ServersState) => void;
}) {
  const { t } = useI18n();
  const { servers } = props.serversState;
  const [editing, setEditing] = useState<Server | "new" | null>(null);

  const saveServer = (server: Server) => {
    props.onServersChange(upsertServer(props.serversState, server));
    setEditing(null);
  };

  const deleteServer = (id: string) => {
    props.onServersChange(removeServer(props.serversState, id));
    setEditing(null);
  };

  return (
    <div className="page">
      <SettingsPageHeader
        title={t("Servers")}
        action={
          <IconButton
            aria-label={t("New Server")}
            title={t("New Server")}
            onClick={() => setEditing("new")}
          >
            <Icon name="add" size={18} />
          </IconButton>
        }
      />
      <div>
        <div className="nav-list">
          {servers.length === 0 ? (
            <div className={styles.emptyRow}>{t("No servers")}</div>
          ) : (
            servers.map((server) => (
              <button
                type="button"
                className={styles.serverItem}
                key={server.id}
                onClick={() => setEditing(server)}
              >
                <span className={styles.serverItemText}>
                  <span className="server-row-name">{serverDisplayName(server)}</span>
                  <span className="server-row-url">{server.url}</span>
                </span>
                <span className="settings-row-chevron">
                  <Icon name="keyboard_arrow_right" size={14} />
                </span>
              </button>
            ))
          )}
        </div>
      </div>
      {editing !== null && (
        <ServerDialog
          server={editing === "new" ? null : editing}
          canDelete={editing !== "new" && servers.length > 0}
          onSave={saveServer}
          onDelete={deleteServer}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}
