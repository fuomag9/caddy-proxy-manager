import bcrypt from "bcryptjs";
import { createHmac } from "node:crypto";
import db, { nowIso } from "./db";
import { config } from "./config";
import { users, accounts, settings } from "./db/schema";
import { and, eq } from "drizzle-orm";
import { CREDENTIAL_ACCOUNT_ISSUER } from "./account-issuer";

/**
 * Settings key holding a keyed fingerprint of the ADMIN_USERNAME/ADMIN_PASSWORD
 * pair last applied to the primary admin. The environment credentials are
 * re-applied only when that pair changes, so a password changed in the UI is
 * not silently reverted to the environment value on every restart.
 */
const ADMIN_ENV_FINGERPRINT_KEY = "admin_env_credentials_fingerprint";

function adminEnvFingerprint(): string {
  return createHmac("sha256", config.sessionSecret)
    .update(`cpm-admin-env-credentials:v1\0${config.adminUsername}\0${config.adminPassword}`)
    .digest("hex");
}

async function getStoredAdminEnvFingerprint(): Promise<string | null> {
  const row = await db.select().from(settings).where(eq(settings.key, ADMIN_ENV_FINGERPRINT_KEY)).get();
  if (!row) return null;
  try {
    const value = JSON.parse(row.value);
    return typeof value === "string" ? value : null;
  } catch {
    return null;
  }
}

async function storeAdminEnvFingerprint(fingerprint: string): Promise<void> {
  const now = nowIso();
  const value = JSON.stringify(fingerprint);
  await db
    .insert(settings)
    .values({ key: ADMIN_ENV_FINGERPRINT_KEY, value, updatedAt: now })
    .onConflictDoUpdate({ target: settings.key, set: { value, updatedAt: now } });
}

/**
 * Ensures the admin user from environment variables exists in the database.
 * This is called during application startup.
 * The password from environment variables is hashed and stored securely.
 */

//Todo: this could probably be handled better, especially for the adminid.
export async function ensureAdminUser(): Promise<void> {
  const adminId = 1; // Must match the hardcoded ID in auth.ts
  const adminEmail = `${config.adminUsername}@localhost`;
  const provider = "credentials";
  const subject = config.adminUsername;

  const fingerprint = adminEnvFingerprint();

  // Check if admin user already exists
  const existingUser = await db.query.users.findFirst({
    where: (table, { eq }) => eq(table.id, adminId)
  });

  if (existingUser) {
    const storedFingerprint = await getStoredAdminEnvFingerprint();
    // Before the fingerprint existed, every start re-applied the environment
    // password. On that first start, keep a password that no longer matches
    // the environment: it was changed in the UI since the last restart.
    const applyEnvCredentials = storedFingerprint === null
      ? !existingUser.passwordHash || bcrypt.compareSync(config.adminPassword, existingUser.passwordHash)
      : storedFingerprint !== fingerprint;

    const now = nowIso();
    if (applyEnvCredentials) {
      // The operator set new environment credentials: apply them, and make
      // sure the primary admin is an admin again (the documented recovery path).
      const passwordHash = bcrypt.hashSync(config.adminPassword, 12);
      await db
        .update(users)
        .set({
          email: adminEmail,
          subject,
          passwordHash,
          role: "admin",
          username: config.adminUsername.toLowerCase(),
          displayUsername: config.adminUsername,
          updatedAt: now
        })
        .where(eq(users.id, adminId));
      // Ensure credential account row exists for Better Auth
      await ensureCredentialAccount(adminId, passwordHash);
      console.log(`Applied admin credentials from environment: ${config.adminUsername}`);
    } else {
      // Environment unchanged: keep the stored password and role.
      if (existingUser.passwordHash) {
        await ensureCredentialAccount(adminId, existingUser.passwordHash, { overwrite: false });
      }
      console.log(`Admin user present: ${config.adminUsername}`);
    }
    await storeAdminEnvFingerprint(fingerprint);
    return;
  }

  // Hash the admin password for secure storage
  const passwordHash = bcrypt.hashSync(config.adminPassword, 12);

  // Create admin user with hashed password
  const now = nowIso();
  await db.insert(users).values({
    id: adminId,
    email: adminEmail,
    name: config.adminUsername,
    passwordHash,
    role: "admin",
    provider,
    subject,
    username: config.adminUsername.toLowerCase(),
    displayUsername: config.adminUsername,
    avatarUrl: null,
    status: "active",
    createdAt: now,
    updatedAt: now
  });

  console.log(`Created admin user: ${config.adminUsername}`);

  // Ensure credential account row exists for Better Auth
  await ensureCredentialAccount(adminId, passwordHash);
  await storeAdminEnvFingerprint(fingerprint);
}

/**
 * Ensures a credential account row exists in the accounts table for Better Auth.
 * Better Auth requires an accounts row with providerId="credential" and the password hash.
 */
async function ensureCredentialAccount(
  userId: number,
  passwordHash: string,
  { overwrite = true }: { overwrite?: boolean } = {}
): Promise<void> {
  const now = nowIso();
  const existing = await db.select().from(accounts).where(
    and(
      eq(accounts.userId, userId),
      eq(accounts.providerId, "credential"),
      eq(accounts.issuer, CREDENTIAL_ACCOUNT_ISSUER)
    )
  ).get();

  if (existing) {
    if (!overwrite) return;
    // Update password hash if changed
    await db.update(accounts).set({
      password: passwordHash,
      updatedAt: now,
    }).where(eq(accounts.id, existing.id));
  } else {
    await db.insert(accounts).values({
      userId,
      issuer: CREDENTIAL_ACCOUNT_ISSUER,
      accountId: userId.toString(),
      providerId: "credential",
      password: passwordHash,
      createdAt: now,
      updatedAt: now,
    });
  }
}
