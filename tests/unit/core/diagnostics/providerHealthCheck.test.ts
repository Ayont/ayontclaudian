import {
  firstOutputLine,
  formatHealthReportMarkdown,
  type HealthCheckResult,
} from '@/core/diagnostics/providerHealthCheck';

describe('firstOutputLine', () => {
  it('returns the first non-empty trimmed line', () => {
    expect(firstOutputLine('\n  \n  v1.2.3  \nmore')).toBe('v1.2.3');
    expect(firstOutputLine('')).toBe('');
  });
});

describe('formatHealthReportMarkdown', () => {
  const results: HealthCheckResult[] = [
    { providerId: 'claude', name: 'Claude', configured: true, reachable: true, version: 'claude 1.0.0' },
    { providerId: 'vibe', name: 'Vibe', configured: true, reachable: false, detail: 'timed out' },
    { providerId: 'pi', name: 'Pi', configured: false, reachable: false, detail: 'disabled' },
  ];

  it('summarizes reachable/configured counts', () => {
    const md = formatHealthReportMarkdown(results);
    expect(md).toContain('1/2 configured providers reachable.');
  });

  it('renders one row per provider with the right status icon', () => {
    const md = formatHealthReportMarkdown(results);
    expect(md).toContain('| Claude | ✅ | claude 1.0.0 |');
    expect(md).toContain('| Vibe | ❌ | timed out |');
    expect(md).toContain('| Pi | ➖ | disabled |');
  });
});
