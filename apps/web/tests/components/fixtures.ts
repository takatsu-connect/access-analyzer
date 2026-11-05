import type { ArticleTablePost } from '@/components/ArticleTable';
import type { Period } from '@/lib/page-data';

/** 基準日 2026-11-02 の例（05 §4.2 のワイヤーと同じ日付）。 */
export const PERIODS: Period[] = [
  {
    id: 'last7',
    kind: 'window',
    start: '2026-10-27',
    end: '2026-11-02',
    isConfirmed: false,
    label: '直近 7 日',
    prevId: 'prev7',
    yoyId: null,
  },
  {
    id: 'last28',
    kind: 'window',
    start: '2026-10-06',
    end: '2026-11-02',
    isConfirmed: false,
    label: '直近 28 日',
    prevId: 'prev28',
    yoyId: null,
  },
  {
    id: 'last90',
    kind: 'window',
    start: '2026-08-05',
    end: '2026-11-02',
    isConfirmed: false,
    label: '直近 90 日',
    prevId: 'prev90',
    yoyId: null,
  },
  {
    id: 'm2026-11',
    kind: 'month',
    start: '2026-11-01',
    end: '2026-11-02',
    isConfirmed: false,
    label: '2026 年 11 月',
    prevId: 'm2026-10',
    yoyId: null,
  },
  {
    id: 'm2026-10',
    kind: 'month',
    start: '2026-10-01',
    end: '2026-10-31',
    isConfirmed: true,
    label: '2026 年 10 月',
    prevId: null,
    yoyId: null,
  },
];

/** 記事の行。指定しない項目は、公開から 30 日以上たった普通の記事の値。 */
export function makePost(overrides: Partial<ArticleTablePost> = {}): ArticleTablePost {
  return {
    id: 101,
    title: '溝の口の朝市を歩く',
    url: 'https://takatsu-connect.com/archives/101',
    authorSlug: 'writer-a',
    authorName: '高津 花子',
    publishedOn: '2026-09-01',
    isAd: false,
    ageDays: 63,
    freshness: 'mid',
    isPreMeasure: false,
    pv7: 86,
    pv30: 240,
    band30: 'middle',
    pvTotal: 310,
    isRecentHot: false,
    isRevival: false,
    categoryIds: [],
    tagIds: [],
    ...overrides,
  };
}
