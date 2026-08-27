import type { UsageInfo } from '../../types';

/**
 * Normalizes all usage events emitted by one isolated runtime query into the
 * reports that may be booked exactly once at the accounting boundary.
 */
export class TurnUsageCollector {
  private finalReport: UsageInfo | null = null;
  private readonly deltaReports: UsageInfo[] = [];
  private legacyReport: UsageInfo | null = null;

  observe(usage: UsageInfo): void {
    const report = { ...usage };
    switch (report.reportType) {
      case 'snapshot':
        return;
      case 'final':
        this.finalReport = report;
        return;
      case 'delta':
        this.deltaReports.push(report);
        return;
      default:
        this.legacyReport = report;
    }
  }

  accountingReports(): UsageInfo[] {
    if (this.finalReport) return [{ ...this.finalReport }];
    if (this.deltaReports.length > 0) {
      return this.deltaReports.map((report) => ({ ...report }));
    }
    return this.legacyReport ? [{ ...this.legacyReport }] : [];
  }
}
