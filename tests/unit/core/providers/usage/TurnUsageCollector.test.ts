import { TurnUsageCollector } from '@/core/providers/usage/TurnUsageCollector';
import type { UsageInfo } from '@/core/types';

function usage(contextTokens: number, reportType?: UsageInfo['reportType']): UsageInfo {
  return {
    contextTokens,
    contextWindow: 10_000,
    inputTokens: contextTokens,
    outputTokens: 10,
    percentage: contextTokens / 100,
    reportType,
  };
}

describe('TurnUsageCollector', () => {
  it('books one final report instead of cumulative snapshots', () => {
    const collector = new TurnUsageCollector();
    collector.observe(usage(100, 'snapshot'));
    collector.observe(usage(180, 'snapshot'));
    collector.observe(usage(220, 'final'));
    collector.observe(usage(220, 'final'));

    expect(collector.accountingReports()).toEqual([usage(220, 'final')]);
  });

  it('uses explicit deltas when no final report exists', () => {
    const collector = new TurnUsageCollector();
    collector.observe(usage(40, 'delta'));
    collector.observe(usage(60, 'delta'));

    expect(collector.accountingReports()).toEqual([
      usage(40, 'delta'),
      usage(60, 'delta'),
    ]);
  });

  it('keeps only the latest legacy report to avoid cumulative double counting', () => {
    const collector = new TurnUsageCollector();
    collector.observe(usage(100));
    collector.observe(usage(175));

    expect(collector.accountingReports()).toEqual([usage(175)]);
  });

  it('lets a final report supersede earlier deltas for the same one-shot turn', () => {
    const collector = new TurnUsageCollector();
    collector.observe(usage(40, 'delta'));
    collector.observe(usage(100, 'final'));

    expect(collector.accountingReports()).toEqual([usage(100, 'final')]);
  });

  it('does not turn a display-only snapshot into billable usage', () => {
    const collector = new TurnUsageCollector();
    collector.observe(usage(100, 'snapshot'));

    expect(collector.accountingReports()).toEqual([]);
  });
});
