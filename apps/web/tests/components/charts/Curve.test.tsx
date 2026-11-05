import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Curve } from '@/components/charts';
import type { CurveBenchmark, CurveProps } from '@/components/charts';

import { expectChartBasics, parts, series } from './helpers';

const TITLE = '公開からの読まれ方';
const LABELS = { post: 'この記事', band: '多くの記事はこの範囲', median: '真ん中の記事' };
const dayLabel = (day: number): string => `${day} 日目`;

/** 1 日目から elapsed 日目までが値、その先は null（まだたっていない日）。 */
function cumulativeUntil(elapsed: number, length: number): (number | null)[] {
  return [...Array(length).keys()].map((index) => (index < elapsed ? (index + 1) * 10 : null));
}

function benchmark(length: number): CurveBenchmark {
  const days = [...Array(length).keys()];
  return {
    p25: days.map((index) => (index + 1) * 4),
    p50: days.map((index) => (index + 1) * 8),
    p75: days.map((index) => (index + 1) * 16),
  };
}

function props(overrides: Partial<CurveProps> = {}): CurveProps {
  return {
    title: TITLE,
    cumulative: cumulativeUntil(12, 90),
    benchmark: benchmark(90),
    days: 30,
    labels: LABELS,
    dayLabel,
    ...overrides,
  };
}

/** パスの頂点（M と L）の x 座標。 */
function pathXs(element: Element | null): number[] {
  const d = element?.getAttribute('d') ?? '';
  return [...d.matchAll(/[ML]([\d.]+),([\d.]+)/g)].map((match) => Number(match[1]));
}

describe('Curve（U-24）', () => {
  it('この記事の線は、たった日までで終わる（null の先は線がない）', () => {
    const { container } = render(<Curve {...props()} />);
    const xs = pathXs(series(container, 'post'));
    expect(xs).toHaveLength(12);
    // 12 日目の位置で終わり、帯はその先（30 日目）まで続く。
    const bandXs = pathXs(series(container, 'band'));
    expect(Math.max(...xs)).toBeLessThan(Math.max(...bandXs));
    // 線の終わりに点がある。
    const dot = parts(container, 'post-dot')[0];
    expect(dot?.getAttribute('cx')).toBe(`${Math.max(...xs)}%`);
  });

  it('帯は面、真ん中は点線、この記事は実線で、クラスが別', () => {
    const { container } = render(<Curve {...props()} />);
    const band = series(container, 'band');
    const median = series(container, 'median');
    const post = series(container, 'post');
    expect(band?.getAttribute('d')).toMatch(/Z$/);
    expect(median?.getAttribute('stroke-dasharray')).toBe('4 3');
    expect(post?.hasAttribute('stroke-dasharray')).toBe(false);
    expect(new Set([band, median, post].map((node) => node?.getAttribute('class'))).size).toBe(3);
    expect(container.textContent).toContain('多くの記事はこの範囲');
    expect(container.textContent).toContain('真ん中の記事');
  });

  it('帯がなければ面も点線もなく、記事の線だけを描く', () => {
    for (const none of [null, undefined]) {
      const { container, unmount } = render(<Curve {...props({ benchmark: none })} />);
      expect(series(container, 'band')).toBeNull();
      expect(series(container, 'median')).toBeNull();
      expect(series(container, 'post')).not.toBeNull();
      expect(container.textContent).not.toContain('多くの記事はこの範囲');
      expect(container.textContent).toContain('この記事');
      unmount();
    }
  });

  it('帯の欠けた日（null）では面を切る', () => {
    const withGap = benchmark(30);
    const p25 = withGap.p25.map((value, index) => (index === 10 ? null : value));
    const { container } = render(<Curve {...props({ benchmark: { ...withGap, p25 } })} />);
    const d = series(container, 'band')?.getAttribute('d') ?? '';
    expect(d.match(/M/g)).toHaveLength(2);
  });

  it('横軸は 30 日か 90 日で、縦軸は 0 始まり', () => {
    const short = render(<Curve {...props()} />);
    expect(parts(short.container, 'x-tick').map((tick) => tick.textContent)).toEqual([
      '1 日目',
      '10 日目',
      '20 日目',
      '30 日目',
    ]);
    expect(parts(short.container, 'y-tick')[0]?.textContent).toBe('0');
    short.unmount();

    const long = render(<Curve {...props({ days: 90, cumulative: cumulativeUntil(44, 90) })} />);
    expect(parts(long.container, 'x-tick').map((tick) => tick.textContent)).toEqual([
      '1 日目',
      '30 日目',
      '60 日目',
      '90 日目',
    ]);
    expect(pathXs(series(long.container, 'post'))).toHaveLength(44);
  });

  it('1 日目だけでも、値が全部 0 でも落ちない', () => {
    const { container } = render(
      <Curve {...props({ cumulative: [0, null, null], benchmark: null })} />,
    );
    expect(parts(container, 'post-dot')).toHaveLength(1);
    expect(parts(container, 'y-tick')[0]?.textContent).toBe('0');
  });

  it('描く値がなければ何も描かない（計測を始める前に公開した記事）', () => {
    const { container } = render(<Curve {...props({ cumulative: [], benchmark: null })} />);
    expect(container.firstChild).toBeNull();
  });

  it('style 属性がなく、role="img" と <title> がある', () => {
    expectChartBasics(<Curve {...props()} />, TITLE);
  });
});
