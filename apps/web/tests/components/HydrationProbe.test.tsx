import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { HydrationProbe } from '@/components/HydrationProbe';
import { uiText } from '@/lib/ui-text';

describe('HydrationProbe', () => {
  it('ボタンを押すと表示が切り替わる', () => {
    render(<HydrationProbe />);
    const state = screen.getByRole('status');
    expect(state.textContent).toBe(uiText.scaffold.probeIdle);

    fireEvent.click(screen.getByRole('button'));
    expect(state.textContent).toBe(uiText.scaffold.probeToggled);
  });

  it('style 属性を出さない（CSP style-src self）', () => {
    const { container } = render(<HydrationProbe />);
    expect(container.querySelectorAll('[style]')).toHaveLength(0);
  });
});
