/**
 * S-06〜S-08 の画面のテストが使う道具。
 */
import { expect } from 'vitest';

/** 画面に出さない語（apps/web/README.md「使わない語」）。 */
const BANNED_WORDS = [
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

/** URL のクエリを差し替える（'?p=last7' など。空の文字列でクエリなし）。描画の前に呼ぶ。 */
export function setQuery(search: string): void {
  window.history.replaceState(null, '', `${window.location.pathname}${search}`);
}

/** 全画面に共通の決まり: style 属性がない、使わない語がない、順位の数字（連番）がない。 */
export function expectCommonRules(container: HTMLElement): void {
  // 出力のどの要素にも style 属性がない（CSP。ADR 0010）。
  expect(container.querySelector('[style]')).toBeNull();

  const text = container.textContent ?? '';
  for (const word of BANNED_WORDS) expect(text).not.toContain(word);
  expect(text).not.toContain('出ません');

  // 番号つきのリストがなく、表の行の先頭のセルが数だけになっていない。
  expect(container.querySelector('ol')).toBeNull();
  for (const row of container.querySelectorAll('tbody tr')) {
    const first = row.firstElementChild?.textContent?.trim() ?? '';
    expect(first).not.toMatch(/^[0-9０-９]+[.．位]?$/);
  }
}

/** 並べ替えの UI がない（「並び」の枠、「多い順」のボタン、見出しのボタン、aria-sort）。 */
export function expectNoSortUi(container: HTMLElement): void {
  expect(container.querySelector('[aria-label="並び"]')).toBeNull();
  expect(container.querySelector('[aria-sort]')).toBeNull();
  expect(container.querySelector('th button')).toBeNull();
  for (const button of container.querySelectorAll('button')) {
    expect(button.textContent ?? '').not.toMatch(/順/);
  }
}
