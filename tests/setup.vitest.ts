import { vi } from 'vitest';

// Mock the Caddy config apply so no real HTTP calls go out during tests
vi.mock('@/src/lib/caddy', () => ({
  applyCaddyConfig: vi.fn().mockResolvedValue({ ok: true }),
}));

// Mock NextAuth so API route tests can control session state
vi.mock('@/src/lib/auth', () => ({
  auth: vi.fn().mockResolvedValue({
    user: { id: 1, email: 'test@example.com', name: 'Test User', role: 'admin' },
  }),
}));

// Mock audit logging to be a no-op
vi.mock('@/src/lib/audit', () => ({
  logAuditEvent: vi.fn(),
}));
