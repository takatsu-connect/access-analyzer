import { formatDate, formatNumber } from '@/lib/format';
import type { ArticleDetailData } from '@/lib/page-data';
import { t } from '@/lib/ui-text';

import styles from './s03.module.css';

export type MilestoneSectionProps = {
  milestones: ArticleDetailData['milestones'];
  isEvergreen365: boolean;
  /** 数え始める前に公開した記事。文言の頭に「数え始めてから」を足す。 */
  isPreMeasure: boolean;
};

/**
 * 到達のお知らせ（M-23。FR-23 (4)）。期間に依らない。誰とも比べない。
 * 節目は回数の順。数え始める前に公開した記事は「1 年たっても読まれています」を先頭に置く。
 * 該当がなければ、最初のお知らせがいつ出るかを書く。
 */
export function MilestoneSection({
  milestones,
  isEvergreen365,
  isPreMeasure,
}: MilestoneSectionProps) {
  const reachedKey = isPreMeasure ? 'milestone.reached.since' : 'milestone.reached';
  const reached = [...milestones]
    .sort((a, b) => a.milestone - b.milestone)
    .map((item) => ({
      key: String(item.milestone),
      text: t(reachedKey, { n: formatNumber(item.milestone), date: formatDate(item.reachedOn) }),
    }));
  const evergreen = isEvergreen365 ? [{ key: 'evergreen', text: t('milestone.evergreen') }] : [];
  const items = isPreMeasure ? [...evergreen, ...reached] : [...reached, ...evergreen];

  return (
    <section className={styles.section} aria-labelledby="s03-milestone">
      <h2 id="s03-milestone">{t('metric.M23.label')}</h2>
      {items.length === 0 ? (
        <p className={styles.lead}>
          {isPreMeasure ? t('absent.milestone.since') : t('absent.milestone')}
        </p>
      ) : (
        <ul className={styles.milestones}>
          {items.map((item) => (
            <li key={item.key} className={styles.milestone}>
              <span aria-hidden="true">{t('s03.milestone.mark')}</span>
              <span>{item.text}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
