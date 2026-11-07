import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { CommonNotes } from '@/components/CommonNotes';
import { SiteFooter } from '@/components/SiteFooter';
import { SiteHeaderView } from '@/components/SiteHeader';
import { SkipLink } from '@/components/SkipLink';

const mainNav = (): HTMLElement => screen.getByRole('navigation', { name: 'ページの移動' });
const links = (root: HTMLElement): [string | null, string | null][] =>
  within(root)
    .getAllByRole('link')
    .map((link) => [link.textContent, link.getAttribute('href')]);
const current = (root: HTMLElement): [string | null, string | null][] =>
  within(root)
    .getAllByRole('link')
    .filter((link) => link.hasAttribute('aria-current'))
    .map((link) => [link.textContent, link.getAttribute('aria-current')]);

describe('SiteHeader', () => {
  it('ナビは 全体 / 記事 / ライター / カテゴリ / シリーズ / 投稿活動（パスは 05 §1）', () => {
    render(<SiteHeaderView pathname="/" />);
    expect(links(mainNav())).toEqual([
      ['全体', '/'],
      ['記事', '/articles/top'],
      ['ライター', '/authors'],
      ['カテゴリ', '/categories'],
      ['シリーズ', '/tags'],
      ['投稿活動', '/activity'],
    ]);
  });

  it.each(['/', '/articles/top', '/articles/101', '/authors/writer-a', '/no-such-page'])(
    '%s: 順位・設定・ログイン・反応の項目がない',
    (pathname) => {
      const { container } = render(<SiteHeaderView pathname={pathname} />);
      const header = container.textContent ?? '';
      for (const word of ['順位', 'ランキング', '設定', 'ログイン', '反応']) {
        expect(header).not.toContain(word);
      }
      expect(container.querySelector('a[href^="/reactions"]')).toBeNull();
    },
  );

  it('現在のページの印は aria-current', () => {
    render(<SiteHeaderView pathname="/" />);
    expect(current(mainNav())).toEqual([['全体', 'page']]);
  });

  it('「記事」の中では、サブナビ（S-02a〜S-02e）を出す', () => {
    render(<SiteHeaderView pathname="/articles/new" />);
    const subNav = screen.getByRole('navigation', { name: '記事のページ' });
    expect(links(subNav)).toEqual([
      ['よく読まれた記事', '/articles/top'],
      ['新着記事の立ち上がり', '/articles/new'],
      ['長く読まれている記事', '/articles/long'],
      ['最近よく読まれている記事', '/articles/recent'],
      ['記事を探す', '/articles'],
    ]);
    expect(current(subNav)).toEqual([['新着記事の立ち上がり', 'page']]);
    expect(current(mainNav())).toEqual([['記事', 'true']]);
  });

  it('記事詳細では「記事」に区分の印だけが付く。ほかの区分ではサブナビを出さない', () => {
    const detail = render(<SiteHeaderView pathname="/articles/101" />);
    expect(current(detail.container)).toEqual([['記事', 'true']]);
    detail.unmount();

    render(<SiteHeaderView pathname="/authors/writer-a/" />);
    expect(screen.queryByRole('navigation', { name: '記事のページ' })).toBeNull();
    expect(current(mainNav())).toEqual([['ライター', 'true']]);
  });
});

describe('SkipLink', () => {
  it('本文へのページ内リンク。押すと、行き先にフォーカスが移る', () => {
    render(
      <>
        <SkipLink targetId="main" />
        <main id="main" tabIndex={-1} />
      </>,
    );
    const link = screen.getByRole('link', { name: '本文へ移動' });
    expect(link.getAttribute('href')).toBe('#main');
    fireEvent.click(link);
    expect(document.activeElement?.id).toBe('main');
  });
});

describe('SiteFooter と CommonNotes', () => {
  it('フッタは名称と、「この BI について」の閉じた折りたたみ', () => {
    const { container } = render(<SiteFooter />);
    expect(container.querySelector('footer')?.textContent).toContain('高津コネクト アクセス BI');
    const details = container.querySelector('details');
    expect(details?.hasAttribute('open')).toBe(false);
    expect(details?.querySelector('summary')?.textContent).toBe('この BI について');
  });

  it('CommonNotes は 05 §2.7 の行を、折りたたまずに出す', () => {
    const { container } = render(<CommonNotes measureStart="2025-10-08" />);
    expect(container.querySelector('h2')?.textContent).toBe('このページの数字について');
    const items = [...container.querySelectorAll('ul > li')].map((item) => item.textContent ?? '');
    expect(items).toHaveLength(6);
    expect(items[0]).toContain('読まれた回数は、ページが表示された回数です');
    expect(items[1]).toContain('読まれた回数は、2025 年 10 月 8 日から数えています。');
    expect(items[2]).toContain('「—（伏せ値）」');
    expect(items[3]).toContain('「多くの記事はこの範囲」');
    expect(items[4]).toContain('比率（%）は');
    expect(items[5]).toContain('Google アナリティクス（GA4）');
    // 「詳しく」は閉じた状態。
    const folds = [...container.querySelectorAll('details')];
    expect(folds).toHaveLength(2);
    expect(folds.every((fold) => !fold.hasAttribute('open'))).toBe(true);
    expect(folds.map((fold) => fold.querySelector('summary')?.textContent)).toEqual([
      '詳しく',
      '詳しく',
    ]);
  });
});
