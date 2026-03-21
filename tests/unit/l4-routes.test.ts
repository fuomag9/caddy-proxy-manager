import { describe, expect, it } from 'vitest';

import { validateL4ListenAddressFormat, validateL4UpstreamDialAddressFormat } from '@/src/lib/models/l4-routes';

describe('validateL4ListenAddressFormat', () => {
  it('accepts hostless listen addresses', () => {
    expect(validateL4ListenAddressFormat(':33333')).toBeNull();
    expect(validateL4ListenAddressFormat('tcp/:33333')).toBeNull();
    expect(validateL4ListenAddressFormat('udp/:44444')).toBeNull();
  });

  it('accepts host-qualified listen addresses', () => {
    expect(validateL4ListenAddressFormat('127.0.0.1:33333')).toBeNull();
    expect(validateL4ListenAddressFormat('udp/0.0.0.0:44444')).toBeNull();
    expect(validateL4ListenAddressFormat('tcp/[::1]:44444')).toBeNull();
  });

  it('rejects protocol-prefixed addresses without a colon before the port', () => {
    expect(validateL4ListenAddressFormat('tcp/33333')).toContain('Invalid listen address');
    expect(validateL4ListenAddressFormat('udp/44444')).toContain('Invalid listen address');
  });

  it('rejects ports outside the valid range', () => {
    expect(validateL4ListenAddressFormat(':0')).toContain('Invalid listen address');
    expect(validateL4ListenAddressFormat('tcp/:65536')).toContain('Invalid listen address');
  });

  it('rejects malformed endpoints', () => {
    expect(validateL4ListenAddressFormat('tcp//:33333')).toContain('Invalid listen address');
    expect(validateL4ListenAddressFormat('hostname')).toContain('Invalid listen address');
    expect(validateL4ListenAddressFormat('')).toBe('Listen address cannot be empty');
  });
});

describe('validateL4UpstreamDialAddressFormat', () => {
  it('accepts plain host:port upstream dial addresses', () => {
    expect(validateL4UpstreamDialAddressFormat('host.docker.internal:11111')).toBeNull();
    expect(validateL4UpstreamDialAddressFormat('127.0.0.1:5432')).toBeNull();
    expect(validateL4UpstreamDialAddressFormat('[::1]:443')).toBeNull();
  });

  it('accepts protocol-prefixed upstream dial addresses', () => {
    expect(validateL4UpstreamDialAddressFormat('tcp/host.docker.internal:11111')).toBeNull();
    expect(validateL4UpstreamDialAddressFormat('udp/backend:22222')).toBeNull();
    expect(validateL4UpstreamDialAddressFormat('tcp/127.0.0.1:25')).toBeNull();
    expect(validateL4UpstreamDialAddressFormat('udp/[::1]:53')).toBeNull();
  });

  it('rejects unknown protocol prefixes', () => {
    expect(validateL4UpstreamDialAddressFormat('http/backend:80')).toContain('Invalid upstream dial address');
    expect(validateL4UpstreamDialAddressFormat('ftp/backend:21')).toContain('Invalid upstream dial address');
  });

  it('rejects malformed upstream dial addresses', () => {
    expect(validateL4UpstreamDialAddressFormat('host.docker.internal')).toContain('Invalid upstream dial address');
    expect(validateL4UpstreamDialAddressFormat(':11111')).toContain('Invalid upstream dial address');
    expect(validateL4UpstreamDialAddressFormat('tcp/:11111')).toContain('Invalid upstream dial address');
    expect(validateL4UpstreamDialAddressFormat('')).toBe('Upstream dial address cannot be empty');
  });
});