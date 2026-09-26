import bcrypt from "bcryptjs";
import db, { nowIso } from "./db";
import { config, DEFAULT_ADMIN_PASSWORD, DISALLOWED_ADMIN_PASSWORDS } from "./config";
import { users, accounts, settings } from "./db/schema";
import { and, eq } from "drizzle-orm";
import { CREDENTIAL_ACCOUNT_ISSUER } from "./account-issuer";
import { changeUserPassword } from "./models/user";

const BCRYPT_COST = 12;

/**
 * Settings key recording the ADMIN_USERNAME and a bcrypt hash of the
 * ADMIN_PASSWORD last seen in the environment. The environment credentials are
 * re-applied only when they change, so a password changed in the UI is not
 * silently reverted to the environment value on every restart. The key name
 * predates the current format; any other value stored there counts as no marker.
 */
const ADMIN_ENV_MARKER_KEY = "admin_env_credentials_fingerprint";

type AdminEnvMarker = { v: 2; username: string; passwordHash: string };

/** The stored marker, or null when the row is missing or holds anything else. */
async function getAdminEnvMarker(): Promise<AdminEnvMarker | null> {
  const row = await db.select().from(settings).where(eq(settings.key, ADMIN_ENV_MARKER_KEY)).get();
  if (!row) return null;
  try {
    const value = JSON.parse(row.value) as Partial<AdminEnvMarker> | null;
    if (
      value && typeof value === "object" && value.v === 2 &&
      typeof value.username === "string" && typeof value.passwordHash === "string"
    ) {
      return { v: 2, username: value.username, passwordHash: value.passwordHash };
    }
  } catch {
    // Not a marker.
  }
  return null;
}

async function storeAdminEnvMarker(passwordHash: string): Promise<void> {
  const now = nowIso();
  const marker: AdminEnvMarker = { v: 2, username: config.adminUsername, passwordHash };
  const value = JSON.stringify(marker);
  await db
    .insert(settings)
    .values({ key: ADMIN_ENV_MARKER_KEY, value, updatedAt: now })
    .onConflictDoUpdate({ target: settings.key, set: { value, updatedAt: now } });
}

async function passwordMatches(password: string, hash: string): Promise<boolean> {
  try {
    return await bcrypt.compare(password, hash);
  } catch {
    return false;
  }
}

/** Whether the hash is of 'admin' or of an example password from the docs. */
async function isKnownPublicPassword(hash: string): Promise<boolean> {
  for (const candidate of [DEFAULT_ADMIN_PASSWORD, ...DISALLOWED_ADMIN_PASSWORDS]) {
    if (await passwordMatches(candidate, hash)) return true;
  }
  return false;
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

  // Check if admin user already exists
  const existingUser = await db.query.users.findFirst({
    where: (table, { eq }) => eq(table.id, adminId)
  });

  if (existingUser) {
    const storedHash = existingUser.passwordHash;
    let envMatchesStored: boolean | undefined;
    const envPasswordIsStored = async () =>
      (envMatchesStored ??= !!storedHash && await passwordMatches(config.adminPassword, storedHash));

    const marker = await getAdminEnvMarker();
    let applyEnvCredentials: boolean;
    if (marker) {
      applyEnvCredentials = marker.username !== config.adminUsername ||
        !(await passwordMatches(config.adminPassword, marker.passwordHash));
    } else if (!storedHash || await envPasswordIsStored() || await isKnownPublicPassword(storedHash)) {
      // No marker: the first start after the upgrade that introduced it
      // (until then every start re-applied the environment). Apply the
      // environment when the stored password is the environment one or a
      // publicly known one; any other password was changed in the UI.
      applyEnvCredentials = true;
    } else {
      applyEnvCredentials = false;
      console.warn(
        "ADMIN_PASSWORD differs from the stored admin password; keeping the stored password because it was " +
        "probably changed in the UI. Change ADMIN_PASSWORD again and recreate the web container (docker compose up -d) " +
        "to force it."
      );
    }

    const identity = {
      email: adminEmail,
      subject,
      username: config.adminUsername.toLowerCase(),
      displayUsername: config.adminUsername,
    };
    if (applyEnvCredentials) {
      const passwordChanged = !(await envPasswordIsStored());
      const passwordHash = storedHash && !passwordChanged
        ? storedHash
        : await bcrypt.hash(config.adminPassword, BCRYPT_COST);
      if (passwordChanged) {
        // Sets the password and ends every sign-in made with the previous one
        // in one transaction, so a failure leaves the old password in place
        // and the next start tries again.
        await changeUserPassword(adminId, passwordHash, null);
      }
      // Changed environment credentials are the documented recovery path, so
      // they also make the primary admin active again. Re-applying unchanged
      // ones (the first start without a marker) leaves the status alone.
      const envChanged = marker !== null || passwordChanged || existingUser.username !== identity.username;
      await db
        .update(users)
        .set({
          ...identity,
          role: "admin",
          ...(envChanged ? { status: "active" } : {}),
          updatedAt: nowIso()
        })
        .where(eq(users.id, adminId));
      // Ensure credential account row exists for Better Auth
      await ensureCredentialAccount(adminId, passwordHash);
      await storeAdminEnvMarker(passwordHash);
      console.log(`Applied admin credentials from environment: ${config.adminUsername}`);
    } else {
      // Keep the stored password and role.
      if (!marker && existingUser.username !== identity.username) {
        // Without a marker, ADMIN_USERNAME was applied on every start, so a
        // changed one is applied even though the password is kept.
        await db
          .update(users)
          .set({ ...identity, updatedAt: nowIso() })
          .where(eq(users.id, adminId));
        console.log(`Applied admin username from environment: ${config.adminUsername}`);
      }
      if (storedHash) {
        await ensureCredentialAccount(adminId, storedHash, { overwrite: false });
      }
      if (!marker) {
        // Record the current environment so that changing it again applies it.
        await storeAdminEnvMarker(await bcrypt.hash(config.adminPassword, BCRYPT_COST));
      }
      console.log(`Admin user present: ${config.adminUsername}`);
    }
    return;
  }

  // Hash the admin password for secure storage
  const passwordHash = await bcrypt.hash(config.adminPassword, BCRYPT_COST);

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
  await storeAdminEnvMarker(passwordHash);
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
