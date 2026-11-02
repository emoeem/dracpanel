import { useState } from "react";

import { useI18n } from "../../app/i18n";
import { Icon } from "../../components/Icon";
import { FcButton, FcIconButton, FcSegmented, FcSheet, FcSwitch } from "../../components/flclash";
import { cx } from "../../lib/cx";
import {
  DASHBOARD_GRID_COLUMNS,
  hiddenCount,
  movePlacement,
  updatePlacement,
  widgetDef,
  WIDGET_DEFS,
  type WidgetLayout,
} from "./widgets";
import styles from "./DashboardEditSheet.module.css";

interface DashboardEditSheetProps {
  layout: WidgetLayout;
  baseline: WidgetLayout;
  /** Functional updater: rapid toggles must not overwrite each other. */
  onChange: (update: (previous: WidgetLayout) => WidgetLayout) => void;
  onReset: () => void;
  onClose: () => void;
}

/**
 * "编辑仪表盘" — doona's widget library: visibility, order and per-widget
 * size. Width is a span slider bounded by the widget type; height is the
 * auto/1..N row choice. Every change is applied immediately and persisted by
 * the caller, so closing the sheet never loses work.
 */
export function DashboardEditSheet({
  layout,
  baseline,
  onChange,
  onReset,
  onClose,
}: DashboardEditSheetProps) {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState<string | null>(null);
  const hidden = hiddenCount(layout);
  const dirty = JSON.stringify(layout) !== JSON.stringify(baseline);

  return (
    <FcSheet
      title={t("Edit dashboard")}
      subtitle={t("Hidden widgets stay in the library and can be re-enabled here.")}
      wide
      onClose={onClose}
      footer={
        <div className={styles.footer}>
          <div className={styles.footerNote}>{t("Widget order defines the dashboard flow; sizes are constrained per widget type.")}</div>
          <div className={styles.footerActions}>
            {dirty && (
              <FcButton variant="text" onClick={() => onChange(() => baseline)}>
                {t("Undo changes")}
              </FcButton>
            )}
            <FcButton variant="text" onClick={onReset}>
              {t("Reset to defaults")}
            </FcButton>
            <FcButton variant="primary" onClick={onClose}>
              {t("Done")}
            </FcButton>
          </div>
        </div>
      }
    >
      <div className={styles.toolbar}>
        <span className={styles.libraryTitle}>{t("Widget library")}</span>
        <span className={styles.counter}>{t("{count} hidden", { count: hidden })}</span>
      </div>
      <ol className={styles.list}>
        {layout.placements.map((placement, index) => {
          const def = widgetDef(placement.id);
          if (def === null) {
            return null;
          }
          const isOpen = expanded === placement.id;
          return (
            <li
              key={placement.id}
              className={cx(styles.row, !placement.visible && styles.rowHidden)}
              data-widget={placement.id}
            >
              <div className={styles.rowMain}>
                <span className={styles.handle} aria-hidden="true">
                  <Icon name="drag_handle" size={16} />
                </span>
                <span className={styles.index}>{index + 1}</span>
                <span className={styles.titles}>
                  <span className={styles.title}>{t(def.title)}</span>
                  <span className={styles.meta}>
                    {t("Widget")} · {placement.span}/{DASHBOARD_GRID_COLUMNS} ·{" "}
                    {placement.rows === 0 ? t("Auto") : `${placement.rows} ×`}
                  </span>
                </span>
                <span className={styles.actions}>
                  <FcIconButton
                    label={t("Move up")}
                    disabled={index === 0}
                    onClick={() => onChange((previous) => movePlacement(previous, placement.id, -1))}
                  >
                    <Icon name="arrow_upward" size={16} />
                  </FcIconButton>
                  <FcIconButton
                    label={t("Move down")}
                    disabled={index === layout.placements.length - 1}
                    onClick={() => onChange((previous) => movePlacement(previous, placement.id, 1))}
                  >
                    <Icon name="arrow_downward" size={16} />
                  </FcIconButton>
                  <FcIconButton
                    label={t("Widget settings")}
                    aria-expanded={isOpen}
                    onClick={() => setExpanded(isOpen ? null : placement.id)}
                  >
                    <Icon name="tune" size={16} />
                  </FcIconButton>
                  <FcSwitch
                    checked={placement.visible}
                    label={`${t("Show")} ${t(def.title)}`}
                    onChange={(visible) => onChange((previous) => updatePlacement(previous, placement.id, { visible }))}
                  />
                </span>
              </div>
              {isOpen && (
                <div className={styles.settings}>
                  <label className={styles.field}>
                    <span className={styles.fieldLabel}>
                      {t("Width")}
                      <strong>
                        {placement.span}/{DASHBOARD_GRID_COLUMNS}
                      </strong>
                    </span>
                    <input
                      className={styles.slider}
                      type="range"
                      min={def.minSpan}
                      max={def.maxSpan}
                      step={1}
                      value={placement.span}
                      aria-label={`${t("Width")} ${t(def.title)}`}
                      onChange={(event) =>
                        onChange((previous) =>
                          updatePlacement(previous, placement.id, { span: Number(event.target.value) }),
                        )
                      }
                    />
                  </label>
                  <div className={styles.field}>
                    <span className={styles.fieldLabel}>{t("Height")}</span>
                    <FcSegmented
                      ariaLabel={`${t("Height")} ${t(def.title)}`}
                      value={String(placement.rows)}
                      onChange={(value) =>
                        onChange((previous) => updatePlacement(previous, placement.id, { rows: Number(value) }))
                      }
                      options={[
                        { value: "0", label: t("Auto") },
                        ...Array.from({ length: def.maxRows - def.minRows + 1 }, (_, offset) => {
                          const rows = def.minRows + offset;
                          return { value: String(rows), label: `${rows} ×` };
                        }),
                      ]}
                    />
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ol>
      <div className={styles.legend}>
        {WIDGET_DEFS.length} {t("Widget")} · {t("Each widget constrains its own width and height")}
      </div>
    </FcSheet>
  );
}
