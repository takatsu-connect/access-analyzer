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

const COLUMNS: readonly ArticleColumnId[] = ['title', 'author', 'publishedOn', 'recent7'];
const BADGES: readonly ArticleBadgeKind[] = ['recentHot', 'revival'];

/**
 * S-02d 最近よく読まれている記事（05 §4.4、M-22）。data は getArticleListData('recent')。
 * 期間は選べない（直近 7 日の読まれ方で決まる）。何倍になったかの数字は出さない。
 */
export function S02dScreen({ data }: { data: ArticleListData }) {
  const rows = useMemo(() => recentRows(data), [data]);

  return (
    <>
      <h1>{t('s02d.h1')}</h1>
      <Notice>{t('s02d.note')}</Notice>
      <Details summary={t('notes.more')}>
        <Notice>{t('s02d.note.detail')}</Notice>
      </Details>
      <PreMeasureNote rows={rows} columns={COLUMNS} measureStart={data.meta.measureStart} />
      <ArticleTable
        caption={t('s02d.name')}
        rows={rows}
        columns={COLUMNS}
        badges={BADGES}
        emptyText={t('s02d.empty')}
        primaryColumn="recent7"
      />
    </>
  );
}
