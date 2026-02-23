/**
 * Caddy health monitoring service
 * Monitors Caddy for restarts/crashes and automatically reapplies configuration
 */

import { config } from "./config";
import { applyCaddyConfig } from "./caddy";
import { getSetting, setSetting } from "./settings";

type CaddyMonitorState = {
  isHealthy: boolean;
  lastConfigId: string | null;
  lastCheckTime: number;
  consecutiveFailures: number;
};

const HEALTH_CHECK_INTERVAL = 10000; // Check every 10 seconds
const MAX_CONSECUTIVE_FAILURES = 3; // Consider unhealthy after 3 failures
const REAPPLY_DELAY = 5000; // Wait 5 seconds after detecting restart before reapplying

let monitorState: CaddyMonitorState = {
  isHealthy: false,
  lastConfigId: null,
  lastCheckTime: 0,
  consecutiveFailures: 0
};

let monitorInterval: NodeJS.Timeout | null = null;
let isMonitoring = false;

/**
 * Get the current Caddy config ID from the admin API
 * This is used to detect when Caddy has restarted (config ID changes)
 */
async function getCaddyConfigId(): Promise<string | null> {
  try {
    const response = await fetch(`${config.caddyApiUrl}/config/`, {
      method: "GET",
      headers: { "Origin": config.caddyApiUrl },
      signal: AbortSignal.timeout(5000)
    });

    if (!response.ok) {
      return null;
    }

    // Use ETag or compute a simple hash from the response
    const etag = response.headers.get("etag");
    if (etag) {
      return etag;
    }

    // Fallback: use the config object's structure
    const configData = await response.json();
    // Check if config is essentially empty (default state after restart)
    const isEmpty = !configData.apps || Object.keys(configData.apps).length === 0;
    return isEmpty ? "empty" : "configured";
  } catch (error) {
    // Network error or timeout
    return null;
  }
}

/**
 * Check if Caddy is healthy and detect restarts
 */
async function checkCaddyHealth(): Promise<void> {
  const now = Date.now();
  monitorState.lastCheckTime = now;

  const currentConfigId = await getCaddyConfigId();

  if (currentConfigId === null) {
    // Caddy is not responding
    monitorState.consecutiveFailures++;

    if (monitorState.isHealthy && monitorState.consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
      console.warn(
        `[CaddyMonitor] Caddy appears to be down (${monitorState.consecutiveFailures} consecutive failures)`
      );
      monitorState.isHealthy = false;
    }
    return;
  }

  // Caddy is responding
  const wasUnhealthy = !monitorState.isHealthy;
  monitorState.consecutiveFailures = 0;
  monitorState.isHealthy = true;

  // Detect restart: config ID changed to "empty" or Caddy was previously unhealthy
  const hasRestarted =
    (monitorState.lastConfigId !== null && currentConfigId === "empty") ||
    (wasUnhealthy && currentConfigId === "empty");

  if (hasRestarted) {
    console.log("[CaddyMonitor] Caddy restart detected! Waiting before reapplying configuration...");

    // Wait a bit for Caddy to fully initialize
    setTimeout(async () => {
      try {
        console.log("[CaddyMonitor] Reapplying Caddy configuration after restart...");
        await applyCaddyConfig();
        console.log("[CaddyMonitor] Configuration reapplied successfully");

        // Update the config ID after successful reapplication
        const newConfigId = await getCaddyConfigId();
        monitorState.lastConfigId = newConfigId;
      } catch (error) {
        console.error("[CaddyMonitor] Failed to reapply configuration after restart:", error);
        // Will retry on next health check
      }
    }, REAPPLY_DELAY);
  } else if (monitorState.lastConfigId === null) {
    // First time seeing Caddy healthy
    console.log("[CaddyMonitor] Caddy health monitoring initialized");
    monitorState.lastConfigId = currentConfigId;
  } else {
    // Normal operation, update last known config ID
    monitorState.lastConfigId = currentConfigId;
  }
}

/**
 * Start monitoring Caddy health
 */
export function startCaddyMonitoring(): void {
  if (isMonitoring) {
    console.log("[CaddyMonitor] Already monitoring");
    return;
  }

  console.log(`[CaddyMonitor] Starting Caddy health monitoring (interval: ${HEALTH_CHECK_INTERVAL}ms)`);
  isMonitoring = true;

  // Do initial check immediately
  checkCaddyHealth().catch((error) => {
    console.error("[CaddyMonitor] Initial health check failed:", error);
  });

  // Set up periodic checks
  monitorInterval = setInterval(() => {
    checkCaddyHealth().catch((error) => {
      console.error("[CaddyMonitor] Health check failed:", error);
    });
  }, HEALTH_CHECK_INTERVAL);
}

/**
 * Stop monitoring Caddy health
 */
export function stopCaddyMonitoring(): void {
  if (!isMonitoring) {
    return;
  }

  console.log("[CaddyMonitor] Stopping Caddy health monitoring");
  isMonitoring = false;

  if (monitorInterval) {
    clearInterval(monitorInterval);
    monitorInterval = null;
  }
}

/**
 * Get current monitoring state (useful for debugging)
 */
export function getMonitorState(): Readonly<CaddyMonitorState> {
  return { ...monitorState };
}
