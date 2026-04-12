-- Recreate users table for Better Auth compatibility:
-- 1. provider/subject: nullable with defaults (Better Auth doesn't set these)
-- 2. emailVerified: INTEGER (matches Better Auth boolean→int conversion)
CREATE TABLE users_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL,
  name TEXT,
  passwordHash TEXT,
  role TEXT NOT NULL DEFAULT 'user',
  provider TEXT DEFAULT '',
  subject TEXT DEFAULT '',
  avatarUrl TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  username TEXT,
  displayUsername TEXT,
  emailVerified INTEGER NOT NULL DEFAULT 0,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL
);
--> statement-breakpoint
INSERT INTO users_new SELECT id, email, name, passwordHash, role, provider, subject, avatarUrl, status, username, displayUsername, emailVerified, createdAt, updatedAt FROM users;
--> statement-breakpoint
DROP TABLE users;
--> statement-breakpoint
ALTER TABLE users_new RENAME TO users;
--> statement-breakpoint
CREATE UNIQUE INDEX users_email_unique ON users (email);
