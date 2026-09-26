/**
 * Next.js instrumentation hook - runs once when the server starts
 * https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation
 */
export async function register() {
  // Only run on the server side
  if (process.env.NEXT_RUNTIME === "nodejs") {
    // Validate production configuration early to catch misconfigurations
    const { validateProductionConfig } = await import("./lib/config");
    try {
      validateProductionConfig();
    } catch (error) {
      console.error("Configuration validation failed:", error);
      if (process.env.NODE_ENV === "production") {
        // Fail fast in production with bad config
        throw error;
      }
    }

    const { ensureAdminUser } = await import("./lib/init-db");
    try {
      await ensureAdminUser();
      console.log("Database initialization complete");
    } catch (error) {
      console.error("Failed to initialize database:", error);
      // Don't throw - let the app start anyway, errors will surface when users try to use features
    }

    // After the environment admin, so its username is taken first.
    const { repairLoginUsernames } = await import("./lib/models/user");
    try {
      for (const { userId, username } of await repairLoginUsernames()) {
        console.log(`Gave user ${userId} the sign-in username ${username}`);
      }
    } catch (error) {
      console.error("Failed to repair sign-in usernames:", error);
    }

    // Imported keys and provider options could contain plaintext secrets in
    // older releases. Repair them before any request handler reads the rows.
    const { migrateLegacyCertificateStorage } = await import("./lib/models/certificates");
    try {
      const migrated = await migrateLegacyCertificateStorage();
      if (migrated > 0) {
        console.log(`Hardened ${migrated} legacy certificate record(s)`);
      }
    } catch (error) {
      console.error("Failed to harden legacy certificate storage");
      if (process.env.NODE_ENV === "production") throw error;
    }

    const { migrateLegacyCaPrivateKeys } = await import("./lib/models/ca-certificates");
    try {
      const migrated = await migrateLegacyCaPrivateKeys();
      if (migrated > 0) {
        console.log(`Encrypted ${migrated} legacy CA private key(s)`);
      }
    } catch (error) {
      console.error("Failed to encrypt legacy CA private keys");
      if (process.env.NODE_ENV === "production") throw error;
    }

    // After a SESSION_SECRET rotation, re-encrypt stored secrets that only an
    // old key (SESSION_SECRET_PREVIOUS or a rejected placeholder) decrypts,
    // and encrypt DNS provider / Cloudflare credentials stored in plaintext, before
    // anything reads them to build the Caddy configuration.
    const { reencryptStoredSecrets } = await import("./lib/secret-rotation");
    try {
      const { reencrypted, encryptedPlaintext, failed, clearedOAuthTokens } = await reencryptStoredSecrets();
      if (reencrypted > 0) {
        console.log(`Re-encrypted ${reencrypted} stored secret(s) with the current SESSION_SECRET`);
      }
      if (encryptedPlaintext > 0) {
        console.log(`Encrypted ${encryptedPlaintext} DNS provider credential(s) that were stored in plaintext`);
      }
      if (clearedOAuthTokens > 0) {
        console.log(
          `Cleared ${clearedOAuthTokens} stored OAuth sign-in token(s) that no key decrypts; ` +
          "CPM does not use them and the next OAuth sign-in stores new ones"
        );
      }
      if (failed > 0) {
        console.warn(
          `${failed} stored secret(s) listed above could not be decrypted with SESSION_SECRET or SESSION_SECRET_PREVIOUS; ` +
          "re-enter them in the UI or set SESSION_SECRET_PREVIOUS to the secret they were stored with"
        );
      }
    } catch (error) {
      // Values that were not re-encrypted still decrypt with the fallback keys.
      console.error("Failed to re-encrypt stored secrets:", error);
    }

    // Apply Caddy configuration from database on startup
    const { applyCaddyConfig } = await import("./lib/caddy");
    try {
      console.log("Applying Caddy configuration from database...");
      await applyCaddyConfig();
      console.log("Caddy configuration applied successfully");
    } catch (error) {
      console.error("Failed to apply Caddy configuration on startup:", error);
      // Don't throw - Caddy might not be ready yet, or config might be applied later
      // This ensures proxy hosts work after container restart
    }

    // Start Caddy health monitoring to detect restarts and auto-reapply config
    const { startCaddyMonitoring } = await import("./lib/caddy-monitor");
    try {
      startCaddyMonitoring();
      console.log("Caddy health monitoring started");
    } catch (error) {
      console.error("Failed to start Caddy health monitoring:", error);
      // Don't throw - monitoring is a nice-to-have feature
    }

    // Initialize ClickHouse analytics database
    const { initClickHouse, closeClickHouse } = await import("./lib/clickhouse/client");
    try {
      await initClickHouse();
      console.log("ClickHouse analytics initialized");
    } catch (error) {
      console.error("Failed to initialize ClickHouse:", error);
      // Don't throw - analytics is non-critical
    }

    // Start log parser for analytics
    const { initLogParser, parseNewLogEntries, stopLogParser } = await import("./lib/log-parser");
    try {
      await initLogParser();
      const logParserInterval = setInterval(async () => {
        try {
          await parseNewLogEntries();
        } catch (err) {
          console.error("Log parser interval error:", err);
        }
      }, 30_000);
      process.on("SIGTERM", () => {
        stopLogParser();
        clearInterval(logParserInterval);
        closeClickHouse();
      });
      console.log("Log parser started");
    } catch (error) {
      console.error("Failed to start log parser:", error);
    }

    // Start WAF log parser for WAF event tracking
    const { initWafLogParser, parseNewWafLogEntries, stopWafLogParser } = await import("./lib/waf-log-parser");
    try {
      await initWafLogParser();
      const wafParserInterval = setInterval(async () => {
        try {
          await parseNewWafLogEntries();
        } catch (err) {
          console.error("WAF log parser interval error:", err);
        }
      }, 30_000);
      process.on("SIGTERM", () => {
        stopWafLogParser();
        clearInterval(wafParserInterval);
      });
      console.log("WAF log parser started");
    } catch (error) {
      console.error("Failed to start WAF log parser:", error);
    }

    // Start periodic instance sync if configured (master mode only)
    const { getInstanceMode, getSyncIntervalMs, runPeriodicInstanceSync } = await import("./lib/instance-sync");
    try {
      const mode = await getInstanceMode();
      const intervalMs = getSyncIntervalMs();

      if (mode === "master" && intervalMs > 0) {
        console.log(`Starting periodic instance sync (every ${intervalMs / 1000}s)`);
        setInterval(async () => {
          try {
            const result = await runPeriodicInstanceSync();
            if (result === null) {
              console.warn("Periodic sync skipped: the previous sync is still running");
            } else if (result.total > 0) {
              console.log(`Periodic sync completed: ${result.success}/${result.total} succeeded`);
            }
          } catch (error) {
            console.error("Periodic sync failed:", error);
          }
        }, intervalMs);
      }
    } catch (error) {
      console.error("Failed to start periodic instance sync:", error);
      // Don't throw - periodic sync is optional
    }
  }
}
