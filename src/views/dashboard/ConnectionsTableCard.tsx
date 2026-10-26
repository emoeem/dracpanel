import { formatBytes } from "../../api/format";
import { useStream } from "../../api/stream";
import { navigate, useApi } from "../../app/context";
import { useI18n } from "../../app/i18n";
import {
  activeConnectionRows,
  connectionChain,
  connectionHost,
  connectionProcessName,
} from "../../lib/connectionTools";
import { Spinner } from "../../components/ui";
import styles from "./cards.module.css";

const MAX_ROWS = 6;

/** Top active connections by current throughput (FlClash live connections card). */
export function ConnectionsTableCard() {
  const api = useApi();
  const { t } = useI18n();
  const connections = useStream(api.connections);

  if (connections.phase === "error") {
    return (
      <span className={styles.unavailable}>
        {t("Connections are unavailable while the core is unreachable.")}
      </span>
    );
  }
  if (!connections.data.loaded && connections.phase !== "active") {
    return <Spinner />;
  }

  const active = activeConnectionRows([...connections.data.rows.values()])
    .sort(
      (left, right) =>
        right.uplinkRate + right.downlinkRate - (left.uplinkRate + left.downlinkRate),
    )
    .slice(0, MAX_ROWS);

  if (active.length === 0) {
    return <span className={styles.unavailable}>{t("No active connections")}</span>;
  }

  return (
    <>
      <table className={styles.connTable}>
        <thead>
          <tr>
            <th>{t("Process")}</th>
            <th>{t("Target")}</th>
            <th>{t("Chain")}</th>
            <th>{t("Downlink")}</th>
            <th>{t("Uplink")}</th>
          </tr>
        </thead>
        <tbody>
          {active.map((row) => (
            <tr key={row.connection.id ?? connectionHost(row)}>
              <td>{connectionProcessName(row) || "—"}</td>
              <td title={connectionHost(row)}>{connectionHost(row)}</td>
              <td title={connectionChain(row)}>{connectionChain(row) || "—"}</td>
              <td className={styles.num}>{formatBytes(row.downlinkRate) + "/s"}</td>
              <td className={styles.num}>{formatBytes(row.uplinkRate) + "/s"}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <button type="button" className={styles.linkButton} onClick={() => navigate("connections")}>
        {t("View all")}
      </button>
    </>
  );
}
