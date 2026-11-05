'use client';

import { useMemo } from 'react';

import { ExternalLink } from '@/components/ExternalLink';
import { StateMessage } from '@/components/Notice';
import { PeriodPicker } from '@/components/PeriodPicker';
import { resolvePeriod } from '@/components/usePeriod';
import { useQueryState } from '@/components/useQueryState';
import { safeExternalUrl } from '@/lib/derive';
import type { AuthorPageData } from '@/lib/page-data';
import type { QueryAllow } from '@/lib/query';
import { t } from '@/lib/ui-text';

import { CategorySection } from './CategorySection';
import { PostListSection } from './PostListSection';
import { RecentSection } from './RecentSection';
import { ReferrerSection } from './ReferrerSection';
import styles from './s05.module.css';
import { SummarySection } from './SummarySection';

export type AuthorScreenProps = { data: AuthorPageData };

/**
 * S-05 著者ページ（05 §6.2、FR-31〜FR-34）。
 *
 * - 比較の相手は、前の期間、全記事の分布（帯）、著者自身の過去の 3 つだけ。
 *   ほかの著者の数値、著者の本数の分布、連番、読まれていた時間は、どの節にも出さない。
 * - 期間（p）と並び（sort）は URL のクエリで持つ。静的な HTML は既定（直近 28 日、公開日の新しい順）。
 * - 著者は表示名で書く。slug は文字として出さない。
 */
export function AuthorScreen({ data }: AuthorScreenProps) {
  const allow = useMemo<QueryAllow>(
    () => ({ screen: 's05', periodIds: data.periods.map((item) => item.id) }),
    [data.periods],
  );
  const { state, update } = useQueryState(allow);
  const choice = resolvePeriod(data.periods, state.p);
  const { period } = choice;
  const { name, url } = data.author;

  return (
    <>
      <div className={styles.heading}>
        <h1>{t('s05.h1', { name })}</h1>
        {safeExternalUrl(url) === null ? null : (
          <ExternalLink
            href={url}
            className={styles.authorLink}
            ariaLabel={t('s05.authorLink.aria', { name })}
          >
            {t('s05.authorLink')} {t('link.external.mark')}
          </ExternalLink>
        )}
      </div>

      {period === null ? (
        <StateMessage kind="empty" />
      ) : (
        <>
          <div className={styles.picker}>
            <PeriodPicker
              periods={data.periods}
              value={period.id}
              onChange={(id) => update({ p: id })}
            />
          </div>
          <SummarySection data={data} choice={choice} period={period} />
          <ReferrerSection data={data} periodId={period.id} />
          <CategorySection data={data} periodId={period.id} />
        </>
      )}

      <RecentSection data={data} />
      <PostListSection
        data={data}
        periodId={period?.id ?? null}
        sort={state.sort}
        onSortChange={(sort) => update({ sort })}
      />
    </>
  );
}
