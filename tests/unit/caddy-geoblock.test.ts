import { describe, it, expect, vi } from 'vitest';

vi.unmock('@/src/lib/caddy');

import { buildBlockerHandler, resolveEffectiveGeoBlock } from '@/src/lib/caddy';
import type { GeoBlockSettings } from '@/src/lib/settings';

const globalGeoBlock: GeoBlockSettings = {
  enabled: true,
  block_countries: ['CN'],
  block_continents: [],
  block_asns: [],
  block_cidrs: [],
  block_ips: [],
  allow_countries: [],
  allow_continents: [],
  allow_asns: [],
  allow_cidrs: [],
  allow_ips: [],
  trusted_proxies: [],
  fail_closed: false,
  response_status: 403,
  response_body: 'Forbidden anyway!',
  response_headers: {},
  redirect_url: '',
};

describe('resolveEffectiveGeoBlock', () => {
  it('keeps global response settings when host geoblock is disabled in merge mode', () => {
    const result = resolveEffectiveGeoBlock(globalGeoBlock, {
      geoblock_mode: 'merge',
      geoblock: {
        enabled: false,
        block_countries: [],
        block_continents: [],
        block_asns: [],
        block_cidrs: [],
        block_ips: [],
        allow_countries: [],
        allow_continents: [],
        allow_asns: [],
        allow_cidrs: [],
        allow_ips: [],
        trusted_proxies: [],
        fail_closed: false,
        response_status: 403,
        response_body: 'Forbidden',
        response_headers: {},
        redirect_url: '',
      },
    });

    expect(result).toEqual(globalGeoBlock);
    expect(buildBlockerHandler(result!).response_body).toBe('Forbidden anyway!');
  });

  it('still lets enabled host config override global response settings in merge mode', () => {
    const result = resolveEffectiveGeoBlock(globalGeoBlock, {
      geoblock_mode: 'merge',
      geoblock: {
        ...globalGeoBlock,
        enabled: true,
        response_body: 'Blocked by host',
      },
    });

    expect(result?.response_body).toBe('Blocked by host');
    expect(buildBlockerHandler(result!).response_body).toBe('Blocked by host');
  });
});
