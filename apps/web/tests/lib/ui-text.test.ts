import { describe, expect, it } from 'vitest';

import { uiText } from '@/lib/ui-text';

// 画面に出す文言で使わない語（NFR-97）。S-05 の禁止語に、評価や名指しに読める語を足している。
const AVOIDED_WORDS = [
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

function collectStrings(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (value !== null && typeof value === 'object') {
    return Object.values(value).flatMap((child) => collectStrings(child));
  }
  return [];
}

describe('ui-text', () => {
  const texts = collectStrings(uiText);

  it('文言が 1 つ以上ある', () => {
    expect(texts.length).toBeGreaterThan(0);
  });

  it.each(AVOIDED_WORDS)('「%s」を含まない', (word) => {
    expect(texts.filter((text) => text.includes(word))).toEqual([]);
  });
});
