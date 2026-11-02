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
import { useI18n, type MessageKey } from "../../app/i18n";
import { FcCard } from "../../components/flclash";
import { cx } from "../../lib/cx";
import { ToolsPageHeader } from "./ToolsView";
import styles from "./ThemeView.module.css";

const ACCENT_LABELS: Record<AccentPreset, MessageKey> = {
  default: "Default",
  blue: "Blue",
  purple: "Purple",
  pink: "Pink",
  red: "Red",
  orange: "Orange",
  yellow: "Yellow",
  green: "Green",
  graphite: "Graphite",
};

const THEME_MODES: { value: ThemePreference; label: MessageKey }[] = [
  { value: "auto", label: "Auto" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

export function ThemeView() {
  useApi();
  const { t } = useI18n();
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
      <ToolsPageHeader title={t("Theme")} onBack={() => navigate("tools")} />
      <div className="fc-page-body">
        <FcCard className={styles.card}>
          <h2 className={styles.cardTitle}>{t("Theme mode")}</h2>
          <div className={styles.segmented}>
            {THEME_MODES.map((mode) => (
              <button
                key={mode.value}
                type="button"
                className={cx(styles.segment, theme === mode.value && styles.segmentActive)}
                onClick={() => updateTheme(mode.value)}
              >
                {t(mode.label)}
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
              <span className={styles.rowLabel}>{t("Pure black")}</span>
              <span className={styles.rowDetail}>{t("Dark mode uses a pure black background (AMOLED friendly)")}</span>
            </span>
            <span className={styles.switchTrack} data-on={amoled}>
              <span className={styles.switchThumb} />
            </span>
          </button>
        </FcCard>

        <FcCard className={styles.card}>
          <h2 className={styles.cardTitle}>{t("Accent color")}</h2>
          <div className={styles.swatches}>
            {ACCENT_PRESETS.map((preset) => (
              <button
                key={preset}
                type="button"
                className={cx(styles.swatch, accent === preset && styles.swatchActive)}
                data-accent={preset}
                aria-label={t(ACCENT_LABELS[preset])}
                title={t(ACCENT_LABELS[preset])}
                onClick={() => updateAccent(preset)}
              />
            ))}
          </div>
          <p className={styles.hint}>
            {t("Accent color: {name}", {
              name: ACCENT_LABELS[accent as AccentPreset]
                ? t(ACCENT_LABELS[accent as AccentPreset])
                : accent,
            })}
          </p>
        </FcCard>
      </div>
    </div>
  );
}

type AccentPreference = AccentPreset | (string & {});
