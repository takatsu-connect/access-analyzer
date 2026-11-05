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

describe('contracts/constants.json と src/lib/config.ts', () => {
  it('JSON に定数がある', () => {
    expect(Object.keys(contracts).length).toBeGreaterThan(0);
  });

  it.each(Object.keys(contracts))('%s が JSON と一致する', (key) => {
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

  it('config.ts に JSON にない定数がない', () => {
    const constantNames = Object.keys(exported).filter((name) => /^[A-Z0-9_]+$/.test(name));
    expect(constantNames.sort()).toEqual(Object.keys(contracts).sort());
  });
});
