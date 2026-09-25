import { describe, expect, it } from 'vitest';
import { toSafeChartLabel } from '@/src/lib/chart-labels';

describe('toSafeChartLabel', () => {
  it('keeps ordinary user-agent and protocol text', () => {
    expect(toSafeChartLabel('HTTP/2.0')).toBe('HTTP/2.0');
    expect(toSafeChartLabel('Mozilla/5.0 (X11; Linux x86_64)')).toBe('Mozilla/5.0 (X11; Linux x86_64)');
    expect(toSafeChartLabel('Überbot/1.0')).toBe('Überbot/1.0');
  });

  it('removes every character with HTML meaning', () => {
    const label = toSafeChartLabel('<img src=x onerror="a(1)">&amp;\'`');
    expect(label).not.toMatch(/[<>"'&`]/);
  });
});
