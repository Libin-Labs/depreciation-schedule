export type RoundingMode = 'floor' | 'ceil' | 'half-even' | 'half-up' | 'trunc';
export type DepreciationMethod = 'straight-line' | 'declining-balance' | 'units-of-production';

export interface DepreciationInput {
  readonly costCents: bigint | number;
  /** Book value the asset is never depreciated below. */
  readonly salvageCents: bigint | number;
  readonly method: DepreciationMethod;
  /** Useful life in periods (1 to 1200). Required except for `units-of-production`. */
  readonly lifePeriods?: number;
  /** Declining-balance multiple of the straight-line rate, as a decimal up to 6 places. Default 2. */
  readonly factor?: number | string;
  /** Declining-balance only: use straight-line over remaining life when it is larger. */
  readonly switchToStraightLine?: boolean;
  /** Declining-balance only: depreciate to salvage in the last period. Default true. */
  readonly finalPeriodToSalvage?: boolean;
  /** Units-of-production: estimated total lifetime units. */
  readonly totalUnits?: bigint | number;
  /** Units-of-production: units used in each period; the schedule has one row per entry. */
  readonly unitsPerPeriod?: readonly (bigint | number)[];
  /** Rounding applied to each computed figure. Defaults to `half-even`. */
  readonly rounding?: RoundingMode;
}

export interface DepreciationRow {
  readonly period: number;
  readonly depreciationCents: bigint;
  readonly accumulatedCents: bigint;
  readonly bookValueCents: bigint;
}

export interface DepreciationSchedule {
  readonly method: DepreciationMethod;
  readonly depreciableCents: bigint;
  readonly totalDepreciationCents: bigint;
  readonly rows: readonly DepreciationRow[];
}

export type DepreciationErrorCode = 'invalid-input';

export class DepreciationError extends Error {
  readonly code: DepreciationErrorCode = 'invalid-input';
  constructor(message: string) {
    super(message);
    this.name = 'DepreciationError';
  }
}

export const MAX_PERIODS = 1200;
const MODES: readonly RoundingMode[] = ['floor', 'ceil', 'half-even', 'half-up', 'trunc'];

function divRound(n: bigint, d: bigint, mode: RoundingMode): bigint {
  if (d < 0n) {
    n = -n;
    d = -d;
  }
  const q = n / d;
  const r = n % d;
  if (r === 0n) return q;
  const negative = n < 0n;
  const away = negative ? q - 1n : q + 1n;
  const twice = (r < 0n ? -r : r) * 2n;
  switch (mode) {
    case 'trunc':
      return q;
    case 'floor':
      return negative ? away : q;
    case 'ceil':
      return negative ? q : away;
    case 'half-up':
      return twice >= d ? away : q;
    case 'half-even':
      return twice > d || (twice === d && q % 2n !== 0n) ? away : q;
  }
}

function integer(value: unknown, name: string): bigint {
  if (typeof value === 'bigint') return value;
  if (typeof value === 'number' && Number.isSafeInteger(value)) return BigInt(value);
  throw new DepreciationError(`${name} must be a bigint or safe integer.`);
}

function factorFraction(value: number | string): [bigint, bigint] {
  const text = typeof value === 'number' ? String(value) : value;
  const match = /^(\d+)(?:\.(\d{1,6}))?$/.exec(typeof text === 'string' ? text : '');
  if (!match) throw new DepreciationError('factor must be a plain decimal with at most 6 places.');
  const fraction = match[2] ?? '';
  const numerator = BigInt((match[1] ?? '0') + fraction);
  const denominator = 10n ** BigInt(fraction.length);
  if (numerator <= 0n || numerator > 10n * denominator) {
    throw new DepreciationError('factor must be greater than 0 and at most 10.');
  }
  return [numerator, denominator];
}

function lifeOf(input: DepreciationInput): number {
  const life = input.lifePeriods;
  if (life === undefined || !Number.isInteger(life) || life < 1 || life > MAX_PERIODS) {
    throw new DepreciationError(`lifePeriods must be an integer from 1 to ${MAX_PERIODS}.`);
  }
  return life;
}

export function depreciationSchedule(input: DepreciationInput): DepreciationSchedule {
  const cost = integer(input.costCents, 'costCents');
  const salvage = integer(input.salvageCents, 'salvageCents');
  if (cost <= 0n) throw new DepreciationError('costCents must be positive.');
  if (salvage < 0n || salvage > cost) {
    throw new DepreciationError('salvageCents must be between 0 and the cost.');
  }
  const mode = input.rounding ?? 'half-even';
  if (!MODES.includes(mode)) throw new DepreciationError('Unknown rounding mode.');
  const depreciable = cost - salvage;
  const amounts: bigint[] = [];

  if (input.method === 'straight-line') {
    const life = lifeOf(input);
    // Cumulative rounding spreads residue across periods and ends exactly on salvage.
    let previous = 0n;
    for (let k = 1; k <= life; k += 1) {
      const accumulated = divRound(depreciable * BigInt(k), BigInt(life), mode);
      amounts.push(accumulated - previous);
      previous = accumulated;
    }
  } else if (input.method === 'declining-balance') {
    const life = lifeOf(input);
    const [num, den] = factorFraction(input.factor ?? 2);
    const toSalvage = input.finalPeriodToSalvage ?? true;
    let book = cost;
    for (let k = 1; k <= life; k += 1) {
      const room = book - salvage;
      let amount = divRound(book * num, den * BigInt(life), mode);
      if (input.switchToStraightLine === true) {
        const level = divRound(room, BigInt(life - k + 1), mode);
        if (level > amount) amount = level;
      }
      if (k === life && toSalvage) amount = room;
      if (amount > room) amount = room;
      amounts.push(amount);
      book -= amount;
    }
  } else if (input.method === 'units-of-production') {
    const units = input.unitsPerPeriod;
    const total = integer(input.totalUnits, 'totalUnits');
    if (!Array.isArray(units) || units.length < 1 || units.length > MAX_PERIODS) {
      throw new DepreciationError(`unitsPerPeriod must hold 1 to ${MAX_PERIODS} entries.`);
    }
    if (total <= 0n) throw new DepreciationError('totalUnits must be positive.');
    let used = 0n;
    let previous = 0n;
    for (const entry of units) {
      const value = integer(entry, 'unitsPerPeriod entry');
      if (value < 0n) throw new DepreciationError('unitsPerPeriod entries must not be negative.');
      used += value;
      if (used > total) throw new DepreciationError('Cumulative units exceed totalUnits.');
      const accumulated = divRound(depreciable * used, total, mode);
      amounts.push(accumulated - previous);
      previous = accumulated;
    }
  } else {
    throw new DepreciationError('Unknown depreciation method.');
  }

  const rows: DepreciationRow[] = [];
  let accumulated = 0n;
  amounts.forEach((amount, index) => {
    accumulated += amount;
    rows.push(
      Object.freeze({
        period: index + 1,
        depreciationCents: amount,
        accumulatedCents: accumulated,
        bookValueCents: cost - accumulated,
      }),
    );
  });
  return Object.freeze({
    method: input.method,
    depreciableCents: depreciable,
    totalDepreciationCents: accumulated,
    rows: Object.freeze(rows),
  });
}
