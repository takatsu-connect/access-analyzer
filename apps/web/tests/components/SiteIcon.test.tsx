import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { SiteFooter } from '@/components/SiteFooter';
import { SiteHeaderView } from '@/components/SiteHeader';
import { SiteIcon } from '@/components/SiteIcon';
import { t } from '@/lib/ui-text';

/** SVG の中の図形を、要素名と属性（名前の順）の文字列の並びにする。 */
function shapesOf(svg: Element): string[] {
  return [...svg.children].map((node) => {
    const attrs = [...node.attributes]
      .map((attr) => `${attr.name}=${attr.value}`)
      .sort()
      .join(' ');
    return `${node.tagName.toLowerCase()} ${attrs}`;
  });
}

describe('SiteIcon', () => {
  it('タブ用の src/app/icon.svg と同じ図形を描く', () => {
    const file = readFileSync(resolve(__dirname, '../../src/app/icon.svg'), 'utf-8');
    const fromFile = new DOMParser().parseFromString(file, 'image/svg+xml').documentElement;
    const { container } = render(<SiteIcon size="header" />);
    const drawn = container.querySelector('svg');
    if (drawn === null) throw new Error('SVG がありません。');
    expect(drawn.getAttribute('viewBox')).toBe(fromFile.getAttribute('viewBox'));
    expect(shapesOf(drawn)).toEqual(shapesOf(fromFile));
  });

  it('飾りなので読み上げない', () => {
    const { container } = render(<SiteIcon size="footer" />);
    const svg = container.querySelector('svg');
    expect(svg?.getAttribute('aria-hidden')).toBe('true');
    expect(svg?.getAttribute('focusable')).toBe('false');
  });

  it('ヘッダの題名とフッタの名称の前に、アイコンが 1 つずつある。リンクの名前は名称のまま', () => {
    const header = render(<SiteHeaderView pathname="/" />);
    const link = header.getByRole('link', { name: t('site.title') });
    expect(link.querySelectorAll('[data-part="site-icon"]')).toHaveLength(1);
    expect(link.firstElementChild?.getAttribute('data-part')).toBe('site-icon');
    header.unmount();

    const footer = render(<SiteFooter />);
    const title = footer.container.querySelector('footer p');
    expect(title?.querySelectorAll('[data-part="site-icon"]')).toHaveLength(1);
    expect(title?.textContent).toBe(t('site.title'));
  });
});
