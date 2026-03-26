import { NextRequest, NextResponse } from "next/server";
import { requireApiAdmin, apiErrorResponse } from "@/src/lib/api-auth";
import {
  getGeneralSettings, saveGeneralSettings,
  getCloudflareSettings, saveCloudflareSettings,
  getAuthentikSettings, saveAuthentikSettings,
  getMetricsSettings, saveMetricsSettings,
  getLoggingSettings, saveLoggingSettings,
  getDnsSettings, saveDnsSettings,
  getUpstreamDnsResolutionSettings, saveUpstreamDnsResolutionSettings,
  getGeoBlockSettings, saveGeoBlockSettings,
  getWafSettings, saveWafSettings,
} from "@/src/lib/settings";
import { getInstanceMode, setInstanceMode, getSlaveMasterToken, setSlaveMasterToken } from "@/src/lib/instance-sync";
import { applyCaddyConfig } from "@/src/lib/caddy";

type SettingsHandler = {
  get: () => Promise<unknown>;
  save: (data: never) => Promise<void>;
  applyCaddy?: boolean;
};

const SETTINGS_HANDLERS: Record<string, SettingsHandler> = {
  general: { get: getGeneralSettings, save: saveGeneralSettings as (data: never) => Promise<void>, applyCaddy: true },
  cloudflare: { get: getCloudflareSettings, save: saveCloudflareSettings as (data: never) => Promise<void>, applyCaddy: true },
  authentik: { get: getAuthentikSettings, save: saveAuthentikSettings as (data: never) => Promise<void>, applyCaddy: true },
  metrics: { get: getMetricsSettings, save: saveMetricsSettings as (data: never) => Promise<void>, applyCaddy: true },
  logging: { get: getLoggingSettings, save: saveLoggingSettings as (data: never) => Promise<void>, applyCaddy: true },
  dns: { get: getDnsSettings, save: saveDnsSettings as (data: never) => Promise<void>, applyCaddy: true },
  "upstream-dns": { get: getUpstreamDnsResolutionSettings, save: saveUpstreamDnsResolutionSettings as (data: never) => Promise<void>, applyCaddy: true },
  geoblock: { get: getGeoBlockSettings, save: saveGeoBlockSettings as (data: never) => Promise<void>, applyCaddy: true },
  waf: { get: getWafSettings, save: saveWafSettings as (data: never) => Promise<void>, applyCaddy: true },
};

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ group: string }> }
) {
  try {
    await requireApiAdmin(request);
    const { group } = await params;

    if (group === "instance-mode") {
      const mode = await getInstanceMode();
      return NextResponse.json({ mode });
    }

    if (group === "sync-token") {
      const token = await getSlaveMasterToken();
      return NextResponse.json({ has_token: token !== null });
    }

    const handler = SETTINGS_HANDLERS[group];
    if (!handler) {
      return NextResponse.json({ error: "Unknown settings group" }, { status: 404 });
    }

    const settings = await handler.get();
    return NextResponse.json(settings ?? {});
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ group: string }> }
) {
  try {
    await requireApiAdmin(request);
    const { group } = await params;
    const body = await request.json();

    if (group === "instance-mode") {
      await setInstanceMode(body.mode);
      return NextResponse.json({ ok: true });
    }

    if (group === "sync-token") {
      await setSlaveMasterToken(body.token ?? null);
      return NextResponse.json({ ok: true });
    }

    const handler = SETTINGS_HANDLERS[group];
    if (!handler) {
      return NextResponse.json({ error: "Unknown settings group" }, { status: 404 });
    }

    await handler.save(body as never);

    if (handler.applyCaddy) {
      try {
        await applyCaddyConfig();
      } catch (e) {
        console.error("Failed to apply Caddy config after settings update:", e);
      }
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
