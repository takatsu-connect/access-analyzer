/**
 * S-03 構築 3 のレビューと助言（advice/2026-11-05-build3-screens-text.md A-2、A-3、B-6）の反映を固定する。
 */
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { buildArticleDetail } from '@/data/pages';
import type { ArticleDetailData } from '@/lib/page-data';
import { ArticleDetailScreen } from '@/screens/s03/ArticleDetailScreen';
import { youngProgress } from '@/screens/s03/progress';

import { addSameDayPost, BUILT_AT, makeCache, SAME_DAY_POST_ID } from '../../data/fixture';

afterEach(() => {
  cleanup();
  window.history.replaceState(null, '', '/');
});

function detail(postId: number, cache = makeCache()): ArticleDetailData {
  const data = buildArticleDetail(cache, postId, BUILT_AT);
  if (data === null) throw new Error(`フィクスチャに記事 ${postId} がありません`);
  return data;
}

function show(data: ArticleDetailData): HTMLElement {
  return render(<ArticleDetailScreen data={data} />).container;
}

function sectionOf(container: HTMLElement, id: string): HTMLElement {
  const node = container.querySelector<HTMLElement>(`section[aria-labelledby="${id}"]`);
  if (node === null) throw new Error(`節がありません: ${id}`);
  return node;
}

describe('S-03 公開当日の記事（age_days の契約）', () => {
  it('公開当日の記事（age_days = 1）は「1 日目」で、累積 1 行を使う', () => {
    const data = detail(SAME_DAY_POST_ID, addSameDayPost(makeCache()));
    expect(data.post.ageDays).toBe(1);
    expect(data.cumulative[0]).toBe(4);
    const container = show(data);
    expect(container.textContent).toContain('公開日 2026 年 11 月 3 日（1 日目）');
    expect(container.textContent).not.toContain('（0 日目）');
    // 帯と比べるのは 3 日目から。
    expect(sectionOf(container, 's03-curve').textContent).toContain('まだ比較できません');
  });

  it('youngProgress は ageDays をそのまま n にし、累積の n − 1 番目を使う', () => {
    expect(youngProgress(1, [4])).toEqual({ n: 1, pv: 4 });
    expect(youngProgress(3, [5, 5, 12])).toEqual({ n: 3, pv: 12 });
    // 契約の外（0、小数）は null。累積がない日も null。
    expect(youngProgress(0, [4])).toBeNull();
    expect(youngProgress(1.5, [4])).toBeNull();
    expect(youngProgress(2, [4, null])).toBeNull();
  });

  it('フィクスチャの記事の日数は「基準日 − 公開日 + 1」', () => {
    expect(detail(102).post.ageDays).toBe(293);
    expect(detail(103).post.ageDays).toBe(25);
    expect(detail(104).post.ageDays).toBe(3);
  });
});

describe('S-03 表の読み上げ', () => {
  it('表に読み上げ用の caption があり、「同じ数字を表で見る」に節の名前を添える', () => {
    const container = show(detail(102));
    const tables = [...container.querySelectorAll('table')];
    expect(tables.length).toBeGreaterThan(0);
    for (const table of tables) {
      expect(table.querySelector('caption')?.textContent).toBeTruthy();
    }
    const summaries = [...container.querySelectorAll('summary')]
      .map((node) => node.textContent)
      .filter((text) => text.startsWith('同じ数字を表で見る'));
    expect(summaries.length).toBeGreaterThan(1);
    // 読み上げでは、同じ名前が並ばない。
    expect(new Set(summaries).size).toBe(summaries.length);
    expect(summaries).toContain('同じ数字を表で見る（公開からの読まれ方）');
  });
});

describe('S-03 前置き（B-6）', () => {
  it('前置きは「この記事から読み始めた訪問 n 回のうち」で、注記は最初の節にだけ', () => {
    const container = show(detail(102));
    const source = sectionOf(container, 's03-source').textContent;
    const device = sectionOf(container, 's03-device').textContent;
    expect(source).toContain('この記事から読み始めた訪問 30 回のうち');
    expect(source).toContain('ほかのページから移ってきて読まれた分は、ここには入っていません。');
    expect(device).toContain('この記事から読み始めた訪問 30 回のうち');
    expect(device).not.toContain('ほかのページから移ってきて');
    expect(container.textContent?.split('ほかのページから移ってきて').length).toBe(2);
  });

  it('0 件のときは前置きを出さない', () => {
    const base = detail(102);
    const last28 = base.period.last28;
    const breakdown = base.breakdown.last28;
    if (last28 === undefined || breakdown === undefined) throw new Error('直近 28 日がありません');
    const data: ArticleDetailData = {
      ...base,
      period: { ...base.period, last28: { ...last28, landingSessions: 0 } },
      breakdown: {
        ...base.breakdown,
        last28: { ...breakdown, channel: { ...breakdown.channel, social: 0 } },
      },
    };
    const container = show(data);
    expect(sectionOf(container, 's03-source').textContent).not.toContain('回のうち');
    expect(sectionOf(container, 's03-device').textContent).not.toContain('回のうち');
    expect(container.textContent).not.toContain('訪問 0 回');
  });
});

describe('S-03 文言の直し（低）', () => {
  it('許可外の URL では「↗」も出さない', () => {
    const base = detail(102);
    const container = show({ ...base, post: { ...base.post, url: 'https://example.com/x/' } });
    const title = container.querySelector('h1')?.nextElementSibling;
    expect(title?.textContent).toBe('記事 102');
    expect(title?.querySelector('a')).toBeNull();
  });

  it('M-09 の注記に例の数字を入れない', () => {
    const text = sectionOf(show(detail(102)), 's03-engagement').textContent;
    expect(text).toContain(
      '読まれた回数のうち、ページの終わり近くまで進んだ分を、10 人あたりに直した目安です。',
    );
    expect(text).not.toContain('10 人中 6 人');
  });

  it('リンク元の文言（empty、note、absent）', () => {
    const base = detail(102);
    const empty = show({ ...base, referrer30d: { status: 'ready', rows: [] } });
    expect(sectionOf(empty, 's03-source').textContent).toContain(
      'リンク元のサイトごとの訪問は、どれも 5 回未満でした（小さな数は表示していません）。',
    );
    expect(sectionOf(empty, 's03-source').textContent).toContain(
      '公開から 30 日間の集計です。期間を選び直しても変わりません。',
    );
    cleanup();
    const pending = show({ ...base, referrer30d: { status: 'pending' } });
    expect(sectionOf(pending, 's03-source').textContent).toContain('公開から 30 日たつと出ます');
  });

  it('h2 と、h2 の下の 1 文、区切りの文', () => {
    const container = show(detail(102));
    const source = sectionOf(container, 's03-source');
    expect(source.querySelector('h2')?.textContent).toBe('読者はどこから来たか');
    expect(source.querySelector('h2')?.nextElementSibling?.textContent).toBe(
      '次に記事を紹介する場所を考えるときの参考になります。',
    );
    expect(container.textContent).toContain('ここから下は、選んだ期間の数字です');
  });

  it('帯を出さないときは band.note も出さない', () => {
    // 記事 104 は 3 日目だが、3 日目の帯がない（まだ比較できません）。
    const curve = sectionOf(show(detail(104)), 's03-curve').textContent;
    expect(curve).toContain('まだ比較できません');
    expect(curve).not.toContain('成績ではなく、位置です。');
    cleanup();
    expect(sectionOf(show(detail(102)), 's03-curve').textContent).toContain(
      '成績ではなく、位置です。',
    );
  });

  it('これまでの記事の範囲の注記', () => {
    const text = sectionOf(show(detail(102)), 's03-own').textContent;
    expect(text).toContain('直近 1 年に公開し、30 日たった記事で見ています。');
    expect(text).not.toContain('以降に公開した記事');
  });
});
