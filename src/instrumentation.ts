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
  }
}
