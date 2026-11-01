import type { MeasurementRow, Report, ReportInput } from './types';

export function measurements(_source: ReportInput['source'], _master: ReportInput['master']): MeasurementRow[] {
  throw new Error('not yet (phase 5 stub)');
}

export function reportModel(_input: ReportInput): Report {
  throw new Error('not yet (phase 5 stub)');
}
