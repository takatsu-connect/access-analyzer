'use client';

import { useMemo } from 'react';

import { ArticleTable } from '@/components/ArticleTable';
import type { ArticleColumnId, ArticleTablePost } from '@/components/ArticleTable';
import { BandDot } from '@/components/charts/BandDot';
import { Notice, StateMessage } from '@/components/Notice';
import { PeriodPicker } from '@/components/PeriodPicker';
import { usePeriod } from '@/components/usePeriod';
import type { ArticleListData } from '@/lib/page-data';
import { t } from '@/lib/ui-text';

import { PreMeasureNote } from './PreMeasureNote';
import { publishedWithin } from './rows';

const COLUMNS: readonly ArticleColumnId[] = [
  'title',
  'author',
  'publishedOn',
  'pv7',
  'pv30',
  'band',
];
/** 狭い画面の 4 列（05 §4.2）。帯は文言だけを残し、図は「詳しく」に入る。 */
const NARROW_COLUMNS: readonly ArticleColumnId[] = ['title', 'publishedOn', 'pv30', 'band'];

/**
 * 帯の図。点は 3 区分の固定の位置（BandDot が持つ）。
 * まだ比べられない記事は、図を描かずに ArticleTable の文言（「まだ比較できません」）に任せる。
 */
function renderBand(post: ArticleTablePost) {
  return post.band30 === null ? null : <BandDot band={post.band30} />;
}

/**
 * S-02b 新着記事の立ち上がり（05 §4.2、FR-21）。data は getArticleListData('new')。
 * 選んだ期間に公開された記事を、公開日の新しい順に並べる。帯で並べ替える操作は置かない。
 */
export function S02bScreen({ data }: { data: ArticleListData }) {
  const { period, setPeriod } = usePeriod(data.periods);
  const rows = useMemo(
    () => (period === null ? [] : publishedWithin(data.posts, period.start, period.end)),
    [data.posts, period],
  );

  if (period === null) {
    return (
      <>
        <h1>{t('s02b.h1')}</h1>
        <StateMessage kind="empty" />
      </>
    );
  }

  return (
    <>
      <h1>{t('s02b.h1')}</h1>
      <PeriodPicker periods={data.periods} value={period.id} onChange={setPeriod} />
      <Notice>{t('s02b.note')}</Notice>
      <Notice>{t('band.note')}</Notice>
      <PreMeasureNote rows={rows} columns={COLUMNS} measureStart={data.meta.measureStart} />
      <ArticleTable
        caption={t('s02b.name')}
        rows={rows}
        columns={COLUMNS}
        narrowColumns={NARROW_COLUMNS}
        renderBand={renderBand}
        emptyText={t('s02b.empty')}
      />
    </>
  );
}
