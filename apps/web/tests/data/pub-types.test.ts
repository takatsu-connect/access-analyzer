/**
 * 公開ビューの列の突き合わせ（07 U-20 の代わり）。
 *
 * 正はリポジトリ直下の tests/snapshots/pub-columns.json（ローカルの Supabase から取った列名と型）。
 * ビューや列が増えたり減ったりしたら、ここで落ちる。型（pub-types.ts）とスキーマのずれは、
 * src/data/pub/schemas.ts の PubSchemaChecks がコンパイル時に検査する。
 */
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';
import type * as z from 'zod';

import { VIEWS } from '@/data/pub/load';
import { PUB_ROW_SCHEMAS, type PubViewName } from '@/data/pub/schemas';

type SnapshotColumn = { column: string; type: string };

const snapshot = JSON.parse(
  readFileSync(new URL('../../../../tests/snapshots/pub-columns.json', import.meta.url), 'utf8'),
) as Record<string, SnapshotColumn[]>;

/** Postgres の型 → JSON での型。 */
const JSON_KIND: Record<string, string> = {
  integer: 'number',
  smallint: 'number',
  bigint: 'number',
  numeric: 'number',
  'double precision': 'number',
  boolean: 'boolean',
  text: 'string',
  date: 'string',
  'timestamp with time zone': 'string',
};

/** スキーマが受け付ける JSON の型（null を許す指定は外して見る）。 */
function kindOf(schema: z.ZodType): string {
  const def = schema.def as { type: string; innerType?: z.ZodType; values?: unknown[] };
  if (def.type === 'nullable' && def.innerType !== undefined) return kindOf(def.innerType);
  if (def.type === 'enum') return 'string';
  if (def.type === 'literal') return typeof def.values?.[0];
  return def.type;
}

const viewNames = Object.keys(PUB_ROW_SCHEMAS) as PubViewName[];

describe('公開ビューの列（スナップショットとの突き合わせ）', () => {
  it('ビューの集合が一致する', () => {
    expect([...viewNames].sort()).toEqual(Object.keys(snapshot).sort());
  });

  it.each(viewNames)('%s の列の集合が一致する', (name) => {
    const columns = Object.keys(PUB_ROW_SCHEMAS[name].shape).sort();
    expect(columns).toEqual((snapshot[name] ?? []).map((entry) => entry.column).sort());
  });

  it.each(viewNames)('%s の列の型が一致する', (name) => {
    const shape: Record<string, z.ZodType> = PUB_ROW_SCHEMAS[name].shape;
    for (const { column, type } of snapshot[name] ?? []) {
      const schema = shape[column];
      expect(schema, `${name}.${column}`).toBeDefined();
      if (schema !== undefined) expect(kindOf(schema), `${name}.${column}`).toBe(JSON_KIND[type]);
    }
  });

  it('未知の列のある行を受け付けない', () => {
    const row = { tag_id: 1, name: 'さんぽ' };
    expect(PUB_ROW_SCHEMAS.pub_tag.safeParse(row).success).toBe(true);
    expect(PUB_ROW_SCHEMAS.pub_tag.safeParse({ ...row, secret: 'x' }).success).toBe(false);
  });
});

describe('読むビューの定義', () => {
  const specs = Object.values(VIEWS);

  it('pub_batch_run 以外の全ビューを読む', () => {
    const read = specs.map((spec) => spec.name).sort();
    expect(read).toEqual(viewNames.filter((name) => name !== 'pub_batch_run').sort());
  });

  it.each(specs.map((spec) => [spec.name, spec] as const))(
    '%s は列を列挙し、主キーの順に読む',
    (name, spec) => {
      expect(spec.columns).toEqual((snapshot[name] ?? []).map((entry) => entry.column));
      expect(spec.columns).not.toContain('*');
      expect(spec.orderBy.length).toBeGreaterThan(0);
      for (const column of spec.orderBy) expect(spec.columns).toContain(column);
    },
  );
});
