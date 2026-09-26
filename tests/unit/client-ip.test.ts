import { afterEach, describe, expect, it, vi } from 'vitest';
import { getClientIp, ipRateLimitBucket, UNKNOWN_CLIENT_IP } from '@/src/lib/client-ip';

function headers(init: Record<string, string>) {
  return new Headers(init);
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('getClientIp without TRUSTED_CLIENT_IP_HEADER', () => {
  it('uses the rightmost X-Forwarded-For entry', () => {
    expect(getClientIp(headers({ 'x-forwarded-for': '203.0.113.9, 198.51.100.7' }))).toBe('198.51.100.7');
    expect(getClientIp(headers({ 'x-forwarded-for': ' 198.51.100.7 ' }))).toBe('198.51.100.7');
  });

  it('ignores X-Real-IP', () => {
    expect(getClientIp(headers({ 'x-real-ip': '198.51.100.7' }))).toBe(UNKNOWN_CLIENT_IP);
    expect(getClientIp(headers({ 'x-real-ip': '198.51.100.7', 'x-forwarded-for': '192.0.2.1' }))).toBe('192.0.2.1');
  });

  it('returns unknown for a missing, malformed or oversized entry', () => {
    expect(getClientIp(headers({}))).toBe(UNKNOWN_CLIENT_IP);
    expect(getClientIp(headers({ 'x-forwarded-for': '192.0.2.1, ' }))).toBe(UNKNOWN_CLIENT_IP);
    expect(getClientIp(headers({ 'x-forwarded-for': 'not-an-ip' }))).toBe(UNKNOWN_CLIENT_IP);
    expect(getClientIp(headers({ 'x-forwarded-for': `192.0.2.1${'0'.repeat(4000)}` }))).toBe(UNKNOWN_CLIENT_IP);
    expect(getClientIp(headers({ 'x-forwarded-for': '999.1.1.1' }))).toBe(UNKNOWN_CLIENT_IP);
  });

  it('normalizes ports, brackets, case and IPv4-mapped IPv6', () => {
    expect(getClientIp(headers({ 'x-forwarded-for': '192.0.2.1:51234' }))).toBe('192.0.2.1');
    expect(getClientIp(headers({ 'x-forwarded-for': '[2001:DB8::1]:443' }))).toBe('2001:db8::1');
    expect(getClientIp(headers({ 'x-forwarded-for': '2001:DB8::1' }))).toBe('2001:db8::1');
    expect(getClientIp(headers({ 'x-forwarded-for': '::ffff:192.0.2.1' }))).toBe('192.0.2.1');
  });

  it('unwraps IPv4-mapped IPv6 in every notation', () => {
    expect(getClientIp(headers({ 'x-forwarded-for': '::FFFF:c000:201' }))).toBe('192.0.2.1');
    expect(getClientIp(headers({ 'x-forwarded-for': '0:0:0:0:0:ffff:192.0.2.1' }))).toBe('192.0.2.1');
    expect(getClientIp(headers({ 'x-forwarded-for': '[::ffff:192.0.2.1]:8080' }))).toBe('192.0.2.1');
    // Not mapped: the IPv4-compatible and NAT64 forms stay IPv6.
    expect(getClientIp(headers({ 'x-forwarded-for': '::192.0.2.1' }))).toBe('::192.0.2.1');
    expect(getClientIp(headers({ 'x-forwarded-for': '64:ff9b::192.0.2.1' }))).toBe('64:ff9b::192.0.2.1');
  });
});

describe('getClientIp with TRUSTED_CLIENT_IP_HEADER', () => {
  it('prefers the configured header over X-Forwarded-For', () => {
    vi.stubEnv('TRUSTED_CLIENT_IP_HEADER', 'CF-Connecting-IP');
    const h = headers({ 'cf-connecting-ip': '198.51.100.7', 'x-forwarded-for': '192.0.2.1' });
    expect(getClientIp(h)).toBe('198.51.100.7');
  });

  it('falls back to the rightmost X-Forwarded-For entry when the header is missing or malformed', () => {
    vi.stubEnv('TRUSTED_CLIENT_IP_HEADER', 'x-real-ip');
    expect(getClientIp(headers({ 'x-forwarded-for': '203.0.113.9, 192.0.2.1' }))).toBe('192.0.2.1');
    expect(getClientIp(headers({ 'x-real-ip': 'garbage', 'x-forwarded-for': '192.0.2.1' }))).toBe('192.0.2.1');
    expect(getClientIp(headers({ 'x-real-ip': 'garbage' }))).toBe(UNKNOWN_CLIENT_IP);
  });

  it('takes the last value when the header was repeated', () => {
    vi.stubEnv('TRUSTED_CLIENT_IP_HEADER', 'x-real-ip');
    expect(getClientIp(headers({ 'x-real-ip': '203.0.113.9, 198.51.100.7' }))).toBe('198.51.100.7');
  });

  it('ignores an invalid header name instead of throwing', () => {
    vi.stubEnv('TRUSTED_CLIENT_IP_HEADER', 'x real ip');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(getClientIp(headers({ 'x-forwarded-for': '192.0.2.1' }))).toBe('192.0.2.1');
    expect(warn).toHaveBeenCalledTimes(1);
  });
});

describe('ipRateLimitBucket', () => {
  it('keeps IPv4 addresses and the unknown marker whole', () => {
    expect(ipRateLimitBucket('192.0.2.1')).toBe('192.0.2.1');
    expect(ipRateLimitBucket(UNKNOWN_CLIENT_IP)).toBe(UNKNOWN_CLIENT_IP);
  });

  it('reduces IPv6 addresses to their /64 prefix', () => {
    expect(ipRateLimitBucket('2001:db8:1:2::1')).toBe('2001:db8:1:2::/64');
    expect(ipRateLimitBucket('2001:0db8:0001:0002:aaaa:bbbb:cccc:dddd')).toBe('2001:db8:1:2::/64');
    expect(ipRateLimitBucket('2001:db8::1')).toBe('2001:db8:0:0::/64');
    expect(ipRateLimitBucket('2001:db8:1:3::1')).toBe('2001:db8:1:3::/64');
    expect(ipRateLimitBucket('::1')).toBe('0:0:0:0::/64');
    expect(ipRateLimitBucket('1:2:3:4:5:6:7::')).toBe('1:2:3:4::/64');
    expect(ipRateLimitBucket('fe80::1%eth0')).toBe('fe80:0:0:0::/64');
    expect(ipRateLimitBucket('2001:db8:1:2:3:4:192.0.2.1')).toBe('2001:db8:1:2::/64');
  });
});
