import { proxyDisplayType, urlTestDelayTone } from "../../api/format";
import { useStream } from "../../api/stream";
import { navigate, useApi } from "../../app/context";
import { showError } from "../../app/errorStore";
import { useI18n } from "../../app/i18n";
import { usePendingValue } from "../../app/hooks";
import { Badge, Select, Spinner } from "../../components/ui";
import type { Group } from "../../gen/daemon/started_service_pb";
import styles from "./cards.module.css";

const MAX_GROUPS = 4;

function delayBadge(delay: number) {
  if (delay <= 0) {
    return null;
  }
  return <Badge tone={urlTestDelayTone(delay)}>{`${delay} ms`}</Badge>;
}

/** Quick proxy-group switcher (FlClash dashboard proxy group card). */
export function ProxyGroupsCard() {
  const api = useApi();
  const { t } = useI18n();
  const groups = useStream(api.groups);
  const loaded = groups.data.loaded;

  if (groups.phase === "error") {
    return (
      <span className={styles.unavailable}>
        {t("Proxy groups are unavailable while the core is unreachable.")}
      </span>
    );
  }
  if (!loaded && groups.phase !== "active") {
    return <Spinner />;
  }

  const visible = groups.data.groups.slice(0, MAX_GROUPS);
  if (visible.length === 0) {
    return <span className={styles.unavailable}>{t("No proxy groups in this configuration.")}</span>;
  }

  return (
    <>
      <div>
        {visible.map((group) => (
          <GroupRow key={group.tag} group={group} />
        ))}
      </div>
      {groups.data.groups.length > MAX_GROUPS && (
        <button type="button" className={styles.linkButton} onClick={() => navigate("proxies")}>
          {t("View all")}
        </button>
      )}
    </>
  );
}

function GroupRow(props: { group: Group }) {
  const api = useApi();
  const group = props.group;
  const [pending, setPending] = usePendingValue(group.selected);
  const selected = pending ?? group.selected;
  const selectable = group.selectable && group.type === "selector";
  const selectedItem = group.items.find((item) => item.tag === selected);

  return (
    <div className={styles.groupRow}>
      <div className={styles.groupMeta}>
        <span className={styles.groupName}>
          {group.tag}
          <span className={styles.groupSelected}>
            {" · "}
            {proxyDisplayType(group.type)}
          </span>
        </span>
        <span className={styles.groupSelected}>
          {selected}
          {selectedItem && selectedItem.urlTestDelay > 0
            ? ` · ${selectedItem.urlTestDelay} ms`
            : ""}
        </span>
      </div>
      {selectable ? (
        <div className={styles.groupSelect}>
          <Select
            inline
            options={group.items.map((item) => ({ value: item.tag, label: item.tag }))}
            value={selected}
            onChange={(tag) => {
              setPending(tag);
              api.selectOutbound(group.tag, tag).catch((error: unknown) => {
                setPending(null);
                showError(error);
              });
            }}
          />
        </div>
      ) : (
        delayBadge(selectedItem?.urlTestDelay ?? 0)
      )}
    </div>
  );
}
