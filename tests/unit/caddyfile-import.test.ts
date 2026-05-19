/**
 * Unit tests for src/lib/caddyfile-import.ts
 * Tests the pure Caddyfile parser used by the proxy-host import feature.
 */
import { describe, it, expect } from 'vitest';
import { parseCaddyfile } from '@/src/lib/caddyfile-import';

describe('parseCaddyfile', () => {
  it('returns no drafts and no errors for empty input', () => {
    const result = parseCaddyfile('');
    expect(result.drafts).toEqual([]);
    expect(result.errors).toEqual([]);
  });

  it('returns no drafts and no errors for whitespace-only input', () => {
    const result = parseCaddyfile('   \n\n\t\n');
    expect(result.drafts).toEqual([]);
    expect(result.errors).toEqual([]);
  });

  it('parses a single site block with one reverse_proxy', () => {
    const input = `demo-test.test.fr {
        reverse_proxy 10.0.0.27:8080
}`;
    const result = parseCaddyfile(input);
    expect(result.errors).toEqual([]);
    expect(result.drafts).toHaveLength(1);
    expect(result.drafts[0]).toEqual({
      domains: ['demo-test.test.fr'],
      upstream: '10.0.0.27:8080',
      lineStart: 1,
      lineEnd: 3,
    });
  });

  it('parses the three-block example from the spec', () => {
    const input = `demo-test.test.fr {
        reverse_proxy 10.0.0.27:8080
}

demo-prod.test.fr {
        reverse_proxy 10.0.0.27:1882
}

demo-dev.test.fr {
        reverse_proxy 10.0.0.29:3000
}
`;
    const result = parseCaddyfile(input);
    expect(result.errors).toEqual([]);
    expect(result.drafts).toHaveLength(3);
    expect(result.drafts.map((d) => d.domains[0])).toEqual([
      'demo-test.test.fr',
      'demo-prod.test.fr',
      'demo-dev.test.fr',
    ]);
    expect(result.drafts.map((d) => d.upstream)).toEqual([
      '10.0.0.27:8080',
      '10.0.0.27:1882',
      '10.0.0.29:3000',
    ]);
  });

  it('supports multi-domain site blocks (comma-separated)', () => {
    const input = `a.test.fr, b.test.fr {
  reverse_proxy 10.0.0.1:80
}`;
    const result = parseCaddyfile(input);
    expect(result.errors).toEqual([]);
    expect(result.drafts).toHaveLength(1);
    expect(result.drafts[0].domains).toEqual(['a.test.fr', 'b.test.fr']);
  });

  it('ignores # comments inside and outside blocks', () => {
    const input = `# top-level comment
a.test.fr {
  # inline comment
  reverse_proxy 1.2.3.4:80
}
# trailing comment
`;
    const result = parseCaddyfile(input);
    expect(result.errors).toEqual([]);
    expect(result.drafts).toHaveLength(1);
    expect(result.drafts[0].upstream).toBe('1.2.3.4:80');
  });

  it('accepts opening brace on the next line', () => {
    const input = `a.test.fr
{
  reverse_proxy 1.2.3.4:80
}`;
    const result = parseCaddyfile(input);
    expect(result.errors).toEqual([]);
    expect(result.drafts).toHaveLength(1);
  });

  it('passes port-only upstreams through verbatim', () => {
    const input = `a.test.fr {
  reverse_proxy :1882
}`;
    const result = parseCaddyfile(input);
    expect(result.errors).toEqual([]);
    expect(result.drafts[0].upstream).toBe(':1882');
  });

  it('flags unsupported directives and rejects the block', () => {
    const input = `a.test.fr {
  tls admin@example.com
  reverse_proxy 1.2.3.4:80
}`;
    const result = parseCaddyfile(input);
    expect(result.drafts).toEqual([]);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].message).toContain('Unsupported directive');
    expect(result.errors[0].message).toContain('tls');
  });

  it('flags a block with no reverse_proxy directive', () => {
    const input = `a.test.fr {
}`;
    const result = parseCaddyfile(input);
    expect(result.drafts).toEqual([]);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].message).toContain('no "reverse_proxy"');
  });

  it('flags a block with multiple reverse_proxy directives', () => {
    const input = `a.test.fr {
  reverse_proxy 1.2.3.4:80
  reverse_proxy 5.6.7.8:80
}`;
    const result = parseCaddyfile(input);
    expect(result.drafts).toEqual([]);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].message).toContain('only one is supported');
  });

  it('flags an unclosed block', () => {
    const input = `a.test.fr {
  reverse_proxy 1.2.3.4:80
`;
    const result = parseCaddyfile(input);
    expect(result.drafts).toEqual([]);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].message).toContain('missing closing');
  });

  it('flags an empty domain list', () => {
    const input = ` {
  reverse_proxy 1.2.3.4:80
}`;
    const result = parseCaddyfile(input);
    expect(result.drafts).toEqual([]);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].message).toContain('Empty domain list');
  });

  it('returns valid drafts alongside errors (partial success)', () => {
    const input = `a.test.fr {
  reverse_proxy 1.2.3.4:80
}

bad.test.fr {
  tls something
  reverse_proxy 5.6.7.8:80
}

c.test.fr {
  reverse_proxy 9.9.9.9:80
}`;
    const result = parseCaddyfile(input);
    expect(result.drafts.map((d) => d.domains[0])).toEqual(['a.test.fr', 'c.test.fr']);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].message).toContain('tls');
  });

  it('rejects single-line blocks with closing brace on the same line (v1 scope)', () => {
    const input = `a.test.fr { reverse_proxy 1.2.3.4:80 }`;
    const result = parseCaddyfile(input);
    // v1 only supports multi-line blocks; the closing "}" must be on its own line.
    expect(result.drafts).toEqual([]);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].message).toContain('Single-line blocks are not supported');
  });

  it('strips a leading UTF-8 BOM before parsing', () => {
    const input = '﻿a.test.fr {\n  reverse_proxy 1.2.3.4:80\n}';
    const result = parseCaddyfile(input);
    expect(result.errors).toEqual([]);
    expect(result.drafts).toHaveLength(1);
    expect(result.drafts[0].domains).toEqual(['a.test.fr']);
  });

  it('rejects multi-upstream reverse_proxy lines', () => {
    const input = `a.test.fr {
  reverse_proxy 1.2.3.4:80 5.6.7.8:80
}`;
    const result = parseCaddyfile(input);
    expect(result.drafts).toEqual([]);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].message).toContain('multi-upstream');
  });

  it('flags single-line blocks with a specific message (not just missing brace)', () => {
    const input = `a.test.fr { reverse_proxy 1.2.3.4:80 }`;
    const result = parseCaddyfile(input);
    expect(result.drafts).toEqual([]);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].message).toContain('Single-line blocks');
  });
});
