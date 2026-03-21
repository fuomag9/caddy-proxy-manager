import { describe, expect, it } from 'vitest';

import { validateL4ListenAddressFormat } from '@/src/lib/models/l4-routes';

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