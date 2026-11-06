# @lp-labs/depreciation-schedule

Depreciation schedules in exact integer cents: straight-line, declining-balance (with optional
switch to straight-line), and units-of-production. All figures use `bigint` arithmetic, an explicit
rounding mode, and never take book value below the salvage value you supply.

## Install

```bash
npm install @lp-labs/depreciation-schedule
```

ES2022 ESM and CommonJS builds ship with TypeScript declarations. There are no runtime dependencies.

## Quickstart

```js
import { depreciationSchedule } from '@lp-labs/depreciation-schedule';

const schedule = depreciationSchedule({
  costCents: 100_000n,
  salvageCents: 10_000n,
  method: 'declining-balance',
  lifePeriods: 5,
});
const last = schedule.rows.at(-1);
if (last.bookValueCents !== 10_000n) throw new Error('should end at salvage');
console.log(schedule.rows.map((row) => row.depreciationCents));
```

## API

```ts
type RoundingMode = 'floor' | 'ceil' | 'half-even' | 'half-up' | 'trunc';
type DepreciationMethod = 'straight-line' | 'declining-balance' | 'units-of-production';
interface DepreciationInput {
  costCents: bigint | number;
  salvageCents: bigint | number;
  method: DepreciationMethod;
  lifePeriods?: number;
  factor?: number | string;
  switchToStraightLine?: boolean;
  finalPeriodToSalvage?: boolean;
  totalUnits?: bigint | number;
  unitsPerPeriod?: readonly (bigint | number)[];
  rounding?: RoundingMode;
}
interface DepreciationRow {
  period: number;
  depreciationCents: bigint;
  accumulatedCents: bigint;
  bookValueCents: bigint;
}
interface DepreciationSchedule {
  method: DepreciationMethod;
  depreciableCents: bigint;
  totalDepreciationCents: bigint;
  rows: readonly DepreciationRow[];
}
type DepreciationErrorCode = 'invalid-input';
class DepreciationError extends Error {
  readonly code: 'invalid-input';
}
const MAX_PERIODS: 1200;
function depreciationSchedule(input: DepreciationInput): DepreciationSchedule;
```

### Method details

- **straight-line**: cumulative amount after period `k` is `round((cost - salvage) * k / life)`; each
  period is the difference, so rounding residue is spread and the last period lands exactly on salvage.
- **declining-balance**: each period is `round(bookValue * factor / life)` (default factor 2), capped
  so book value never falls below salvage. With `switchToStraightLine`, a period uses the larger of
  that amount and the remaining depreciable amount divided by remaining periods. With
  `finalPeriodToSalvage` (default) the last period depreciates the remainder to salvage; set it to
  `false` to keep the pure declining amounts.
- **units-of-production**: cumulative depreciation is `round(depreciable * cumulativeUnits / totalUnits)`.
  The schedule has one row per `unitsPerPeriod` entry (zeros allowed); it need not use all units, and
  exceeding `totalUnits` is an error.

## Customization

Pick `rounding`, `factor` (more than 0 up to 10, six decimals), and the period length: a period is
whatever interval you count (month, year). No calendar or partial-year convention is applied.

## Errors

Invalid cost, salvage, life, factor, units, method, or rounding throws `DepreciationError`.

## Performance

Linear in the number of periods (at most 1200), with bigint arithmetic.

## Honest scope

This is arithmetic only. It does not implement any tax or accounting standard (MACRS, half-year
conventions, impairment, component depreciation) and makes no compliance claim. Confirm treatment
with your accounting rules.

## Support

If this library is useful to you, consider supporting its maintenance with a [donation via PayPal](https://www.paypal.me/LibinPrasanth).

## Author

Created by [Libin Prasanth](https://www.linkedin.com/in/libinprasanth/). Connect on LinkedIn for updates and discussion.
