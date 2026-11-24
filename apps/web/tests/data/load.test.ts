/**
 * 読み出し層（src/data/pub）のテスト。Supabase には接続しない（問い合わせは偽物）。
 */
import { describe, expect, it } from 'vitest';

import { createPubClient, PubConfigError, type PubClient } from '@/data/pub/client';
import {
  PAGE_SIZE,
  PubReadError,
  readAllViews,
  readView,
  RETRY_DELAYS_MS,
  VIEWS,
  type ViewQuery,
  type ViewSource,
} from '@/data/pub/load';

type Call = { columns: string; filters: string[]; order: string[]; range: [number, number] };

/** 読み直す前の待ちを、待たずに記録する偽物。 */
function fakeWait(): { waits: number[]; wait: (ms: number) => Promise<void> } {
  const waits: number[] = [];
  return {
    waits,
    wait: (ms) => {
      waits.push(ms);
      return Promise.resolve();
    },
  };
}

/**
 * total 行のタグを返す偽の問い合わせ。呼ばれ方を calls に残す。cap はサーバー側の行数の上限。
 * fails は、何回目の問い合わせ（0 始まり）を失敗させるか。
 */
function fakeTagSource(
  total: number,
  calls: Call[],
  fails: (index: number) => boolean = () => false,
  cap = PAGE_SIZE,
): () => ViewSource {
  return () => ({
    select(columns) {
      const call: Call = { columns, filters: [], order: [], range: [0, 0] };
      const query: ViewQuery = {
        in(column, values) {
          call.filters.push(`${column}=${values.join('|')}`);
          return query;
        },
        order(column, options) {
          call.order.push(`${column}:${options.ascending ? 'asc' : 'desc'}`);
          return query;
        },
        range(from, to) {
          call.range = [from, to];
          calls.push(call);
          if (fails(calls.length - 1)) {
            return Promise.resolve({
              data: null,
              error: { message: 'http://db.internal.example/rest/v1 secret-key' },
            });
          }
          const rows = [];
          for (let id = from; id <= Math.min(to, from + cap - 1, total - 1); id += 1) {
            rows.push({ tag_id: id, name: `タグ ${id}` });
          }
          return Promise.resolve({ data: rows, error: null });
        },
      };
      return query;
    },
  });
}

describe('readView', () => {
  it('1,000 行を超えるビューを、主キーの順に 1,000 行ずつ最後まで読む', async () => {
    const calls: Call[] = [];
    const rows = await readView(VIEWS.tags, fakeTagSource(2500, calls));

    expect(rows).toHaveLength(2500);
    expect(rows[0]).toEqual({ tag_id: 0, name: 'タグ 0' });
    expect(rows.at(-1)).toEqual({ tag_id: 2499, name: 'タグ 2499' });
    // 最後は、空のページが返ることを確かめて終わる。
    expect(calls.map((call) => call.range)).toEqual([
      [0, PAGE_SIZE - 1],
      [PAGE_SIZE, 2 * PAGE_SIZE - 1],
      [2 * PAGE_SIZE, 3 * PAGE_SIZE - 1],
      [2500, 2500 + PAGE_SIZE - 1],
    ]);
    for (const call of calls) {
      expect(call.columns).toBe('tag_id,name');
      expect(call.order).toEqual(['tag_id:asc']);
    }
  });

  it('ちょうど 1,000 行のときも、次のページが空であることを確かめて終わる', async () => {
    const calls: Call[] = [];
    const rows = await readView(VIEWS.tags, fakeTagSource(PAGE_SIZE, calls));
    expect(rows).toHaveLength(PAGE_SIZE);
    expect(calls).toHaveLength(2);
  });

  it('サーバー側の上限が 1,000 行より小さくても、欠けずに最後まで読む', async () => {
    const calls: Call[] = [];
    const rows = await readView(
      VIEWS.tags,
      fakeTagSource(1000, calls, () => false, 400),
    );
    expect(rows.map((row) => row.tag_id)).toEqual([...Array(1000).keys()]);
    expect(calls.map((call) => call.range[0])).toEqual([0, 400, 800, 1000]);
  });

  it('0 行のビューは空の配列', async () => {
    const calls: Call[] = [];
    expect(await readView(VIEWS.tags, fakeTagSource(0, calls))).toEqual([]);
    expect(calls).toHaveLength(1);
  });

  it('分布は scope が全体と記事の種類（記事、イベント）の行だけを読む', async () => {
    const calls: Call[] = [];
    const source = fakeTagSource(0, calls);
    await readView(VIEWS.benchmarkCurve, source);
    expect(calls[0]?.filters).toEqual(['scope=all|kind:article|kind:event']);
    expect(calls[0]?.order).toEqual(['scope:asc', 'n:asc']);
  });

  it('読めている間は、待たない', async () => {
    const { waits, wait } = fakeWait();
    await readView(VIEWS.tags, fakeTagSource(2500, []), wait);
    expect(waits).toEqual([]);
  });

  it('読めなかったページだけを、間隔を空けて読み直す', async () => {
    const calls: Call[] = [];
    const { waits, wait } = fakeWait();
    // 2 ページ目の 1 回目と 2 回目（1、2 回目の問い合わせ）だけが失敗する。
    const source = fakeTagSource(2500, calls, (index) => index === 1 || index === 2);
    const rows = await readView(VIEWS.tags, source, wait);

    expect(rows.map((row) => row.tag_id)).toEqual([...Array(2500).keys()]);
    expect(calls.map((call) => call.range[0])).toEqual([0, 1000, 1000, 1000, 2000, 2500]);
    expect(waits).toEqual(RETRY_DELAYS_MS.slice(0, 2));
  });

  it('読み直しの回数は、ページごとに数え直す', async () => {
    const calls: Call[] = [];
    const { waits, wait } = fakeWait();
    // 1 ページ目で 3 回、2 ページ目でも 3 回失敗する。どちらも最後の読み直しで読める。
    const failing = new Set([0, 1, 2, 4, 5, 6]);
    const rows = await readView(
      VIEWS.tags,
      fakeTagSource(1500, calls, (index) => failing.has(index)),
      wait,
    );
    expect(rows).toHaveLength(1500);
    expect(waits).toEqual([...RETRY_DELAYS_MS, ...RETRY_DELAYS_MS]);
  });

  it('読み直しても読めなければ、ビューの名前だけを含むエラーにする', async () => {
    const calls: Call[] = [];
    const { waits, wait } = fakeWait();
    const error = await readView(
      VIEWS.tags,
      fakeTagSource(2500, calls, (index) => index >= 1),
      wait,
    ).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(PubReadError);
    const { message, cause } = error as PubReadError;
    expect(message).toBe('公開ビュー pub_tag を読めませんでした');
    expect(message).not.toContain('http');
    expect(message).not.toContain('secret-key');
    expect(cause).toBeUndefined();
    // 最初の 1 回と、読み直しの回数だけ問い合わせて、あきらめる。
    expect(calls.map((call) => call.range[0])).toEqual([
      0,
      ...RETRY_DELAYS_MS.map(() => 1000),
      1000,
    ]);
    expect(waits).toEqual(RETRY_DELAYS_MS);
  });

  it('問い合わせが例外を投げても読み直し、元のエラーを引き継がない', async () => {
    let opened = 0;
    const { waits, wait } = fakeWait();
    const open = (): ViewSource => {
      opened += 1;
      throw new Error('connect ECONNREFUSED http://db.internal.example secret-key');
    };
    const error = await readView(VIEWS.tags, open, wait).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(PubReadError);
    expect((error as PubReadError).message).toBe('公開ビュー pub_tag を読めませんでした');
    expect((error as PubReadError).cause).toBeUndefined();
    expect(opened).toBe(1 + RETRY_DELAYS_MS.length);
    expect(waits).toEqual(RETRY_DELAYS_MS);
  });

  it('想定した形と違う行は、読み直さずに、値を含まないエラーにする', async () => {
    let asked = 0;
    const { waits, wait } = fakeWait();
    const open = (): ViewSource => ({
      select: () => {
        const query: ViewQuery = {
          in: () => query,
          order: () => query,
          range: () => {
            asked += 1;
            return Promise.resolve({
              data: [{ tag_id: 'ひみつの値', name: 'さんぽ' }],
              error: null,
            });
          },
        };
        return query;
      },
    });
    const error = await readView(VIEWS.tags, open, wait).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(PubReadError);
    expect((error as PubReadError).kind).toBe('shape');
    expect((error as PubReadError).message).toBe('公開ビュー pub_tag の行が、想定した形と違います');
    expect(asked).toBe(1);
    expect(waits).toEqual([]);
  });
});

describe('readAllViews', () => {
  /** pub_meta だけ 1 行、ほかは 0 行を返す偽のクライアント。問い合わせたビューの名前を asked に残す。 */
  function fakeClient(asked: string[]): PubClient {
    const metaRow = {
      base_date: '2026-11-03',
      finished_at: '2026-11-04T19:12:34.567891+00:00',
      mask_threshold: 5,
      is_stale: false,
      last_status: 'success',
    };
    const from = (name: string): ViewSource => ({
      select: () => {
        const query: ViewQuery = {
          in: () => query,
          order: () => query,
          range: (offset) => {
            if (offset === 0) asked.push(name);
            const rows = name === 'pub_meta' && offset === 0 ? [metaRow] : [];
            return Promise.resolve({ data: rows, error: null });
          },
        };
        return query;
      },
    });
    return { from } as unknown as PubClient;
  }

  it('読むビュー（VIEWS）だけに問い合わせる。画面で使わないビューは読まない', async () => {
    const asked: string[] = [];
    const cache = await readAllViews(fakeClient(asked));

    expect([...asked].sort()).toEqual(
      Object.values(VIEWS)
        .map((spec) => spec.name)
        .sort(),
    );
    expect(asked).not.toContain('pub_site_daily_channel');
    expect(asked).not.toContain('pub_site_daily_device');
    // PubCache の項目は、読むビューの一覧と同じ。
    expect(Object.keys(cache).sort()).toEqual(Object.keys(VIEWS).sort());
    expect(cache).not.toHaveProperty('siteDailyChannel');
    expect(cache).not.toHaveProperty('siteDailyDevice');
  });
});

describe('createPubClient', () => {
  const url = 'http://127.0.0.1:54321';
  const key = 'dummy-anon-key-for-test';

  it('変数が足りないときは、変数の名前だけを含む固定の文で失敗する', () => {
    expect(() => createPubClient({})).toThrow(
      new PubConfigError('環境変数が設定されていません: SUPABASE_URL, SUPABASE_ANON_KEY'),
    );
    expect(() => createPubClient({ SUPABASE_URL: url })).toThrow(
      new PubConfigError('環境変数が設定されていません: SUPABASE_ANON_KEY'),
    );
    expect(() => createPubClient({ SUPABASE_URL: '', SUPABASE_ANON_KEY: key })).toThrow(
      new PubConfigError('環境変数が設定されていません: SUPABASE_URL'),
    );
  });

  it('エラーの文に値を出さない', () => {
    const error = (() => {
      try {
        createPubClient({ SUPABASE_URL: 'not a url', SUPABASE_ANON_KEY: key });
        return undefined;
      } catch (caught) {
        return caught;
      }
    })();
    expect(error).toBeInstanceOf(PubConfigError);
    expect((error as Error).message).not.toContain('not a url');
    expect((error as Error).message).not.toContain(key);
  });

  it('両方あれば、クライアントを作る', () => {
    const client = createPubClient({ SUPABASE_URL: url, SUPABASE_ANON_KEY: key });
    expect(typeof client.from).toBe('function');
  });
});
