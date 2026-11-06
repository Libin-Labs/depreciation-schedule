import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { depreciationSchedule, DepreciationError } from '../dist/esm/index.js';

const deps = (s) => s.rows.map((r) => r.depreciationCents);

test('straight line splits residue by cumulative rounding and lands on salvage', () => {
  const s = depreciationSchedule({
    costCents: 10_000n,
    salvageCents: 1_000n,
    method: 'straight-line',
    lifePeriods: 4,
  });
  assert.deepEqual(deps(s), [2250n, 2250n, 2250n, 2250n]);
  const odd = depreciationSchedule({
    costCents: 1_001n,
    salvageCents: 0n,
    method: 'straight-line',
    lifePeriods: 3,
    rounding: 'floor',
  });
  assert.deepEqual(deps(odd), [333n, 334n, 334n]);
  assert.equal(odd.rows.at(-1).bookValueCents, 0n);
  // independent oracle: floor(D*k/n) differences
  for (const [d, n] of [
    [12_345, 7],
    [99, 100],
    [1, 3],
    [1_000_003, 360],
  ]) {
    const s2 = depreciationSchedule({
      costCents: d,
      salvageCents: 0,
      method: 'straight-line',
      lifePeriods: n,
      rounding: 'floor',
    });
    s2.rows.forEach((row, i) =>
      assert.equal(row.accumulatedCents, BigInt(Math.floor((d * (i + 1)) / n))),
    );
  }
});

test('double declining balance matches a hand-computed table', () => {
  const s = depreciationSchedule({
    costCents: 100_000n,
    salvageCents: 10_000n,
    method: 'declining-balance',
    lifePeriods: 5,
  });
  assert.deepEqual(deps(s), [40000n, 24000n, 14400n, 8640n, 2960n]); // final period takes the remainder to salvage
  assert.deepEqual(
    s.rows.map((r) => r.bookValueCents),
    [60000n, 36000n, 21600n, 12960n, 10000n],
  );
});

test('declining balance honours factor, salvage cap, switch, and final-period policy', () => {
  const off = depreciationSchedule({
    costCents: 100_000n,
    salvageCents: 10_000n,
    method: 'declining-balance',
    lifePeriods: 5,
    finalPeriodToSalvage: false,
  });
  assert.deepEqual(deps(off), [40000n, 24000n, 14400n, 8640n, 2960n]);
  assert.equal(off.rows.at(-1).bookValueCents, 10_000n);
  const high = depreciationSchedule({
    costCents: 1_000n,
    salvageCents: 900n,
    method: 'declining-balance',
    lifePeriods: 2,
    factor: '10',
    finalPeriodToSalvage: false,
  });
  assert.deepEqual(deps(high), [100n, 0n]);
  const sw = depreciationSchedule({
    costCents: 100_000n,
    salvageCents: 10_000n,
    method: 'declining-balance',
    lifePeriods: 5,
    switchToStraightLine: true,
  });
  assert.deepEqual(deps(sw).slice(0, 3), [40000n, 24000n, 14400n]);
  assert.equal(deps(sw)[3], 8640n);
  const ten = {
    costCents: 100_000n,
    salvageCents: 10_000n,
    method: 'declining-balance',
    lifePeriods: 10,
    finalPeriodToSalvage: false,
  };
  const plain = depreciationSchedule(ten);
  const switched = depreciationSchedule({ ...ten, switchToStraightLine: true });
  assert.ok(
    switched.rows.at(-1).bookValueCents === 10_000n && plain.rows.at(-1).bookValueCents > 10_000n,
  );
  assert.ok(deps(switched)[8] > deps(plain)[8]);
  assert.ok(sw.rows.every((r) => r.bookValueCents >= 10_000n));
  assert.equal(sw.rows.at(-1).bookValueCents, 10_000n);
  const f15 = depreciationSchedule({
    costCents: 100_000n,
    salvageCents: 0n,
    method: 'declining-balance',
    lifePeriods: 10,
    factor: 1.5,
  });
  assert.equal(f15.rows[0].depreciationCents, 15000n);
});

test('units of production allocates by cumulative usage and allows idle periods', () => {
  const s = depreciationSchedule({
    costCents: 50_000n,
    salvageCents: 5_000n,
    method: 'units-of-production',
    totalUnits: 1000,
    unitsPerPeriod: [100, 0, 300, 600],
  });
  assert.deepEqual(deps(s), [4500n, 0n, 13500n, 27000n]);
  const partial = depreciationSchedule({
    costCents: 50_000n,
    salvageCents: 5_000n,
    method: 'units-of-production',
    totalUnits: 1000n,
    unitsPerPeriod: [250n],
  });
  assert.equal(partial.totalDepreciationCents, 11250n);
  const thirds = depreciationSchedule({
    costCents: 100n,
    salvageCents: 0n,
    method: 'units-of-production',
    totalUnits: 3,
    unitsPerPeriod: [1, 1, 1],
    rounding: 'floor',
  });
  assert.deepEqual(deps(thirds), [33n, 33n, 34n]);
});

test('invariants hold for generated schedules of every method', () => {
  for (let i = 1; i <= 40; i += 1) {
    const cost = BigInt(i * 7919 + 13);
    const salvage = BigInt((i * 101) % Number(cost));
    for (const method of ['straight-line', 'declining-balance']) {
      for (const rounding of ['floor', 'ceil', 'half-even', 'half-up', 'trunc']) {
        const s = depreciationSchedule({
          costCents: cost,
          salvageCents: salvage,
          method,
          lifePeriods: (i % 17) + 1,
          rounding,
        });
        assert.equal(s.rows.at(-1).bookValueCents, salvage, `${method} ${rounding} ${i}`);
        assert.ok(s.rows.every((r) => r.depreciationCents >= 0n && r.bookValueCents >= salvage));
      }
    }
  }
});

test('malformed input is rejected', () => {
  const base = { costCents: 1000n, salvageCents: 100n, method: 'straight-line', lifePeriods: 5 };
  for (const bad of [
    { costCents: 0n },
    { costCents: 1.5 },
    { salvageCents: -1n },
    { salvageCents: 1001n },
    { lifePeriods: 0 },
    { lifePeriods: 1201 },
    { lifePeriods: undefined },
    { method: 'sum-of-years' },
    { rounding: 'nearest' },
    { method: 'declining-balance', factor: '0' },
    { method: 'declining-balance', factor: 11 },
    { method: 'declining-balance', factor: '1.1234567' },
    { method: 'declining-balance', factor: NaN },
    { method: 'units-of-production', totalUnits: 10, unitsPerPeriod: [6, 5] },
    { method: 'units-of-production', totalUnits: 10, unitsPerPeriod: [] },
    { method: 'units-of-production', totalUnits: 10, unitsPerPeriod: [-1] },
    { method: 'units-of-production', totalUnits: 0, unitsPerPeriod: [0] },
    { method: 'units-of-production', totalUnits: 10, unitsPerPeriod: [1.5] },
  ]) {
    assert.throws(
      () => depreciationSchedule({ ...base, ...bad }),
      DepreciationError,
      JSON.stringify(bad, (k, v) => (typeof v === 'bigint' ? `${v}n` : v)),
    );
  }
});

test('large values stay exact and CJS agrees', () => {
  const cost = 10n ** 30n + 7n;
  const s = depreciationSchedule({
    costCents: cost,
    salvageCents: 0n,
    method: 'straight-line',
    lifePeriods: 1200,
  });
  assert.equal(s.totalDepreciationCents, cost);
  const cjs = createRequire(import.meta.url)('@lp-labs/depreciation-schedule');
  assert.equal(
    cjs.depreciationSchedule({
      costCents: 300,
      salvageCents: 0,
      method: 'straight-line',
      lifePeriods: 3,
    }).rows.length,
    3,
  );
});
