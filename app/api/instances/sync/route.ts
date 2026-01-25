import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import { applyCaddyConfig } from "@/src/lib/caddy";
import { applySyncPayload, getInstanceMode, getSlaveMasterToken, setSlaveLastSync, SyncPayload } from "@/src/lib/instance-sync";

/**
 * Timing-safe token comparison to prevent timing attacks
 */
function secureTokenCompare(a: string, b: string): boolean {
  if (a.length !== b.length) {
    // Compare against dummy to maintain constant time
    const dummy = Buffer.alloc(a.length, 0);
    timingSafeEqual(Buffer.from(a), dummy);
    return false;
  }
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

/**
 * Validates that the payload has the expected structure for syncing
 */
function isValidSyncPayload(payload: unknown): payload is SyncPayload {
  if (payload === null || typeof payload !== "object") {
    return false;
  }

  const p = payload as Record<string, unknown>;

  // Check required top-level properties
  if (!("settings" in p) || !("data" in p)) {
    return false;
  }

  // Validate settings is an object
  if (p.settings !== null && typeof p.settings !== "object") {
    return false;
  }

  // Validate data has required array properties
  const data = p.data;
  if (data === null || typeof data !== "object") {
    return false;
  }

  const d = data as Record<string, unknown>;
  const requiredArrays = ["certificates", "accessLists", "accessListEntries", "proxyHosts", "redirectHosts", "deadHosts"];

  for (const key of requiredArrays) {
    if (!(key in d) || !Array.isArray(d[key])) {
      return false;
    }
  }

  return true;
}

export async function POST(request: NextRequest) {
  const mode = await getInstanceMode();
  if (mode !== "slave") {
    return NextResponse.json({ error: "Instance is not configured as a slave" }, { status: 403 });
  }

  const authHeader = request.headers.get("authorization") ?? "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  const expected = await getSlaveMasterToken();

  if (!expected || !secureTokenCompare(token, expected)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch (error) {
    return NextResponse.json({ error: "Invalid JSON payload" }, { status: 400 });
  }

  if (!isValidSyncPayload(payload)) {
    return NextResponse.json({ error: "Invalid sync payload structure" }, { status: 400 });
  }

  try {
    await applySyncPayload(payload);
    await applyCaddyConfig();
    await setSlaveLastSync({ ok: true });
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to apply sync payload";
    await setSlaveLastSync({ ok: false, error: message });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
