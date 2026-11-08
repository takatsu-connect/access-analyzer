import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import * as config from '@/lib/config';

// S-16: contracts/constants.json を正として、TypeScript の定数が一致することを確かめる。
const CONTRACTS_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../../contracts/constants.json',
);
const contracts = JSON.parse(readFileSync(CONTRACTS_PATH, 'utf8')) as Record<string, unknown>;
const exported = config as Record<string, unknown>;
// WP_RELAY はバッチと中継（apps/wp-relay）の間の定数で、BI は使わない（ADR 0011）
const BI_CONTRACT_KEYS = Object.keys(contracts).filter((key) => key !== 'WP_RELAY');

// BI だけの設定値（バッチは使わないので JSON にはない）。値は 05 §2.3〜§2.7 と 04 §3.1。
// config.ts に定数を足すときは、JSON かこの一覧のどちらかに足す。どちらにもない定数は下の検査で落ちる。
const BI_ONLY_CONSTANTS: Record<string, unknown> = {
  RATIO_MIN_DENOMINATOR: 20,
  UNCONFIRMED_DAYS: 3,
  STALE_AFTER_DAYS: 3,
  DEFAULT_PERIOD_ID: 'last28',
  MAX_MONTHS: 36,
};

describe('contracts/constants.json と src/lib/config.ts', () => {
  it('JSON に定数がある', () => {
    expect(Object.keys(contracts).length).toBeGreaterThan(0);
  });

  it.each(BI_CONTRACT_KEYS)('%s が JSON と一致する', (key) => {
    expect(exported[key]).toEqual(contracts[key]);
  });

  it('要件で名指しされた定数が JSON にある', () => {
    expect(Object.keys(contracts)).toEqual(
      expect.arrayContaining([
        'SITE_ORIGIN',
        'CHANNEL_BUCKETS',
        'SNS_BUCKETS',
        'DEVICE_BUCKETS',
        'NEW_RETURNING_BUCKETS',
        'LOCAL_BUCKETS',
        'FRESHNESS_BUCKETS',
        'WINDOW_PERIOD_IDS',
      ]),
    );
  });

  it('config.ts の定数は、JSON にあるものと、BI だけの設定値の一覧にあるものだけ', () => {
    const constantNames = Object.keys(exported).filter((name) => /^[A-Z0-9_]+$/.test(name));
    expect(constantNames.sort()).toEqual(
      [...BI_CONTRACT_KEYS, ...Object.keys(BI_ONLY_CONSTANTS)].sort(),
    );
  });

  it('BI だけの設定値は、JSON の定数と名前が重ならない', () => {
    expect(Object.keys(BI_ONLY_CONSTANTS).filter((name) => name in contracts)).toEqual([]);
  });

  it.each(Object.entries(BI_ONLY_CONSTANTS))(
    'BI だけの設定値 %s が設計の値と同じ',
    (key, value) => {
      expect(exported[key]).toBe(value);
    },
  );
});
