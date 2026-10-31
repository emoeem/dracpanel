import { useState } from "react";

import {
  ACCENT_PRESETS,
  loadAccentPreference,
  loadAmoledPreference,
  loadThemePreference,
  saveAccentPreference,
  saveAmoledPreference,
  saveThemePreference,
  useApi,
  type AccentPreset,
  type ThemePreference,
} from "../../app/context";
import { navigate } from "../../app/context";
import { FcCard } from "../../components/flclash";
import { cx } from "../../lib/cx";
import { ToolsPageHeader } from "./ToolsView";
import styles from "./ThemeView.module.css";

const ACCENT_LABELS: Record<AccentPreset, string> = {
  default: "默认",
  blue: "蓝",
  purple: "紫",
  pink: "粉",
  red: "红",
  orange: "橙",
  yellow: "黄",
  green: "绿",
  graphite: "灰",
};

const THEME_MODES: { value: ThemePreference; label: string }[] = [
  { value: "auto", label: "自动" },
  { value: "light", label: "浅色" },
  { value: "dark", label: "深色" },
];

export function ThemeView() {
  useApi();
  const [theme, setTheme] = useState<ThemePreference>(loadThemePreference);
  const [amoled, setAmoled] = useState(() => loadAmoledPreference());
  const [accent, setAccent] = useState(loadAccentPreference);

  const updateTheme = (next: ThemePreference) => {
    setTheme(next);
    saveThemePreference(next);
  };

  const updateAmoled = (next: boolean) => {
    setAmoled(next);
    saveAmoledPreference(next);
  };

  const updateAccent = (next: AccentPreference) => {
    setAccent(next);
    saveAccentPreference(next);
  };

  return (
    <div className="fc-page">
      <ToolsPageHeader title="主题" onBack={() => navigate("tools")} />
      <div className="fc-page-body">
        <FcCard className={styles.card}>
          <h2 className={styles.cardTitle}>主题模式</h2>
          <div className={styles.segmented}>
            {THEME_MODES.map((mode) => (
              <button
                key={mode.value}
                type="button"
                className={cx(styles.segment, theme === mode.value && styles.segmentActive)}
                onClick={() => updateTheme(mode.value)}
              >
                {mode.label}
              </button>
            ))}
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={amoled}
            className={styles.row}
            onClick={() => updateAmoled(!amoled)}
          >
            <span className={styles.rowText}>
              <span className={styles.rowLabel}>纯黑</span>
              <span className={styles.rowDetail}>深色模式下使用纯黑背景（AMOLED 友好）</span>
            </span>
            <span className={styles.switchTrack} data-on={amoled}>
              <span className={styles.switchThumb} />
            </span>
          </button>
        </FcCard>

        <FcCard className={styles.card}>
          <h2 className={styles.cardTitle}>主题色彩</h2>
          <div className={styles.swatches}>
            {ACCENT_PRESETS.map((preset) => (
              <button
                key={preset}
                type="button"
                className={cx(styles.swatch, accent === preset && styles.swatchActive)}
                data-accent={preset}
                aria-label={ACCENT_LABELS[preset]}
                title={ACCENT_LABELS[preset]}
                onClick={() => updateAccent(preset)}
              />
            ))}
          </div>
          <p className={styles.hint}>主题色彩：{ACCENT_LABELS[accent as AccentPreset] ?? accent}</p>
        </FcCard>
      </div>
    </div>
  );
}

type AccentPreference = AccentPreset | (string & {});
