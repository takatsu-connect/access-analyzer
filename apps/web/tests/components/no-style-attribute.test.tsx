import { render } from '@testing-library/react';
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ArticleTable } from '@/components/ArticleTable';
import { CommonNotes } from '@/components/CommonNotes';
import { DataStatus } from '@/components/DataStatus';
import { Delta } from '@/components/Delta';
import { Details } from '@/components/Details';
import { ExternalLink } from '@/components/ExternalLink';
import { KpiCard, KpiGrid } from '@/components/KpiCard';
import { MaskedCell } from '@/components/MaskedCell';
import { Badge, Notice, StateMessage } from '@/components/Notice';
import { PeriodPicker } from '@/components/PeriodPicker';
import { ResponsiveDetails } from '@/components/ResponsiveDetails';
import { SiteFooter } from '@/components/SiteFooter';
import { SiteHeaderView } from '@/components/SiteHeader';
import { ArticleLink, AuthorLink } from '@/components/SiteLinks';
import { SkipLink } from '@/components/SkipLink';
import { compare } from '@/lib/derive';

import { makePost, PERIODS } from './fixtures';

const META = { baseDate: '2026-11-02', finishedAt: '2026-11-04T18:05:00+09:00', isStale: true };
const BODY = '中身';
const NOTE = '注記';
const NEW = '新着';
const LABEL = '記事';
const AUTHOR = '高津 花子';

const CASES: [string, ReactElement][] = [
  ['SiteHeader', <SiteHeaderView key="header" pathname="/articles/top" />],
  ['SiteFooter', <SiteFooter key="footer" />],
  ['SkipLink', <SkipLink key="skip" targetId="main" />],
  ['DataStatus', <DataStatus key="status" meta={META} />],
  ['CommonNotes', <CommonNotes key="notes" />],
  [
    'PeriodPicker',
    <PeriodPicker key="picker" periods={PERIODS} value="m2026-10" onChange={() => undefined} />,
  ],
  ['MaskedCell（伏せ値）', <MaskedCell key="masked" value={null} />],
  ['MaskedCell（数）', <MaskedCell key="number" value={1234} />],
  ['Delta', <Delta key="delta" comparison={compare(120, 100)} />],
  ['Delta（伏せ値）', <Delta key="delta-masked" comparison={null} />],
  [
    'KpiCard',
    <KpiGrid key="kpi">
      <KpiCard
        label="読まれた回数"
        value={4210}
        comparison={<Delta comparison={compare(4210, 3890)} />}
        note={NOTE}
      />
      <KpiCard label="読んだ人の数（おおよそ）" value={null} />
      <KpiCard label="読まれていた時間" value="1 分 20 秒" headingLevel={2} />
    </KpiGrid>,
  ],
  ['Notice', <Notice key="notice">{NOTE}</Notice>],
  ['Badge', <Badge key="badge">{NEW}</Badge>],
  ['StateMessage（読み込み中）', <StateMessage key="loading" kind="loading" />],
  ['StateMessage（エラー）', <StateMessage key="error" kind="error" />],
  ['StateMessage（データなし）', <StateMessage key="empty" kind="empty" />],
  [
    'Details',
    <Details key="details" summary="詳しく">
      {BODY}
    </Details>,
  ],
  [
    'ResponsiveDetails',
    <ResponsiveDetails key="responsive" summary="読者はどんな人？">
      {BODY}
    </ResponsiveDetails>,
  ],
  [
    'ExternalLink',
    <ExternalLink key="external" href="https://takatsu-connect.com/archives/101">
      {LABEL}
    </ExternalLink>,
  ],
  [
    'ArticleLink',
    <ArticleLink key="article" postId={101}>
      {LABEL}
    </ArticleLink>,
  ],
  [
    'AuthorLink',
    <AuthorLink key="author" slug="writer-a">
      {AUTHOR}
    </AuthorLink>,
  ],
  [
    'ArticleTable',
    <ArticleTable
      key="table"
      caption="記事"
      rows={[
        { post: makePost(), pageviews: 120, topChannel: 'search', recent7: null, categories: [] },
        { post: makePost({ id: 102, isPreMeasure: true, pv7: null, pv30: null, band30: null }) },
      ]}
      columns={[
        'title',
        'author',
        'publishedOn',
        'pageviews',
        'pv7',
        'pv30',
        'band',
        'category',
        'topChannel',
        'recent7',
      ]}
      sortable
    />,
  ],
];

describe('全部品: style 属性を出さない（U-24、CSP の style-src self）', () => {
  it.each(CASES)('%s', (_name, element) => {
    // サーバーで描く HTML（文字列）と、ブラウザで描いた DOM の両方を見る。
    const html = renderToStaticMarkup(element);
    expect(html).not.toBe('');
    expect(html).not.toMatch(/\sstyle=/);
    const { container } = render(element);
    expect(container.firstChild).not.toBeNull();
    expect(container.querySelector('[style]')).toBeNull();
  });
});

describe('3 状態と折りたたみ', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('読み込み中、エラー、データなしの文を出す。エラーは固定文だけ', () => {
    expect(render(<StateMessage kind="loading" />).container.textContent).toBe('読み込んでいます');
    const error = render(<StateMessage kind="error" />).container;
    expect(error.textContent).toBe('表示できませんでした。時間をおいて、もう一度開いてください。');
    expect(error.querySelector('[role="alert"]')).not.toBeNull();
    expect(render(<StateMessage kind="empty" />).container.textContent).toBe(
      'この期間の数字はまだありません。',
    );
  });

  it('KpiCard: 見出し、値、比較の相手の 1 文、注記の順。null は伏せ値の印', () => {
    const { container } = render(
      <KpiCard label="読まれた回数" value={4210} comparison="前の 28 日と比べて" note={NOTE} />,
    );
    expect(container.querySelector('h3')?.textContent).toBe('読まれた回数');
    expect([...container.querySelectorAll('p')].map((item) => item.textContent)).toEqual([
      '4,210',
      '前の 28 日と比べて',
      NOTE,
    ]);
    const masked = render(<KpiCard label="読んだ人の数" value={null} />).container;
    expect(masked.querySelector('.masked')?.textContent).toBe('—伏せ値');
  });

  it('Details は常に閉じた状態から始まる', () => {
    const { container } = render(<Details summary="詳しく">{BODY}</Details>);
    expect(container.querySelector('details')?.hasAttribute('open')).toBe(false);
  });

  it.each([
    ['広い画面', true],
    ['狭い画面', false],
  ])('ResponsiveDetails: %s では open が %s', (_name, isWide) => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => ({
        matches: isWide,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    );
    const { container } = render(<ResponsiveDetails summary="見出し">{BODY}</ResponsiveDetails>);
    expect(container.querySelector('details')?.hasAttribute('open')).toBe(isWide);
  });

  it('ResponsiveDetails: matchMedia がなければ閉じた状態。サーバーの HTML も閉じた状態', () => {
    const { container } = render(<ResponsiveDetails summary="見出し">{BODY}</ResponsiveDetails>);
    expect(container.querySelector('details')?.hasAttribute('open')).toBe(false);
    const html = renderToStaticMarkup(
      <ResponsiveDetails summary="見出し">{BODY}</ResponsiveDetails>,
    );
    expect(html).not.toMatch(/<details[^>]*\sopen/);
  });
});
