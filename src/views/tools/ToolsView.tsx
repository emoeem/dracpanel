import { useState, type ReactNode } from "react";

import { hasPanelToken } from "../../api/panel";
import { useApi, navigate } from "../../app/context";
import { useI18n } from "../../app/i18n";
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
  const { language } = useI18n();
  const [selected, setSelected] = useState(loadLanguagePreference());
  const options = [
    { value: "auto" as const, label: "跟随系统" },
    ...LANGUAGES.map((entry) => ({ value: entry.value, label: entry.label })),
  ];
  return (
    <FcSheet
      title="语言"
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
          保存
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
      <p className={styles.sheetHint}>当前语言：{language}</p>
    </FcSheet>
  );
}

const SHORTCUTS: readonly { keys: string; label: string }[] = [
  { keys: "Ctrl/⌘ + 1", label: "仪表盘" },
  { keys: "Ctrl/⌘ + 2", label: "代理" },
  { keys: "Ctrl/⌘ + 3", label: "实时连接" },
  { keys: "Ctrl/⌘ + 4", label: "日志" },
  { keys: "Ctrl/⌘ + K", label: "搜索命令" },
];

function ShortcutsSheet(props: { onClose: () => void }) {
  return (
    <FcSheet title="快捷键管理" subtitle="网页版快捷键为固定组合，暂不支持自定义" onClose={props.onClose}>
      <div className={styles.optionList}>
        {SHORTCUTS.map((shortcut) => (
          <div key={shortcut.keys} className={styles.shortcutRow}>
            <span>{shortcut.label}</span>
            <kbd className={styles.kbd}>{shortcut.keys}</kbd>
          </div>
        ))}
      </div>
    </FcSheet>
  );
}

function AboutSheet(props: { onClose: () => void; version: string | null }) {
  return (
    <FcSheet title="关于" onClose={props.onClose}>
      <div className={styles.aboutBlock}>
        <h3 className={styles.aboutTitle}>DracPanel</h3>
        <p className={styles.aboutText}>
          一个遵循 FlClash 桌面端设计的本地代理管理面板，数据来自本机运行的代理内核。
        </p>
        <p className={styles.aboutMeta}>面板版本 {props.version ?? "—"}</p>
        <p className={styles.aboutMeta}>
          界面设计参考 FlClash（chen08209，GPL-3.0）与 daeuniverse/doona；本面板为独立实现，未使用其源代码。
        </p>
      </div>
    </FcSheet>
  );
}

function DisclaimerSheet(props: { onClose: () => void }) {
  return (
    <FcSheet title="免责声明" onClose={props.onClose}>
      <div className={styles.aboutBlock}>
        <p className={styles.aboutText}>
          本工具仅供学习和个人网络管理使用，请遵守所在地区的法律法规。使用本工具产生的一切后果由使用者自行承担。
        </p>
      </div>
    </FcSheet>
  );
}

export function ToolsView() {
  const api = useApi();
  const [languageOpen, setLanguageOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [disclaimerOpen, setDisclaimerOpen] = useState(false);
  const accessSupported = hasPanelToken();

  const navRows: Row[] = [
    { key: "requests", label: "最近请求", icon: "swap_vert", onClick: () => navigate("tools/requests") },
    { key: "dns", label: "DNS查询", icon: "dns", onClick: () => navigate("tools/dns") },
    { key: "resources", label: "资源", icon: "memory", onClick: () => navigate("tools/resources") },
  ];

  const settingsRows: Row[] = [
    { key: "language", label: "语言", icon: "language", onClick: () => setLanguageOpen(true) },
    { key: "theme", label: "主题", icon: "palette", onClick: () => navigate("tools/theme") },
    { key: "backup", label: "备份与恢复", icon: "backup", onClick: () => navigate("tools/backup") },
    { key: "shortcuts", label: "快捷键管理", icon: "keyboard", onClick: () => setShortcutsOpen(true) },
    ...(accessSupported
      ? [
          {
            key: "access",
            label: "访问控制",
            icon: "shield" as const,
            onClick: () => navigate("tools/config"),
          },
        ]
      : []),
    { key: "advanced", label: "进阶配置", icon: "handyman", onClick: () => navigate("tools/advanced") },
    { key: "rulesets", label: "自定义资源", icon: "rule", onClick: () => navigate("tools/rulesets") },
    { key: "general", label: "常规", icon: "settings", onClick: () => navigate("tools/general") },
  ];

  const otherRows: Row[] = [
    { key: "disclaimer", label: "免责声明", icon: "info", onClick: () => setDisclaimerOpen(true) },
    {
      key: "about",
      label: "关于",
      icon: "emergency",
      detail: api.config.name,
      onClick: () => setAboutOpen(true),
    },
  ];

  return (
    <div className="fc-page">
      <div className={styles.toolbar}>
        <h1 className={styles.pageTitle}>工具</h1>
      </div>
      <div className="fc-page-body">
        {!hasPanelToken() && (
          <div className={styles.hint}>直接模式下，备份、访问控制等面板功能不可用。</div>
        )}
        <Section label="导航" rows={navRows} />
        <Section label="设置" rows={settingsRows} />
        <Section label="其他" rows={otherRows} />
      </div>
      {languageOpen && <LanguageSheet onClose={() => setLanguageOpen(false)} />}
      {shortcutsOpen && <ShortcutsSheet onClose={() => setShortcutsOpen(false)} />}
      {aboutOpen && <AboutSheet version={null} onClose={() => setAboutOpen(false)} />}
      {disclaimerOpen && <DisclaimerSheet onClose={() => setDisclaimerOpen(false)} />}
    </div>
  );
}

export function ToolsPageHeader(props: { title: string; actions?: ReactNode; onBack?: () => void }) {
  return (
    <div className={styles.subToolbar}>
      <button
        type="button"
        className={styles.back}
        aria-label="返回"
        onClick={props.onBack ?? (() => window.history.back())}
      >
        <Icon name="arrow_back" size={20} />
      </button>
      <h1 className={styles.subTitle}>{props.title}</h1>
      {props.actions && <div className={styles.actions}>{props.actions}</div>}
    </div>
  );
}
