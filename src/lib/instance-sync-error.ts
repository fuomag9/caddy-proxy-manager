export const GENERIC_INSTANCE_SYNC_ERROR = "Previous synchronization failed";
export const SYNC_TIMED_OUT_ERROR = "Sync timed out";
export const SYNC_NOT_ACKNOWLEDGED_ERROR = "Slave did not acknowledge the sync (unexpected response)";

const SAFE_SYNC_ERRORS = new Set([
  "Stored token could not be decrypted",
  "Stored instance sync token does not meet the current security policy",
  "HTTP sync blocked. Set INSTANCE_SYNC_ALLOW_HTTP=true to allow insecure sync.",
  "Sync request failed",
  SYNC_TIMED_OUT_ERROR,
  SYNC_NOT_ACKNOWLEDGED_ERROR,
  "Failed to apply synchronized configuration",
]);

/**
 * Older releases stored raw remote response bodies and exception messages.
 * Only allow current fixed operational statuses to cross API/browser reads.
 */
export function sanitizeInstanceSyncError(error: string | null | undefined): string | null {
  if (!error) return null;
  if (SAFE_SYNC_ERRORS.has(error) || /^Sync failed with HTTP [1-5][0-9]{2}$/.test(error)) {
    return error;
  }
  return GENERIC_INSTANCE_SYNC_ERROR;
}
