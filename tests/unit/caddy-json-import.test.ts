/**
 * Unit tests for src/lib/caddy-json-import.ts
 * Tests the Caddy runtime JSON parser used by the proxy-host import feature.
 */
import { describe, it, expect } from 'vitest';
import { parseCaddyJson } from '@/lib/caddy-json-import';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('parseCaddyJson', () => {
  it('reports invalid JSON with a single root-level error', () => {
    const result = parseCaddyJson('not json');
    expect(result.drafts).toEqual([]);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].locator).toBe('(root)');
    expect(result.errors[0].message).toContain('Invalid JSON');
    expect(result.format).toBe('caddy-json');
  });

  it('reports a missing apps.http.servers shape error', () => {
    const result = parseCaddyJson('{}');
    expect(result.drafts).toEqual([]);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].locator).toBe('(root)');
    expect(result.errors[0].message).toContain('apps.http.servers');
  });

  it('reports an error when apps.http.servers is not an object', () => {
    const result = parseCaddyJson('{"apps":{"http":{"servers":[]}}}');
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].message).toContain('apps.http.servers');
  });

  it('returns an empty result for a valid but empty servers object', () => {
    const result = parseCaddyJson('{"apps":{"http":{"servers":{}}}}');
    expect(result.drafts).toEqual([]);
    expect(result.errors).toEqual([]);
    expect(result.skipped).toEqual([]);
  });

  it('parses a single simple route into one draft', () => {
    const input = JSON.stringify({
      apps: {
        http: {
          servers: {
            srv0: {
              listen: [':443'],
              routes: [
                {
                  match: [{ host: ['a.test.fr'] }],
                  handle: [
                    {
                      handler: 'subroute',
                      routes: [
                        {
                          handle: [
                            {
                              handler: 'reverse_proxy',
                              upstreams: [{ dial: '10.0.0.1:80' }],
                            },
                          ],
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          },
        },
      },
    });
    const result = parseCaddyJson(input);
    expect(result.errors).toEqual([]);
    expect(result.skipped).toEqual([]);
    expect(result.drafts).toHaveLength(1);
    expect(result.drafts[0]).toMatchObject({
      domains: ['a.test.fr'],
      upstream: '10.0.0.1:80',
      source: { format: 'caddy-json', locator: 'srv0.routes[0]' },
    });
  });

  it('parses multiple routes from the same server', () => {
    const input = JSON.stringify({
      apps: {
        http: {
          servers: {
            srv0: {
              listen: [':443'],
              routes: [
                {
                  match: [{ host: ['a.test.fr'] }],
                  handle: [
                    {
                      handler: 'subroute',
                      routes: [{ handle: [{ handler: 'reverse_proxy', upstreams: [{ dial: '1.1.1.1:80' }] }] }],
                    },
                  ],
                },
                {
                  match: [{ host: ['b.test.fr'] }],
                  handle: [
                    {
                      handler: 'subroute',
                      routes: [{ handle: [{ handler: 'reverse_proxy', upstreams: [{ dial: '2.2.2.2:80' }] }] }],
                    },
                  ],
                },
              ],
            },
          },
        },
      },
    });
    const result = parseCaddyJson(input);
    expect(result.errors).toEqual([]);
    expect(result.drafts).toHaveLength(2);
    expect(result.drafts.map((d) => d.domains[0])).toEqual(['a.test.fr', 'b.test.fr']);
    expect(result.drafts.map((d) => d.upstream)).toEqual(['1.1.1.1:80', '2.2.2.2:80']);
    expect(result.drafts.map((d) => d.source.locator)).toEqual([
      'srv0.routes[0]',
      'srv0.routes[1]',
    ]);
  });

  it('supports multi-domain routes', () => {
    const input = JSON.stringify({
      apps: { http: { servers: { srv0: {
        listen: [':443'],
        routes: [{
          match: [{ host: ['a.test.fr', 'b.test.fr'] }],
          handle: [{
            handler: 'subroute',
            routes: [{ handle: [{ handler: 'reverse_proxy', upstreams: [{ dial: '1.2.3.4:80' }] }] }],
          }],
        }],
      } } } },
    });
    const result = parseCaddyJson(input);
    expect(result.drafts).toHaveLength(1);
    expect(result.drafts[0].domains).toEqual(['a.test.fr', 'b.test.fr']);
  });

  it('flags a route with no host matcher as an error', () => {
    const input = JSON.stringify({
      apps: { http: { servers: { srv0: {
        listen: [':443'],
        routes: [{
          match: [{}],
          handle: [{
            handler: 'subroute',
            routes: [{ handle: [{ handler: 'reverse_proxy', upstreams: [{ dial: '1.2.3.4:80' }] }] }],
          }],
        }],
      } } } },
    });
    const result = parseCaddyJson(input);
    expect(result.drafts).toEqual([]);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].locator).toBe('srv0.routes[0]');
    expect(result.errors[0].message).toContain('no host matcher');
  });

  it('maps transport.tls.insecure_skip_verify to skipHttpsHostnameValidation', () => {
    const input = JSON.stringify({
      apps: { http: { servers: { srv0: {
        listen: [':443'],
        routes: [{
          match: [{ host: ['a.test.fr'] }],
          handle: [{
            handler: 'subroute',
            routes: [{ handle: [{
              handler: 'reverse_proxy',
              transport: { protocol: 'http', tls: { insecure_skip_verify: true } },
              upstreams: [{ dial: '10.0.0.1:8006' }],
            }] }],
          }],
        }],
      } } } },
    });
    const result = parseCaddyJson(input);
    expect(result.errors).toEqual([]);
    expect(result.drafts).toHaveLength(1);
    expect(result.drafts[0].skipHttpsHostnameValidation).toBe(true);
    // When transport.tls is present, Caddy speaks HTTPS to the backend even if
    // the dial has no scheme. We prefix https:// so CPM stores the correct
    // upstream protocol.
    expect(result.drafts[0].upstream).toBe('https://10.0.0.1:8006');
  });

  it('does not set skipHttpsHostnameValidation when transport has no TLS', () => {
    const input = JSON.stringify({
      apps: { http: { servers: { srv0: {
        listen: [':443'],
        routes: [{
          match: [{ host: ['a.test.fr'] }],
          handle: [{
            handler: 'subroute',
            routes: [{ handle: [{
              handler: 'reverse_proxy',
              upstreams: [{ dial: '10.0.0.1:80' }],
            }] }],
          }],
        }],
      } } } },
    });
    const result = parseCaddyJson(input);
    expect(result.drafts).toHaveLength(1);
    expect(result.drafts[0].skipHttpsHostnameValidation).toBeUndefined();
    expect(result.drafts[0].upstream).toBe('10.0.0.1:80');
  });

  it('preserves an upstream dial that already has a scheme', () => {
    const input = JSON.stringify({
      apps: { http: { servers: { srv0: {
        listen: [':443'],
        routes: [{
          match: [{ host: ['a.test.fr'] }],
          handle: [{
            handler: 'subroute',
            routes: [{ handle: [{
              handler: 'reverse_proxy',
              transport: { protocol: 'http', tls: {} },
              upstreams: [{ dial: 'https://10.0.0.1:8006' }],
            }] }],
          }],
        }],
      } } } },
    });
    const result = parseCaddyJson(input);
    expect(result.drafts[0].upstream).toBe('https://10.0.0.1:8006');
  });

  it('maps static_response 3xx with Location header into redirects', () => {
    const input = JSON.stringify({
      apps: { http: { servers: { srv0: {
        listen: [':443'],
        routes: [{
          match: [{ host: ['nextcloud.test.fr'] }],
          handle: [{
            handler: 'subroute',
            routes: [
              {
                match: [{ path: ['/.well-known/carddav'] }],
                handle: [{
                  handler: 'static_response',
                  headers: { Location: ['/remote.php/dav'] },
                  status_code: 301,
                }],
              },
              {
                handle: [{ handler: 'reverse_proxy', upstreams: [{ dial: '10.0.4.110:80' }] }],
              },
            ],
          }],
        }],
      } } } },
    });
    const result = parseCaddyJson(input);
    expect(result.errors).toEqual([]);
    expect(result.drafts).toHaveLength(1);
    expect(result.drafts[0].redirects).toEqual([
      { from: '/.well-known/carddav', to: '/remote.php/dav', status: 301 },
    ]);
  });

  it('ignores static_response without a 3xx status or without a Location header', () => {
    const input = JSON.stringify({
      apps: { http: { servers: { srv0: {
        listen: [':443'],
        routes: [{
          match: [{ host: ['a.test.fr'] }],
          handle: [{
            handler: 'subroute',
            routes: [
              {
                match: [{ path: ['/forbidden'] }],
                handle: [{ handler: 'static_response', status_code: 403 }],
              },
              { handle: [{ handler: 'reverse_proxy', upstreams: [{ dial: '1.2.3.4:80' }] }] },
            ],
          }],
        }],
      } } } },
    });
    const result = parseCaddyJson(input);
    expect(result.drafts).toHaveLength(1);
    expect(result.drafts[0].redirects).toBeUndefined();
  });

  it('maps path-matched reverse_proxy inner routes to location rules', () => {
    const input = JSON.stringify({
      apps: { http: { servers: { srv0: {
        listen: [':443'],
        routes: [{
          match: [{ host: ['vaultwarden.test.fr'] }],
          handle: [{
            handler: 'subroute',
            routes: [
              {
                match: [{ path: ['/notifications/hub'] }],
                handle: [{ handler: 'reverse_proxy', upstreams: [{ dial: '10.0.4.177:3012' }] }],
              },
              {
                handle: [{ handler: 'reverse_proxy', upstreams: [{ dial: '10.0.4.177:80' }] }],
              },
            ],
          }],
        }],
      } } } },
    });
    const result = parseCaddyJson(input);
    expect(result.errors).toEqual([]);
    expect(result.drafts).toHaveLength(1);
    expect(result.drafts[0].upstream).toBe('10.0.4.177:80');
    expect(result.drafts[0].locationRules).toEqual([
      { path: '/notifications/hub', upstreams: ['10.0.4.177:3012'] },
    ]);
  });

  it('chooses the unpath-matched reverse_proxy as the primary upstream', () => {
    const input = JSON.stringify({
      apps: { http: { servers: { srv0: {
        listen: [':443'],
        routes: [{
          match: [{ host: ['a.test.fr'] }],
          handle: [{
            handler: 'subroute',
            routes: [
              { handle: [{ handler: 'reverse_proxy', upstreams: [{ dial: '1.1.1.1:80' }] }] },
              {
                match: [{ path: ['/api'] }],
                handle: [{ handler: 'reverse_proxy', upstreams: [{ dial: '2.2.2.2:80' }] }],
              },
            ],
          }],
        }],
      } } } },
    });
    const result = parseCaddyJson(input);
    expect(result.drafts[0].upstream).toBe('1.1.1.1:80');
    expect(result.drafts[0].locationRules).toEqual([
      { path: '/api', upstreams: ['2.2.2.2:80'] },
    ]);
  });

  it('attaches a warning when a route uses the headers handler', () => {
    const input = JSON.stringify({
      apps: { http: { servers: { srv0: {
        listen: [':443'],
        routes: [{
          match: [{ host: ['a.test.fr'] }],
          handle: [{
            handler: 'subroute',
            routes: [
              { handle: [{
                handler: 'headers',
                response: { set: { 'Strict-Transport-Security': ['max-age=31536000'] } },
              }] },
              { handle: [{ handler: 'reverse_proxy', upstreams: [{ dial: '1.2.3.4:80' }] }] },
            ],
          }],
        }],
      } } } },
    });
    const result = parseCaddyJson(input);
    expect(result.drafts).toHaveLength(1);
    expect(result.drafts[0].warnings).toEqual([
      'Custom headers ignored; configure HSTS or preserveHostHeader in CPM.',
    ]);
  });

  it('attaches a warning when a route uses the authentication handler', () => {
    const input = JSON.stringify({
      apps: { http: { servers: { srv0: {
        listen: [':443'],
        routes: [{
          match: [{ host: ['vaultwarden.test.fr'], path: ['/admin'] }],
          handle: [{
            handler: 'subroute',
            routes: [{ handle: [
              { handler: 'authentication', providers: {} },
              { handler: 'reverse_proxy', upstreams: [{ dial: '10.0.4.177:80' }] },
            ] }],
          }],
        }],
      } } } },
    });
    const result = parseCaddyJson(input);
    expect(result.drafts).toHaveLength(1);
    expect(result.drafts[0].warnings).toEqual([
      'Authentication handler ignored; configure CPM Forward Auth or Authentik manually.',
    ]);
  });

  it('skips a route that has only an authenticator handler (auth portal definitions)', () => {
    const input = JSON.stringify({
      apps: { http: { servers: { srv0: {
        listen: [':443'],
        routes: [{
          match: [{ host: ['authportal.test.fr'] }],
          handle: [{
            handler: 'subroute',
            routes: [{ handle: [{
              handler: 'authenticator',
              portal_name: 'auth-portal',
              route_matcher: '*',
            }] }],
          }],
        }],
      } } } },
    });
    const result = parseCaddyJson(input);
    expect(result.drafts).toEqual([]);
    expect(result.errors).toEqual([]);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0].reason).toBe('no reverse_proxy handler');
    expect(result.skipped[0].draft.domains).toEqual(['authportal.test.fr']);
    expect(result.skipped[0].draft.source.locator).toBe('srv0.routes[0]');
  });

  it('does not warn about encode (silently ignored)', () => {
    const input = JSON.stringify({
      apps: { http: { servers: { srv0: {
        listen: [':443'],
        routes: [{
          match: [{ host: ['a.test.fr'] }],
          handle: [{
            handler: 'subroute',
            routes: [
              { handle: [{ handler: 'encode', encodings: { gzip: {} } }] },
              { handle: [{ handler: 'reverse_proxy', upstreams: [{ dial: '1.2.3.4:80' }] }] },
            ],
          }],
        }],
      } } } },
    });
    const result = parseCaddyJson(input);
    expect(result.drafts).toHaveLength(1);
    expect(result.drafts[0].warnings).toBeUndefined();
  });

  it('dedups same domain across ports, :443 winning over other ports', () => {
    const input = JSON.stringify({
      apps: { http: { servers: {
        srv0: {
          listen: [':1882'],
          routes: [{
            match: [{ host: ['worksite.test.fr'] }],
            handle: [{
              handler: 'subroute',
              routes: [{ handle: [{ handler: 'reverse_proxy', upstreams: [{ dial: '10.0.2.27:1882' }] }] }],
            }],
          }],
        },
        srv1: {
          listen: [':443'],
          routes: [{
            match: [{ host: ['worksite.test.fr'] }],
            handle: [{
              handler: 'subroute',
              routes: [{ handle: [{ handler: 'reverse_proxy', upstreams: [{ dial: '10.0.2.27:8080' }] }] }],
            }],
          }],
        },
      } } },
    });
    const result = parseCaddyJson(input);
    expect(result.drafts).toHaveLength(1);
    expect(result.drafts[0].upstream).toBe('10.0.2.27:8080');
    expect(result.drafts[0].source.locator).toBe('srv1.routes[0]');
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0].reason).toBe('superseded by :443 server');
    expect(result.skipped[0].draft.upstream).toBe('10.0.2.27:1882');
  });

  it('keeps a draft that lives only on a non-443 port', () => {
    const input = JSON.stringify({
      apps: { http: { servers: { srv0: {
        listen: [':60881'],
        routes: [{
          match: [{ host: ['api-old.test.fr'] }],
          handle: [{
            handler: 'subroute',
            routes: [{ handle: [{ handler: 'reverse_proxy', upstreams: [{ dial: '10.0.2.69:1882' }] }] }],
          }],
        }],
      } } } },
    });
    const result = parseCaddyJson(input);
    expect(result.drafts).toHaveLength(1);
    expect(result.drafts[0].upstream).toBe('10.0.2.69:1882');
    expect(result.skipped).toEqual([]);
  });

  it('non-:443 second occurrence loses to non-:443 first occurrence', () => {
    const input = JSON.stringify({
      apps: { http: { servers: {
        srv0: {
          listen: [':1882'],
          routes: [{
            match: [{ host: ['a.test.fr'] }],
            handle: [{
              handler: 'subroute',
              routes: [{ handle: [{ handler: 'reverse_proxy', upstreams: [{ dial: '1.1.1.1:80' }] }] }],
            }],
          }],
        },
        srv1: {
          listen: [':1883'],
          routes: [{
            match: [{ host: ['a.test.fr'] }],
            handle: [{
              handler: 'subroute',
              routes: [{ handle: [{ handler: 'reverse_proxy', upstreams: [{ dial: '2.2.2.2:80' }] }] }],
            }],
          }],
        },
      } } },
    });
    const result = parseCaddyJson(input);
    expect(result.drafts).toHaveLength(1);
    expect(result.drafts[0].upstream).toBe('1.1.1.1:80');
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0].draft.upstream).toBe('2.2.2.2:80');
    expect(result.skipped[0].reason).toBe('superseded by :1882 server');
  });

  it('parses the representative fixture into the expected drafts and skipped entries', () => {
    const fixturePath = resolve(__dirname, '..', 'fixtures', 'caddy-json-sample.json');
    const raw = readFileSync(fixturePath, 'utf-8');
    const result = parseCaddyJson(raw);

    expect(result.errors).toEqual([]);

    // 5 drafts: worksite.test.fr (:443 wins), api-old (only :60881), proxmox, nextcloud, vaultwarden
    expect(result.drafts.map((d) => d.domains[0])).toEqual([
      'worksite.test.fr',
      'api-old.test.fr',
      'proxmox.test.fr',
      'nextcloud.test.fr',
      'vaultwarden.test.fr',
    ]);

    const byDomain = Object.fromEntries(result.drafts.map((d) => [d.domains[0], d]));

    expect(byDomain['worksite.test.fr'].upstream).toBe('10.0.0.1:8080');
    expect(byDomain['worksite.test.fr'].source.locator).toBe('srv_https.routes[0]');

    expect(byDomain['proxmox.test.fr'].upstream).toBe('https://10.0.0.3:8006');
    expect(byDomain['proxmox.test.fr'].skipHttpsHostnameValidation).toBe(true);

    expect(byDomain['nextcloud.test.fr'].upstream).toBe('10.0.0.4:80');
    expect(byDomain['nextcloud.test.fr'].redirects).toEqual([
      { from: '/.well-known/carddav', to: '/remote.php/dav', status: 301 },
    ]);

    expect(byDomain['vaultwarden.test.fr'].upstream).toBe('10.0.0.5:80');
    expect(byDomain['vaultwarden.test.fr'].locationRules).toEqual([
      { path: '/notifications/hub', upstreams: ['10.0.0.5:3012'] },
    ]);
    expect(byDomain['vaultwarden.test.fr'].warnings).toEqual([
      'Custom headers ignored; configure HSTS or preserveHostHeader in CPM.',
    ]);

    // Skipped: worksite.test.fr (:1882) superseded by :443; authportal.test.fr (no reverse_proxy).
    expect(result.skipped).toHaveLength(2);
    const skippedByDomain = Object.fromEntries(
      result.skipped.map((s) => [s.draft.domains[0], s])
    );
    expect(skippedByDomain['worksite.test.fr'].reason).toBe('superseded by :443 server');
    expect(skippedByDomain['authportal.test.fr'].reason).toBe('no reverse_proxy handler');
  });
});
