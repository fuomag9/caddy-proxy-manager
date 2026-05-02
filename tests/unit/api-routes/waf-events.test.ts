import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/src/lib/models/waf-events', () => ({
  listWafEvents: vi.fn(),
  countWafEvents: vi.fn(),
}));

vi.mock('@/src/lib/api-auth', () => {
  const ApiAuthError = class extends Error {
    status: number;
    constructor(msg: string, status: number) { super(msg); this.status = status; this.name = 'ApiAuthError'; }
  };
  return {
    requireApiAdmin: vi.fn().mockResolvedValue({ userId: 1, role: 'admin', authMethod: 'bearer' }),
    apiErrorResponse: vi.fn((error: unknown) => {
      const { NextResponse: NR } = require('next/server');
      if (error instanceof ApiAuthError) {
        return NR.json({ error: error.message }, { status: error.status });
      }
      return NR.json({ error: error instanceof Error ? error.message : 'Internal server error' }, { status: 500 });
    }),
    ApiAuthError,
  };
});

import { GET } from '@/app/api/waf-events/route';
import { countWafEvents, listWafEvents } from '@/src/lib/models/waf-events';

const mockListWafEvents = vi.mocked(listWafEvents);
const mockCountWafEvents = vi.mocked(countWafEvents);

function createMockRequest(searchParams = ''): any {
  return {
    headers: { get: () => null },
    method: 'GET',
    nextUrl: { pathname: '/api/waf-events', searchParams: new URLSearchParams(searchParams) },
    json: async () => ({}),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockListWafEvents.mockResolvedValue([] as any);
  mockCountWafEvents.mockResolvedValue(0);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('GET /api/waf-events', () => {
  it('returns default pagination without a time filter', async () => {
    const response = await GET(createMockRequest());
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.page).toBe(1);
    expect(data.perPage).toBe(50);
    expect(mockListWafEvents).toHaveBeenCalledWith(50, 0, undefined, undefined, undefined);
    expect(mockCountWafEvents).toHaveBeenCalledWith(undefined, undefined, undefined);
  });

  it('applies preset period filters', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000);

    await GET(createMockRequest('range=24h&search=fuo.fi'));

    const expectedTo = 1_700_000_000;
    const expectedFrom = expectedTo - 86400;
    expect(mockListWafEvents).toHaveBeenCalledWith(50, 0, 'fuo.fi', expectedFrom, expectedTo);
    expect(mockCountWafEvents).toHaveBeenCalledWith('fuo.fi', expectedFrom, expectedTo);
  });

  it('applies custom period filters when valid', async () => {
    await GET(createMockRequest('range=custom&from=1700000000&to=1700003600&page=2&per_page=25'));

    expect(mockListWafEvents).toHaveBeenCalledWith(25, 25, undefined, 1700000000, 1700003600);
    expect(mockCountWafEvents).toHaveBeenCalledWith(undefined, 1700000000, 1700003600);
  });

  it('ignores invalid custom period filters', async () => {
    await GET(createMockRequest('range=custom&from=1700003600&to=1700000000'));

    expect(mockListWafEvents).toHaveBeenCalledWith(50, 0, undefined, undefined, undefined);
    expect(mockCountWafEvents).toHaveBeenCalledWith(undefined, undefined, undefined);
  });
});
