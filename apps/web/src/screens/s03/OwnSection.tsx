import { Notice } from '@/components/Notice';
import { formatNumber } from '@/lib/format';
import type { ArticleDetailData } from '@/lib/page-data';
import { t } from '@/lib/ui-text';

import { FULL_DAYS, youngProgress } from './progress';
import styles from './s03.module.css';

export type OwnSectionProps = {
  post: ArticleDetailData['post'];
  cumulative: ArticleDetailData['cumulative'];
  ownMedian30d: ArticleDetailData['ownMedian30d'];
};

/** 著者自身の過去の記事との比較の文。30 日未満の記事は「◯日目で ◯回」。 */
function ownSentence(
  post: ArticleDetailData['post'],
  cumulative: ArticleDetailData['cumulative'],
  median: number,
): string {
  const name = post.authorName;
  const medianText = formatNumber(median);
  if (post.ageDays >= FULL_DAYS && post.pv30 !== null) {
    return t('s03.own.text', { name, median: medianText, pv30: formatNumber(post.pv30) });
  }
  const progress = post.ageDays < FULL_DAYS ? youngProgress(post.ageDays, cumulative) : null;
  if (progress !== null) {
    return t('s03.own.text.young', {
      name,
      median: medianText,
      n: progress.n,
      pv: formatNumber(progress.pv),
    });
  }
  // この記事の側の数字がまだない。著者の側だけを書く。
  return t('s03.own.text.medianOnly', { name, median: medianText });
}

/**
 * ◯◯さんのこれまでの記事と比べて（M-24。FR-23 (5)）。期間に依らない。
 * 比べる相手は、その著者自身の過去の記事だけ。著者の記事が 5 本に満たなければ、いつ出るかを書く。
 * 数え始める前に公開した記事では、呼び出し側がこの節を見出しごと出さない。
 */
export function OwnSection({ post, cumulative, ownMedian30d }: OwnSectionProps) {
  return (
    <section className={styles.section} aria-labelledby="s03-own">
      <h2 id="s03-own">{t('s03.own.h2', { name: post.authorName })}</h2>
      {ownMedian30d === null ? (
        <p className={styles.empty}>{t('absent.ownMedian')}</p>
      ) : (
        <>
          <p className={styles.lead}>{ownSentence(post, cumulative, ownMedian30d.value)}</p>
          <Notice>{t('notes.ownMedian.scope')}</Notice>
        </>
      )}
    </section>
  );
}
