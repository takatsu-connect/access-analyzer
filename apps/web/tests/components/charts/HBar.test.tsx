import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { HBar, MiniBar } from '@/components/charts';
import type { HBarItem, HBarProps } from '@/components/charts';

import { expectChartBasics, parts } from './helpers';

const TITLE = '読者はどこから来たか';
const ITEMS: HBarItem[] = [
  { key: 'search', label: '検索', value: 1218 },
  { key: 'social', label: 'SNS', value: 580 },
  { key: 'direct', label: '直接', value: null },
  { key: 'referral', label: '他のサイトから', value: 0 },
  { key: 'other', label: 'その他', value: 102 },
];
const valueWithShare = (count: string, share: string): string => `${count}（${share}）`;

function props(overrides: Partial<HBarProps> = {}): HBarProps {
  return { title: TITLE, items: ITEMS, total: 2900, valueWithShare, ...overrides };
}

function row(container: HTMLElement, key: string): Element {
  const group = container.querySelector(`g[data-key="${key}"]`);
  if (!group) throw new Error(`区分 ${key} の行がありません。`);
  return group;
}

function textOf(group: Element, part: string): string {
  return group.querySelector(`[data-part="${part}"]`)?.textContent ?? '';
}

describe('HBar（U-24）', () => {
  it('横棒 1 本 = 1 区分で、右に「数（%）」を書く。分母は合計の列', () => {
    const { container } = render(<HBar {...props()} />);
    expect(container.querySelectorAll('g[data-key]')).toHaveLength(5);
    const search = row(container, 'search');
    expect(textOf(search, 'value')).toBe('1,218（42%）');
    expect(search.querySelector('[data-part="bar"]')?.getAttribute('width')).toBe('42%');
    expect(textOf(row(container, 'social'), 'value')).toBe('580（20%）');
  });

  it('伏せ値の区分は棒を描かず、「—」と「伏せ値」を書く', () => {
    const { container } = render(<HBar {...props()} />);
    const direct = row(container, 'direct');
    expect(direct.querySelectorAll('rect')).toHaveLength(0);
    expect(direct.querySelector('[data-part="value"]')).toBeNull();
    const masked = direct.querySelector('[data-part="masked"]');
    expect([...(masked?.querySelectorAll('tspan') ?? [])].map((node) => node.textContent)).toEqual([
      '—',
      '伏せ値',
    ]);
    // 棒は、伏せ値でない 4 区分の分だけ。
    expect(parts(container, 'bar')).toHaveLength(4);
  });

  it('0 は 0 として出る（長さ 0 の棒と「0（0%）」）', () => {
    const { container } = render(<HBar {...props()} />);
    const referral = row(container, 'referral');
    expect(textOf(referral, 'value')).toBe('0（0%）');
    expect(referral.querySelector('[data-part="bar"]')?.getAttribute('width')).toBe('0%');
    expect(referral.querySelector('[data-part="masked"]')).toBeNull();
  });

  it('合計が 20 未満のときは比率を出さず、数だけを書く', () => {
    const items: HBarItem[] = [
      { key: 'search', label: '検索', value: 12 },
      { key: 'social', label: 'SNS', value: 7 },
      { key: 'direct', label: '直接', value: 0 },
    ];
    const { container } = render(<HBar {...props({ items, total: 19 })} />);
    expect(container.textContent).not.toContain('%');
    expect(textOf(row(container, 'search'), 'value')).toBe('12');
    expect(textOf(row(container, 'direct'), 'value')).toBe('0');
    expect(parts(container, 'bar')).toHaveLength(0);

    // 20 ちょうどなら出る。
    const atThreshold = render(<HBar {...props({ items, total: 20 })} />);
    expect(textOf(row(atThreshold.container, 'search'), 'value')).toBe('12（60%）');
  });

  it('合計が伏せ値のときも比率を出さない', () => {
    const { container } = render(<HBar {...props({ total: null })} />);
    expect(container.textContent).not.toContain('%');
    expect(parts(container, 'bar')).toHaveLength(0);
  });

  it('比較相手の構成比を細い輪郭で重ね、凡例と添え書きを出す', () => {
    const compare = {
      shares: [0.61, 0.1, 0.05, null, 0.03],
      legend: '細い枠: 前の期間',
      text: (share: string): string => `前: ${share}`,
    };
    const { container } = render(<HBar {...props({ compare })} />);
    const search = row(container, 'search');
    const outline = search.querySelector('[data-part="compare"]');
    expect(outline?.getAttribute('width')).toBe('61%');
    expect(outline?.getAttribute('class')).not.toBe(
      search.querySelector('[data-part="bar"]')?.getAttribute('class'),
    );
    expect(textOf(search, 'compare-text')).toBe('前: 61%');
    // 伏せ値の区分と、比較相手の値がない区分には重ねない。
    expect(row(container, 'direct').querySelector('[data-part="compare"]')).toBeNull();
    expect(row(container, 'referral').querySelector('[data-part="compare"]')).toBeNull();
    expect(parts(container, 'compare')).toHaveLength(3);
    expect(container.querySelector('p')?.textContent).toBe('細い枠: 前の期間');
  });

  it('比較相手を渡さなければ、輪郭も凡例も出ない', () => {
    const { container } = render(<HBar {...props()} />);
    expect(parts(container, 'compare')).toHaveLength(0);
    expect(container.querySelector('p')).toBeNull();
  });

  it('style 属性がなく、role="img" と <title> がある', () => {
    expectChartBasics(<HBar {...props()} />, TITLE);
  });
});

describe('MiniBar（表の行に埋める棒）', () => {
  it('値 ÷ 最大値の長さで描く。0 は長さ 0', () => {
    const half = render(<MiniBar title="グルメ: 160" value={160} max={320} />);
    expect(parts(half.container, 'bar')[0]?.getAttribute('width')).toBe('50%');
    const zero = render(<MiniBar title="秋: 0" value={0} max={320} />);
    expect(parts(zero.container, 'bar')[0]?.getAttribute('width')).toBe('0%');
    const noMax = render(<MiniBar title="秋: 0" value={0} max={0} />);
    expect(parts(noMax.container, 'bar')[0]?.getAttribute('width')).toBe('0%');
  });

  it('伏せ値は何も描かない', () => {
    const { container } = render(<MiniBar title="秋" value={null} max={320} />);
    expect(container.firstChild).toBeNull();
  });

  it('style 属性がなく、role="img" と <title> がある', () => {
    expectChartBasics(<MiniBar title="グルメ: 160" value={160} max={320} />, 'グルメ: 160');
  });
});
