import { render } from '@testing-library/react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { Delta } from '@/components/Delta';
import { MaskedCell } from '@/components/MaskedCell';
import { compare } from '@/lib/derive';

describe('MaskedCell（U-24）', () => {
  it('null は「—」（U+2014）と、同じ要素の中の小さな「伏せ値」', () => {
    const { container } = render(<MaskedCell value={null} />);
    const mark = container.querySelector('span.masked');
    expect(mark).not.toBeNull();
    expect(mark?.firstChild?.textContent).toBe('—');
    expect(mark?.querySelector('small')?.textContent).toBe('伏せ値');
    expect(mark?.textContent).toBe('—伏せ値');
  });

  it('一次と二次の区別がない（入力が同じなので、出力も同じ）', () => {
    // props は value（と className）だけで、伏せ値の種類を渡す口がない。
    const first = renderToStaticMarkup(<MaskedCell value={null} />);
    const second = renderToStaticMarkup(<MaskedCell value={null} />);
    expect(first).toBe(second);
    expect(first).toContain('—<small');
  });

  it('0 は「0」と出す（伏せ値にしない）', () => {
    const { container } = render(<MaskedCell value={0} />);
    expect(container.textContent).toBe('0');
    expect(container.querySelector('.masked')).toBeNull();
  });

  it('数は 3 桁区切り', () => {
    const { container } = render(<MaskedCell value={4210} />);
    expect(container.textContent).toBe('4,210');
  });
});

describe('Delta', () => {
  it('分母が 20 以上なら、差と比率を出す。増えた向きは ▲ と符号と言葉で伝える', () => {
    const { container } = render(<Delta comparison={compare(4210, 3890)} />);
    expect(container.textContent).toBe('▲+320（+8%）増えた');
  });

  it('分母が 20 未満なら、差の数だけ（% を出さない）', () => {
    const { container } = render(<Delta comparison={compare(12, 6)} />);
    expect(container.textContent).toBe('▲+6増えた');
    expect(container.textContent).not.toContain('%');
  });

  it('減った向きは ▼ と U+2212 の符号', () => {
    const { container } = render(<Delta comparison={compare(36, 40)} />);
    expect(container.textContent).toBe('▼−4（−10%）減った');
  });

  it('変わらないときは矢印なし', () => {
    const { container } = render(<Delta comparison={compare(40, 40)} />);
    expect(container.textContent).toBe('±0（±0%）変わらず');
  });

  it('伏せ値との比較は「—」（差も出さない）', () => {
    const { container } = render(<Delta comparison={compare(null, 40)} />);
    expect(container.querySelector('.masked')?.textContent).toBe('—伏せ値');
  });

  it('矢印に色のクラスを分けない（増減で同じクラス）', () => {
    const up = render(<Delta comparison={compare(50, 40)} />).container;
    const down = render(<Delta comparison={compare(30, 40)} />).container;
    const arrowClass = (root: HTMLElement) =>
      root.querySelector('[aria-hidden="true"]')?.getAttribute('class');
    expect(arrowClass(up)).toBe(arrowClass(down));
  });
});
