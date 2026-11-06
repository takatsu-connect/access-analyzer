import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Delta } from '@/components/Delta';
import { compare } from '@/lib/derive';

function textOf(current: number, previous: number): string {
  const { container } = render(<Delta comparison={compare(current, previous)} />);
  return container.textContent ?? '';
}

describe('Delta（05 §2.2）', () => {
  it('比率が丸めて 0% で差が 0 でないときは、印を付けず「ほぼ同じ」。読み上げも「減った」と言わない', () => {
    // 10,000 → 9,968: 差 −32、−0.32% → 丸めて 0%。
    const text = textOf(9968, 10000);
    expect(text).toBe('−32（ほぼ同じ）');
    expect(text).not.toContain('▼');
    expect(text).not.toContain('減った');
    expect(text).not.toContain('±0%');
  });

  it('+100% 以上は倍で書く（236 → 1,416 は「+1,180（約 6 倍）」）', () => {
    const text = textOf(1416, 236);
    expect(text).toContain('▲');
    expect(text).toContain('+1,180（約 6 倍）');
    expect(text).not.toContain('%');
  });

  it('倍は小数第 1 位まで、10 倍以上は整数', () => {
    expect(textOf(1416, 220)).toContain('約 6.4 倍');
    expect(textOf(2100, 200)).toContain('約 11 倍');
  });

  it('ふつうの変化は % のまま。−100% 側も % のまま', () => {
    expect(textOf(108, 100)).toBe('▲+8（+8%）増えた');
    expect(textOf(0, 100)).toBe('▼−100（−100%）減った');
  });

  it('差が 0 は「±0」で印なし', () => {
    expect(textOf(100, 100)).toBe('±0（±0%）変わらず');
  });
});
