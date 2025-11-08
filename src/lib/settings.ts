import db, { nowIso } from "./db";
import { settings } from "./db/schema";
import { eq } from "drizzle-orm";

export type SettingValue<T> = T | null;

export type CloudflareSettings = {
  apiToken: string;
  zoneId?: string;
  accountId?: string;
};

export type GeneralSettings = {
  primaryDomain: string;
  acmeEmail?: string;
};

export type AuthentikSettings = {
  outpostDomain: string;
  outpostUpstream: string;
  authEndpoint?: string;
};

export async function getSetting<T>(key: string): Promise<SettingValue<T>> {
  const setting = await db.query.settings.findFirst({
    where: (table, { eq }) => eq(table.key, key)
  });

  if (!setting) {
    return null;
  }

  try {
    return JSON.parse(setting.value) as T;
  } catch (error) {
    console.warn(`Failed to parse setting ${key}`, error);
    return null;
  }
}

export async function setSetting<T>(key: string, value: T): Promise<void> {
  const payload = JSON.stringify(value);
  const now = nowIso();

  await db
    .insert(settings)
    .values({
      key,
      value: payload,
      updatedAt: now
    })
    .onConflictDoUpdate({
      target: settings.key,
      set: {
        value: payload,
        updatedAt: now
      }
    });
}

export async function getCloudflareSettings(): Promise<CloudflareSettings | null> {
  return await getSetting<CloudflareSettings>("cloudflare");
}

export async function saveCloudflareSettings(settings: CloudflareSettings): Promise<void> {
  await setSetting("cloudflare", settings);
}

export async function getGeneralSettings(): Promise<GeneralSettings | null> {
  return await getSetting<GeneralSettings>("general");
}

export async function saveGeneralSettings(settings: GeneralSettings): Promise<void> {
  await setSetting("general", settings);
}

export async function getAuthentikSettings(): Promise<AuthentikSettings | null> {
  return await getSetting<AuthentikSettings>("authentik");
}

export async function saveAuthentikSettings(settings: AuthentikSettings): Promise<void> {
  await setSetting("authentik", settings);
}
