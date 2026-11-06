import { depreciationSchedule, type DepreciationSchedule } from '@lp-labs/depreciation-schedule';

const schedule: DepreciationSchedule = depreciationSchedule({
  costCents: 10_000n,
  salvageCents: 1_000n,
  method: 'declining-balance',
  lifePeriods: 5,
  switchToStraightLine: true,
});
const last: bigint | undefined = schedule.rows.at(-1)?.bookValueCents;
void last;
