import type { DaemonApi } from "../api/daemon";
import { resyncAfterConfigChange } from "../api/panel";

/**
 * Refreshes the native API connection after the panel rewrote the sing-box
 * configuration; a changed API service reloads the page so every stream
 * reconnects against the new endpoint.
 */
export async function afterConfigChange(api: DaemonApi): Promise<void> {
  const result = await resyncAfterConfigChange();
  if (result.serverChanged) {
    window.location.reload();
    return;
  }
  api.reconnectNow();
}
