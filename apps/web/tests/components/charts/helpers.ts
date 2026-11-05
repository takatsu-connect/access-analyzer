import { render } from '@testing-library/react';
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect } from 'vitest';

/**
 * すべての図に共通の検査（U-24、ADR 0008）。
 * - サーバー側で HTML に描ける（window を読まない）。その HTML に style= 属性がない
 *   （CSP の style-src 'self'）。
 * - role="img" の SVG があり、<title> を持つ。
 * - 数字の前に連番がない（順位の数字を描かない。番号つきの箇条書きも使わない）。
 */
export function expectChartBasics(element: ReactElement, title: string): void {
  const html = renderToStaticMarkup(element);
  expect(html).not.toMatch(/\sstyle=/);
  expect(html).toContain('role="img"');

  const { container, unmount } = render(element);
  expect(container.querySelectorAll('[style]')).toHaveLength(0);

  const image = container.querySelector('svg[role="img"]');
  expect(image).not.toBeNull();
  expect(image?.querySelector('title')?.textContent).toBe(title);

  expect(container.querySelector('ol')).toBeNull();
  const texts = [...container.querySelectorAll('li, p, span, text, tspan')].map(
    (node) => node.textContent ?? '',
  );
  for (const text of texts) {
    // 「1. 」「2）」「3 位」のような連番や順位で始まらない。
    expect(text).not.toMatch(/^\s*\d+\s*(?:[.．)）、]\s|位)/);
  }
  unmount();
}

/** data-part で部品の中の要素を集める。 */
export function parts(container: HTMLElement, name: string): Element[] {
  return [...container.querySelectorAll(`[data-part="${name}"]`)];
}

/** data-series で線や面を取る。 */
export function series(container: HTMLElement, name: string): Element | null {
  return container.querySelector(`[data-series="${name}"]`);
}
