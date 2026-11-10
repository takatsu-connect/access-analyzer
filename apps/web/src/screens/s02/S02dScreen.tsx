'use client';

import { useMemo } from 'react';

import { ArticleTable } from '@/components/ArticleTable';
import type { ArticleBadgeKind, ArticleColumnId } from '@/components/ArticleTable';
import { Details } from '@/components/Details';
import { Notice } from '@/components/Notice';
import type { ArticleListData } from '@/lib/page-data';
import { t } from '@/lib/ui-text';

import { PreMeasureNote } from './PreMeasureNote';
import { recentRows } from './rows';
import { LIST_SCREEN_IDS } from './screen-ids';

const COLUMNS: readonly ArticleColumnId[] = ['title', 'author', 'publishedOn', 'recent7'];
const BADGES: readonly ArticleBadgeKind[] = ['recentHot', 'revival'];

/**
 * S-02d 最近よく読まれている記事（05 §4.4、M-22）と、そのイベント記事版の S-10d。
 * data は getArticleListData('recent', section)。
 * 期間は選べない（直近 7 日の読まれ方で決まる）。何倍になったかの数字は出さない。
 */
export function S02dScreen({ data }: { data: ArticleListData }) {
  const screenId = LIST_SCREEN_IDS[data.section].recent;
  const rows = useMemo(() => recentRows(data), [data]);

  return (
    <>
      <h1>{t(`${screenId}.h1`)}</h1>
      <Notice>{t(`${screenId}.note`)}</Notice>
      <Details summary={t('notes.more')}>
        <Notice>{t(`${screenId}.note.detail`)}</Notice>
      </Details>
      <PreMeasureNote rows={rows} columns={COLUMNS} measureStart={data.meta.measureStart} />
      <ArticleTable
        caption={t(`${screenId}.name`)}
        rows={rows}
        columns={COLUMNS}
        badges={BADGES}
        emptyText={t(`${screenId}.empty`)}
        primaryColumn="recent7"
      />
    </>
  );
}
