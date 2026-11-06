import { depreciationSchedule, DepreciationError } from '@lp-labs/depreciation-schedule';

const total: bigint = depreciationSchedule({
  costCents: 100,
  salvageCents: 0,
  method: 'straight-line',
  lifePeriods: 3,
}).totalDepreciationCents;
const code: 'invalid-input' = new DepreciationError('x').code;
void [total, code];
