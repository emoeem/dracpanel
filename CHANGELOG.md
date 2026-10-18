# Changelog

## 0.1.0 — 2026-10-18

### Added

- **Proxies:** node search, name/latency sorting, hide-unavailable filter;
  per-node latency history with optional automatic URLTest (off / 5 / 15 / 30 min).
- **Rules:** keyword search, action/outbound filters and sorting across route,
  DNS and rule-set tabs.
- **Logs:** log-type filter, hide-regex, configurable retention, pause and
  export.
- **Connections:** pause, arbitrary-field sorting, grouping by host/process/
  outbound/rule/source, source-IP/TCP/UDP/hide-chain filters, CSV/JSON export,
  close-filtered batching, and destination GeoIP details.
- **Overview:** traffic history (1m/5m/1h), connection-count history and a
  connection-history aggregation card with clear action.
- **Tools:** DNS query against the sing-box Clash API, DNS/FakeIP cache flush,
  and per-node/multi-target connectivity tests.
- **Validation:** regression coverage for connection filtering/sorting/grouping,
  CSV escaping, latency-history deduplication, connection-history clearing and
  auto-test preferences.

### Changed

- Renamed the project from **Dracula Panel for sing-box** to **DracPanel**.
- Repository renamed to `dracpanel`.
- Source deployment path is now `/usr/local/share/dracpanel-ui`.
- Arch package is now `dracpanel`; installed UI path is `/usr/share/dracpanel/ui`.
- README, DEPLOYMENT, NOTICE, LICENSE and acceptance scripts use the new name.
- Dracula/Alucard remain the names of the color themes; only the project name
  changed.

### Fixed

- Log types are parsed from sing-box's real `tag: message` observable format,
  including `[id duration]` prefixes and namespaced tags such as
  `inbound/tun[tun-in]`.
- Connection-history clear now removes closed rows from the daemon-side stream,
  not just the card aggregation.
- Status traffic history is reset when the core enters `STARTING`.
- Filtered batch close uses bounded concurrency and reports aggregate failures.
