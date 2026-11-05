/**
 * S-02（記事一覧の 5 画面）のテストの道具。
 */
import { expect } from 'vitest';

import { buildArticleList } from '@/data/pages';
import type { ArticleListData, ArticleListKind } from '@/lib/page-data';

import { PERIODS } from '../../components/fixtures';
import { BUILT_AT, makeCache } from '../../data/fixture';

/** 画面に出す文言で使わない語（05 §2.1、README）。 */
export const AVOIDED_WORDS = [
  '偏り',
  '下位',
  '読まれなかった',
  '少ない',
  '悪い',
  '低い',
  'ランキング',
  '順位',
  'ワースト',
  'ベスト',
  'あなた',
];

/** 組み立て層のフィクスチャから作った、画面のデータ。 */
export function listData(kind: ArticleListKind): ArticleListData {
  return buildArticleList(makeCache(), kind, BUILT_AT);
}

/** 手で作る画面のデータ。期間は tests/components/fixtures.ts の PERIODS（基準日 2026-11-02）。 */
export function makeListData(overrides: Partial<ArticleListData> = {}): ArticleListData {
  return {
    meta: {
      baseDate: '2026-11-02',
      finishedAt: '2026-11-03T04:00:00+09:00',
      maskThreshold: 5,
      isStale: false,
      measureStart: '2025-10-08',
      builtAt: '2026-11-03T05:00:00+09:00',
    },
    periods: PERIODS,
    posts: [],
    categories: [],
    authors: [],
    benchmark: null,
    ...overrides,
  };
}

/** URL を置き換える（描画の前に呼ぶ）。 */
export function setUrl(url: string): void {
  window.history.replaceState(null, '', url);
}

/** 列の見出し。 */
export function headers(container: HTMLElement): string[] {
  return [...container.querySelectorAll('thead th')].map((cell) => cell.textContent ?? '');
}

/** 記事の行（「詳しく」の行を除く）のタイトル。表の上から順。 */
export function rowTitles(container: HTMLElement): string[] {
  return [...container.querySelectorAll('tbody th[scope="row"]')].map(
    (cell) => cell.querySelector('a')?.textContent ?? '',
  );
}

/** タイトルで行を選び、見出しで列を選んで、そのセルの文字を返す。 */
export function cellText(container: HTMLElement, title: string, header: string): string {
  const index = headers(container).indexOf(header);
  const row = [...container.querySelectorAll('tbody tr')].find(
    (item) => item.querySelector('th[scope="row"] a')?.textContent === title,
  );
  if (index < 0 || row === undefined) throw new Error(`セルがありません: ${title} / ${header}`);
  return row.children[index]?.textContent ?? '';
}

/** 連番の列がなく、行の先頭のセル（タイトル）が数字と区切りで始まらない（NFR-36）。 */
export function expectNoNumbering(container: HTMLElement): void {
  const heads = headers(container);
  expect(heads[0]).toBe('記事');
  expect(heads.filter((text) => /^(#|No\.?|番号|順|位)$/i.test(text.trim()))).toEqual([]);
  const rows = [...container.querySelectorAll('tbody tr')];
  expect(rows.length).toBeGreaterThan(0);
  for (const row of rows) {
    expect(row.firstElementChild?.textContent ?? '').not.toMatch(/^\s*\d+\s*[.．。、,:：)）位]/);
  }
  // 記事の行の先頭のセルは、タイトルの見出しセル。
  for (const row of rows.filter((item) => item.querySelector('th[scope="row"]') !== null)) {
    expect(row.firstElementChild?.getAttribute('scope')).toBe('row');
  }
}
