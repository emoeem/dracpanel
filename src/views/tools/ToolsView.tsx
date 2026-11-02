import { useState, type ReactNode } from "react";

import { hasPanelToken } from "../../api/panel";
import { useApi, navigate } from "../../app/context";
import { usePanelState } from "../../app/usePanelState";
import { useI18n, type MessageKey } from "../../app/i18n";
import { LANGUAGES } from "../../app/translations";
import { loadLanguagePreference, saveLanguagePreference } from "../../app/i18nCore";
import { Icon } from "../../components/Icon";
import { FcSheet } from "../../components/flclash";
import { cx } from "../../lib/cx";
import styles from "./ToolsView.module.css";

interface Row {
  key: string;
  label: string;
  detail?: string;
  icon: Parameters<typeof Icon>[0]["name"];
  onClick: () => void;
}

function Section(props: { label: string; rows: Row[] }) {
  return (
    <section className={styles.section}>
      <h2 className={styles.sectionLabel}>{props.label}</h2>
      <div className={styles.rows}>
        {props.rows.map((row) => (
          <button key={row.key} type="button" className={styles.row} onClick={row.onClick}>
            <span className={styles.rowIcon}>
              <Icon name={row.icon} size={18} />
            </span>
            <span className={styles.rowText}>
              <span className={styles.rowLabel}>{row.label}</span>
              {row.detail && <span className={styles.rowDetail}>{row.detail}</span>}
            </span>
            <Icon name="chevron_right" size={16} />
          </button>
        ))}
      </div>
    </section>
  );
}

function LanguageSheet(props: { onClose: () => void }) {
  const { t, language } = useI18n();
  const [selected, setSelected] = useState(loadLanguagePreference());
  const options = [
    { value: "auto" as const, label: t("Follow system") },
    ...LANGUAGES.map((entry) => ({ value: entry.value, label: entry.label })),
  ];
  return (
    <FcSheet
      title={t("Language")}
      onClose={props.onClose}
      footer={
        <button
          type="button"
          className={styles.primaryAction}
          onClick={() => {
            saveLanguagePreference(selected);
            props.onClose();
          }}
        >
          {t("Save")}
        </button>
      }
    >
      <div className={styles.optionList}>
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            className={cx(styles.optionRow, selected === option.value && styles.optionActive)}
            onClick={() => setSelected(option.value)}
          >
            <span>{option.label}</span>
            {selected === option.value && <Icon name="check" size={16} />}
          </button>
        ))}
      </div>
      <p className={styles.sheetHint}>{t("Current language: {language}", { language })}</p>
    </FcSheet>
  );
}

const SHORTCUTS: readonly { keys: string; label: MessageKey }[] = [
  { keys: "Ctrl/⌘ + 1", label: "Dashboard" },
  { keys: "Ctrl/⌘ + 2", label: "Proxies" },
  { keys: "Ctrl/⌘ + 3", label: "Live connections" },
  { keys: "Ctrl/⌘ + 4", label: "Logs" },
  { keys: "Ctrl/⌘ + K", label: "Search commands" },
];

function ShortcutsSheet(props: { onClose: () => void }) {
  const { t } = useI18n();
  return (
    <FcSheet
      title={t("Keyboard Shortcuts")}
      subtitle={t("Web shortcuts are fixed combinations and cannot be customized for now")}
      onClose={props.onClose}
    >
      <div className={styles.optionList}>
        {SHORTCUTS.map((shortcut) => (
          <div key={shortcut.keys} className={styles.shortcutRow}>
            <span>{t(shortcut.label)}</span>
            <kbd className={styles.kbd}>{shortcut.keys}</kbd>
          </div>
        ))}
      </div>
    </FcSheet>
  );
}

function AboutSheet(props: { onClose: () => void; version: string | null; kernelVersion: string | null }) {
  const { t } = useI18n();
  return (
    <FcSheet title={t("About")} onClose={props.onClose}>
      <div className={styles.aboutBlock}>
        <h3 className={styles.aboutTitle}>DracPanel</h3>
        <p className={styles.aboutText}>
          {t(
            "A local proxy management panel that follows the FlClash desktop design; data comes from the proxy kernel running on this machine.",
          )}
        </p>
        <p className={styles.aboutMeta}>{t("Panel version {version}", { version: props.version ?? "—" })}</p>
        {props.kernelVersion && (
          <p className={styles.aboutMeta}>{t("Kernel version {version}", { version: props.kernelVersion })}</p>
        )}
        <p className={styles.aboutMeta}>
          {t(
            "The UI design references FlClash (chen08209, GPL-3.0) and daeuniverse/doona; this panel is an independent implementation and does not use their source code.",
          )}
        </p>
      </div>
    </FcSheet>
  );
}

function DisclaimerSheet(props: { onClose: () => void }) {
  const { t } = useI18n();
  return (
    <FcSheet title={t("Disclaimer")} onClose={props.onClose}>
      <div className={styles.aboutBlock}>
        <p className={styles.aboutText}>
          {t(
            "This tool is for learning and personal network management only; please follow the laws and regulations of your region. You are solely responsible for any consequences of using this tool.",
          )}
        </p>
      </div>
    </FcSheet>
  );
}

export function ToolsView() {
  const { t } = useI18n();
  const api = useApi();
  const panel = usePanelState();
  const [languageOpen, setLanguageOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [disclaimerOpen, setDisclaimerOpen] = useState(false);
  const accessSupported = hasPanelToken();

  const navRows: Row[] = [
    { key: "requests", label: t("Recent Requests"), icon: "swap_vert", onClick: () => navigate("tools/requests") },
    { key: "dns", label: t("DNS query"), icon: "dns", onClick: () => navigate("tools/dns") },
    { key: "resources", label: t("Resources"), icon: "memory", onClick: () => navigate("tools/resources") },
  ];

  const settingsRows: Row[] = [
    { key: "language", label: t("Language"), icon: "language", onClick: () => setLanguageOpen(true) },
    { key: "theme", label: t("Theme"), icon: "palette", onClick: () => navigate("tools/theme") },
    { key: "backup", label: t("Backup and Restore"), icon: "backup", onClick: () => navigate("tools/backup") },
    { key: "shortcuts", label: t("Keyboard Shortcuts"), icon: "keyboard", onClick: () => setShortcutsOpen(true) },
    ...(accessSupported
      ? [
          {
            key: "access",
            label: t("Access Control"),
            icon: "shield" as const,
            onClick: () => navigate("tools/config"),
          },
        ]
      : []),
    { key: "advanced", label: t("Advanced Configuration"), icon: "handyman", onClick: () => navigate("tools/advanced") },
    { key: "rulesets", label: t("Custom Resources"), icon: "rule", onClick: () => navigate("tools/rulesets") },
    { key: "general", label: t("General"), icon: "settings", onClick: () => navigate("tools/general") },
  ];

  const otherRows: Row[] = [
    { key: "disclaimer", label: t("Disclaimer"), icon: "info", onClick: () => setDisclaimerOpen(true) },
    {
      key: "about",
      label: t("About"),
      icon: "emergency",
      detail: api.config.name,
      onClick: () => setAboutOpen(true),
    },
  ];

  return (
    <div className="fc-page">
      <div className={styles.toolbar}>
        <h1 className={styles.pageTitle}>{t("Tools")}</h1>
      </div>
      <div className="fc-page-body">
        {!hasPanelToken() && (
          <div className={styles.hint}>
            {t("In direct mode, panel features such as backup and access control are unavailable.")}
          </div>
        )}
        <Section label={t("Navigate")} rows={navRows} />
        <Section label={t("Settings")} rows={settingsRows} />
        <Section label={t("Others")} rows={otherRows} />
      </div>
      {languageOpen && <LanguageSheet onClose={() => setLanguageOpen(false)} />}
      {shortcutsOpen && <ShortcutsSheet onClose={() => setShortcutsOpen(false)} />}
      {aboutOpen && (
        <AboutSheet
          version={panel.state?.panel_version ?? null}
          kernelVersion={panel.state?.version ?? null}
          onClose={() => setAboutOpen(false)}
        />
      )}
      {disclaimerOpen && <DisclaimerSheet onClose={() => setDisclaimerOpen(false)} />}
    </div>
  );
}

export function ToolsPageHeader(props: { title: string; actions?: ReactNode; onBack?: () => void }) {
  const { t } = useI18n();
  return (
    <div className={styles.subToolbar}>
      <button
        type="button"
        className={styles.back}
        aria-label={t("Back")}
        onClick={props.onBack ?? (() => window.history.back())}
      >
        <Icon name="arrow_back" size={20} />
      </button>
      <h1 className={styles.subTitle}>{props.title}</h1>
      {props.actions && <div className={styles.actions}>{props.actions}</div>}
    </div>
  );
}
