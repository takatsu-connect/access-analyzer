import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { ExternalLink } from '@/components/ExternalLink';
import { ArticleLink, AuthorLink } from '@/components/SiteLinks';

const LABEL = '記事';
const TITLE = '題名';
const AUTHOR = '高津 花子';

describe('ExternalLink（U-26）', () => {
  it('https://takatsu-connect.com/ の配下はリンクになる（新しいタブ、rel は noopener）', () => {
    const { container } = render(
      <ExternalLink href="https://takatsu-connect.com/archives/101">{LABEL}</ExternalLink>,
    );
    const anchor = container.querySelector('a');
    expect(anchor?.getAttribute('href')).toBe('https://takatsu-connect.com/archives/101');
    expect(anchor?.getAttribute('target')).toBe('_blank');
    expect(anchor?.getAttribute('rel')).toBe('noopener');
    expect(anchor?.textContent).toBe(LABEL);
  });

  it.each([
    ['別のドメイン', 'https://example.com/archives/101'],
    ['javascript: の URL', 'javascript:alert(1)'],
    ['相対パス', '/archives/101'],
    ['先頭だけ似せたドメイン', 'https://takatsu-connect.com.evil.example/'],
    ['http', 'http://takatsu-connect.com/archives/101'],
    ['ユーザー名つき', 'https://takatsu-connect.com@evil.example/'],
    ['空の文字列', ''],
    ['null', null],
    ['undefined', undefined],
  ])('%s はリンクにせず、中身だけを描く', (_name, href) => {
    const { container } = render(<ExternalLink href={href}>{LABEL}</ExternalLink>);
    expect(container.querySelector('a')).toBeNull();
    expect(container.textContent).toBe(LABEL);
  });
});

describe('サイト内リンク', () => {
  it('記事は /articles/[postId] へのリンク', () => {
    const { container } = render(<ArticleLink postId={101}>{TITLE}</ArticleLink>);
    expect(container.querySelector('a')?.getAttribute('href')).toBe('/articles/101');
  });

  it('記事の ID が正の整数でなければリンクにしない', () => {
    const { container } = render(<ArticleLink postId={Number.NaN}>{TITLE}</ArticleLink>);
    expect(container.querySelector('a')).toBeNull();
    expect(container.textContent).toBe(TITLE);
  });

  it('著者の slug は href にだけ使う', () => {
    const { container } = render(<AuthorLink slug="writer-a">{AUTHOR}</AuthorLink>);
    expect(container.querySelector('a')?.getAttribute('href')).toBe('/authors/writer-a');
    expect(container.textContent).toBe(AUTHOR);
  });

  it('slug が null の著者は、名前だけを描く', () => {
    const { container } = render(<AuthorLink slug={null}>{AUTHOR}</AuthorLink>);
    expect(container.querySelector('a')).toBeNull();
    expect(container.textContent).toBe(AUTHOR);
  });
});
