import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { BandDot } from '@/components/charts';
import type { BandDotProps } from '@/components/charts';
import type { Band } from '@/lib/page-data';
import { t } from '@/lib/ui-text';

import { expectChartBasics, parts } from './helpers';

const FIXED_CX = ['12.5%', '50%', '87.5%'];
const CASES: { band: Band; cx: string; label: string }[] = [
  { band: 'lower', cx: '12.5%', label: 'これから' },
  { band: 'middle', cx: '50%', label: '多くの記事と同じくらい' },
  { band: 'upper', cx: '87.5%', label: 'よく読まれています' },
];

describe('BandDot（U-24）', () => {
  it('入力は band（3 値か null）と表示の形だけで、数値を渡す口がない', () => {
    // 型の検査: props のキーは band と variant だけ。
    const keys: Record<keyof BandDotProps, true> = { band: true, variant: true };
    expect(Object.keys(keys)).toEqual(['band', 'variant']);
    // @ts-expect-error band に数値は渡せない。
    const invalid: BandDotProps = { band: 0.42 };
    expect(invalid).toBeDefined();
  });

  it.each(CASES)('$band: 点は固定位置 $cx にあり、区分の文言を書く', ({ band, cx, label }) => {
    const { container } = render(<BandDot band={band} />);
    const dots = parts(container, 'dot');
    expect(dots).toHaveLength(1);
    expect(dots[0]?.getAttribute('cx')).toBe(cx);
    expect(FIXED_CX).toContain(dots[0]?.getAttribute('cx'));
    expect(t(`band.${band}`)).toBe(label);
    expect(screen.getByText(label, { selector: 'span' })).toBeDefined();
  });

  it('帯は 1 色の 1 本で、境界の罫線は 25% と 75% の 2 本', () => {
    const { container } = render(<BandDot band="middle" />);
    expect(container.querySelectorAll('rect')).toHaveLength(1);
    const rules = parts(container, 'rule').map((rule) => rule.getAttribute('x1'));
    expect(rules).toEqual(['25%', '75%']);
  });

  it('null のときは帯を描かず「まだ比較できません」と書く', () => {
    const { container } = render(<BandDot band={null} />);
    expect(container.querySelector('svg')).toBeNull();
    expect(container.textContent).toBe('まだ比較できません');
  });

  it('文言だけの形（スマホの表のセル用）は図を描かない', () => {
    const { container } = render(<BandDot band="upper" variant="text" />);
    expect(container.querySelector('svg')).toBeNull();
    expect(container.textContent).toBe('よく読まれています');
  });

  it('style 属性がなく、role="img" と <title> がある', () => {
    expectChartBasics(<BandDot band="lower" />, 'これから');
  });
});
