import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { CommonNotesView } from '@/components/CommonNotes';
import { NOTE_ROUTES, notesFor } from '@/lib/common-notes';
import type { NoteId } from '@/lib/common-notes';
import { SiteFooter } from '@/components/SiteFooter';
import { SiteHeaderView, centerCurrentTab } from '@/components/SiteHeader';
import { SkipLink } from '@/components/SkipLink';

// 読まれた回数を出す画面のうち、帯と比率もある画面（S-01、S-03、S-05）の 6 項目。
const ALL_NOTES: NoteId[] = notesFor('/');

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
  it('ナビは 全体 / 記事 / イベント記事 / ライター / カテゴリ / シリーズ / 投稿活動（パスは 05 §1）', () => {
    render(<SiteHeaderView pathname="/" />);
    expect(links(mainNav())).toEqual([
      ['全体', '/'],
      ['記事', '/articles/top'],
      ['イベント記事', '/events/top'],
      ['ライター', '/authors'],
      ['カテゴリ', '/categories'],
      ['シリーズ', '/tags'],
      ['投稿活動', '/activity'],
    ]);
  });

  it.each([
    '/',
    '/articles/top',
    '/events/top',
    '/articles/101',
    '/authors/writer-a',
    '/no-such-page',
  ])('%s: 順位・設定・ログイン・反応の項目がない', (pathname) => {
    const { container } = render(<SiteHeaderView pathname={pathname} />);
    const header = container.textContent ?? '';
    for (const word of ['順位', 'ランキング', '設定', 'ログイン', '反応']) {
      expect(header).not.toContain(word);
    }
    expect(container.querySelector('a[href^="/reactions"]')).toBeNull();
  });

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
    expect(screen.queryByRole('navigation', { name: 'イベント記事のページ' })).toBeNull();
    expect(current(mainNav())).toEqual([['ライター', 'true']]);
  });

  it('「イベント記事」の中では、イベント記事のサブナビ（S-10a〜S-10e。タブの名前は短い形）を出す', () => {
    render(<SiteHeaderView pathname="/events/long" />);
    const subNav = screen.getByRole('navigation', { name: 'イベント記事のページ' });
    expect(links(subNav)).toEqual([
      ['よく読まれた', '/events/top'],
      ['新着の立ち上がり', '/events/new'],
      ['長く読まれている', '/events/long'],
      ['最近よく読まれている', '/events/recent'],
      ['探す', '/events'],
    ]);
    expect(current(subNav)).toEqual([['長く読まれている', 'page']]);
    // 「イベント記事」は区分の印だけ（ページの印はサブナビが持つ）。
    expect(current(mainNav())).toEqual([['イベント記事', 'true']]);
    expect(screen.queryByRole('navigation', { name: '記事のページ' })).toBeNull();
  });

  it('主な種類がイベントの記事の詳細では、「イベント記事」に区分の印、サブナビはイベント記事（ページの印なし）', () => {
    render(<SiteHeaderView pathname="/articles/112" eventArticleIds={[112, 205]} />);
    expect(current(mainNav())).toEqual([['イベント記事', 'true']]);
    const subNav = screen.getByRole('navigation', { name: 'イベント記事のページ' });
    expect(current(subNav)).toEqual([]);
    expect(screen.queryByRole('navigation', { name: '記事のページ' })).toBeNull();
  });

  it('一覧にない記事（両方に属する記事、記事だけの記事）と 404 は、いままでどおり', () => {
    const both = render(<SiteHeaderView pathname="/articles/109" eventArticleIds={[112]} />);
    expect(current(both.container)).toEqual([['記事', 'true']]);
    both.unmount();
    // 404 の静的な HTML のパス（useRenderedPathname）では、区分の印を付けない。
    const notFound = render(<SiteHeaderView pathname="/_not-found" eventArticleIds={[112]} />);
    expect(current(notFound.container)).toEqual([]);
    notFound.unmount();
    // 記事詳細の形でないパスは、ID の一覧を見ない。
    render(<SiteHeaderView pathname="/articles/112/x" eventArticleIds={[112]} />);
    expect(current(mainNav())).toEqual([['記事', 'true']]);
  });

  it('/events（探す）では「イベント記事」に区分の印、サブナビの「探す」にページの印', () => {
    render(<SiteHeaderView pathname="/events/" />);
    expect(current(mainNav())).toEqual([['イベント記事', 'true']]);
    const subNav = screen.getByRole('navigation', { name: 'イベント記事のページ' });
    expect(current(subNav)).toEqual([['探す', 'page']]);
  });

  it('横にはみ出したサブナビのタブの列は、選んでいるタブが真ん中に来るよう横に寄せる（レビュー C-1）', () => {
    // jsdom は配置を計算しないので、寸法を持つ偽の要素で確かめる。
    const list = { scrollWidth: 600, clientWidth: 300, scrollLeft: 0 } as unknown as HTMLElement;
    const tab = { offsetLeft: 400, offsetWidth: 100 } as unknown as HTMLElement;
    centerCurrentTab(list, tab);
    expect(list.scrollLeft).toBe(300);
    // 先頭のタブは 0 より左に寄せない。
    centerCurrentTab(list, { offsetLeft: 10, offsetWidth: 100 } as unknown as HTMLElement);
    expect(list.scrollLeft).toBe(0);
  });

  it('はみ出していない（広い画面の）サブナビのタブの列は動かさない', () => {
    const list = { scrollWidth: 300, clientWidth: 300, scrollLeft: 0 } as unknown as HTMLElement;
    centerCurrentTab(list, { offsetLeft: 200, offsetWidth: 100 } as unknown as HTMLElement);
    expect(list.scrollLeft).toBe(0);
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
  it('フッタは名称と、「読まれ方ノートについて」の閉じた折りたたみ', () => {
    const { container } = render(<SiteFooter />);
    expect(container.querySelector('footer')?.textContent).toContain('高津コネクト 読まれ方ノート');
    const details = container.querySelector('details');
    expect(details?.hasAttribute('open')).toBe(false);
    expect(details?.querySelector('summary')?.textContent).toBe('読まれ方ノートについて');
  });

  it('CommonNotes は閉じた折りたたみで、見出し（h2）が summary（レビュー C-6）', () => {
    const { container } = render(<CommonNotesView notes={ALL_NOTES} measureStart="2025-10-08" />);
    const outer = container.querySelector('section > details');
    expect(outer).not.toBeNull();
    expect(outer?.hasAttribute('open')).toBe(false);
    const heading = outer?.querySelector(':scope > summary > h2');
    expect(heading?.textContent).toBe('このページの数字について');
    // 見出しの名前で節を読み上げられる。
    expect(screen.getByRole('region', { name: 'このページの数字について' })).toBeTruthy();
    // 項目は折りたたみの中にある（summary の外）。
    expect(outer?.querySelector(':scope > ul')).not.toBeNull();
  });

  it('CommonNotes は、渡された項目を 05 §2.7 の順に描く（読まれた回数を出す画面の 6 項目）', () => {
    const { container } = render(<CommonNotesView notes={ALL_NOTES} measureStart="2025-10-08" />);
    expect(container.querySelector('h2')?.textContent).toBe('このページの数字について');
    const items = [...container.querySelectorAll('ul > li')].map((item) => item.textContent ?? '');
    expect(items).toHaveLength(6);
    expect(items[0]).toContain('読まれた回数は、ページが表示された回数です');
    expect(items[1]).toContain('読まれた回数は、2025 年 10 月 8 日から数えています。');
    expect(items[2]).toContain('「—（伏せ値）」');
    expect(items[3]).toContain('「多くの記事はこの範囲」');
    expect(items[4]).toContain('比率（%）は');
    expect(items[5]).toContain('Google アナリティクス（GA4）');
    // 「詳しく」は閉じた状態（全体の折りたたみの中に 2 つ）。
    const folds = [...container.querySelectorAll('li details')];
    expect(folds).toHaveLength(2);
    expect(folds.every((fold) => !fold.hasAttribute('open'))).toBe(true);
    expect(folds.map((fold) => fold.querySelector('summary')?.textContent)).toEqual([
      '詳しく',
      '詳しく',
    ]);
  });

  it('CommonNotes は、S-08 では公開本数と比率の 2 項目だけ', () => {
    const { container } = render(<CommonNotesView notes={notesFor('/activity')} />);
    const items = [...container.querySelectorAll('ul > li')].map((item) => item.textContent ?? '');
    expect(items).toEqual([
      '公開本数は、高津コネクトで公開されている記事を数えています。',
      '比率（%）は、元の数が 20 未満のときは出さず、差の数だけを出します。',
    ]);
    expect(container.textContent).not.toContain('読まれた回数');
  });

  it('CommonNotes は、項目が 0 のとき（S-04、404）折りたたみごと出さない', () => {
    const { container } = render(<CommonNotesView notes={notesFor('/authors')} />);
    expect(container.childElementCount).toBe(0);
    expect(container.textContent).toBe('');
  });
});

describe('画面ごとの CommonNotes の項目（src/lib/common-notes.ts。助言 A-2）', () => {
  const PV = ['pageviews', 'measureStart', 'masked', 'source'];
  it.each<[string, string, string[]]>([
    ['S-01', '/', [...PV.slice(0, 3), 'bandAll', 'ratio', 'source']],
    ['S-02a', '/articles/top', PV],
    ['S-02b', '/articles/new', [...PV.slice(0, 3), 'band', 'source']],
    ['S-02c', '/articles/long', PV],
    ['S-02d', '/articles/recent', PV],
    ['S-02e', '/articles', PV],
    ['S-10a', '/events/top', PV],
    ['S-10b', '/events/new', [...PV.slice(0, 3), 'band', 'source']],
    ['S-10c', '/events/long', PV],
    ['S-10d', '/events/recent', PV],
    ['S-10e', '/events', PV],
    ['404（イベント記事の詳細はない）', '/events/101', []],
    ['S-03', '/articles/101', [...PV.slice(0, 3), 'band', 'ratio', 'source']],
    ['S-04', '/authors', []],
    ['S-05', '/authors/author-a', [...PV.slice(0, 3), 'bandAuthor', 'ratio', 'source']],
    ['S-06', '/categories', [...PV.slice(0, 3), 'ratio', 'source']],
    ['S-06b', '/categories/seasonal', [...PV.slice(0, 3), 'ratio', 'source']],
    ['S-07', '/tags', [...PV.slice(0, 3), 'ratio', 'source']],
    ['S-07b', '/tags/51', [...PV.slice(0, 3), 'ratio', 'source']],
    ['S-08', '/activity', ['posting', 'ratio']],
    ['404', '/no-such-page', []],
    ['404（形の違う ID）', '/articles/abc', []],
    ['404（2 段より深い）', '/authors/a/b', []],
  ])('%s（%s）', (_, pathname, expected) => {
    expect(notesFor(pathname)).toEqual(expected);
  });

  it('末尾の / があっても同じ項目', () => {
    expect(notesFor('/activity/')).toEqual(notesFor('/activity'));
  });

  it('S-08 以外に公開本数の項目はなく、読まれた回数を出す画面にはすべて数え方と出どころがある', () => {
    for (const route of NOTE_ROUTES) {
      if (route.screen !== 'S-08') expect(route.notes).not.toContain('posting');
      if (route.notes.includes('pageviews')) {
        expect(route.notes).toEqual(expect.arrayContaining(['measureStart', 'masked', 'source']));
      }
    }
  });
});
