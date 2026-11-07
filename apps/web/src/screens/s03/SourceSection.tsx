import a11y from '@/components/a11y.module.css';
import { Notice, StateMessage } from '@/components/Notice';
import { CHANNEL_BUCKETS, SNS_BUCKETS } from '@/lib/config';
import { formatNumber } from '@/lib/format';
import type {
  ArticleBreakdown,
  ArticleDetailData,
  ArticlePeriodValue,
  Masked,
} from '@/lib/page-data';
import { t } from '@/lib/ui-text';

import styles from './s03.module.css';
import { ShareBars } from './ShareBars';

/** リンク元のサイトの表に出す行数（05 §5: 上位 3）。 */
const REFERRER_ROWS = 3;

export type SourceSectionProps = {
  /** 選んだ期間の値。その期間の行がなければ undefined。 */
  value: ArticlePeriodValue | undefined;
  breakdown: ArticleBreakdown | undefined;
  referrer30d: ArticleDetailData['referrer30d'];
  /** 数え始める前に公開した記事。リンク元のサイトを見出しごと出さない。 */
  isPreMeasure: boolean;
};

/**
 * リンク元のサイト（M-12。FR-23 (6)）。公開後 30 日時点の集計で、選んだ期間によらない。
 * ドメインは文字として出すだけで、リンクにしない。順番の数字も付けない。
 */
function ReferrerBlock({ referrer30d }: Pick<SourceSectionProps, 'referrer30d'>) {
  return (
    <>
      <h3>{t('metric.M12.label')}</h3>
      <Notice>{t('s03.referrer.note')}</Notice>
      {referrer30d.status === 'pending' ? (
        <p className={styles.empty}>{t('absent.referrer30')}</p>
      ) : referrer30d.rows.length === 0 ? (
        <p className={styles.empty}>{t('s03.referrer.empty')}</p>
      ) : (
        <table className={styles.table}>
          <caption className={a11y.srOnly}>{t('s03.referrer.caption')}</caption>
          <thead>
            <tr>
              <th scope="col">{t('column.domain')}</th>
              <th scope="col" className={styles.num}>
                {t('column.sessions')}
              </th>
            </tr>
          </thead>
          <tbody>
            {referrer30d.rows.slice(0, REFERRER_ROWS).map((row) => (
              <tr key={row.domain}>
                <th scope="row">{row.domain}</th>
                <td className={styles.num}>{formatNumber(row.sessions)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}

/** 前置きを出せる数か（伏せ値と 0 では出さない。「訪問 0 回のうち」と書かない）。 */
function leadCount(value: Masked): number | null {
  return value === null || value === 0 ? null : value;
}

/**
 * 読者はどこから来たか（M-10、M-11、M-12、M-17。FR-23 (6)）。
 * 流入チャネルの分母は「この記事から読み始めた訪問」（landingSessions）。伏せ値か 0 なら前置きを出さない。
 * 前置きの注記（s03.landing.note）は、最初に出るこの節にだけ添える（助言 B-6）。
 * SNS の種類の分母は、流入チャネルの SNS の値。伏せ値か 0 なら前置きを出さない。
 */
export function SourceSection({ value, breakdown, referrer30d, isPreMeasure }: SourceSectionProps) {
  const landing = value === undefined ? null : leadCount(value.landingSessions);
  const social = breakdown === undefined ? null : leadCount(breakdown.channel.social);
  return (
    <section className={styles.section} aria-labelledby="s03-source">
      <h2 id="s03-source">{t('s03.source.h2')}</h2>
      <p className={styles.lead}>{t('s03.source.lead')}</p>
      {value === undefined || breakdown === undefined ? (
        <StateMessage kind="empty" />
      ) : (
        <>
          {landing === null ? null : (
            <>
              <p className={styles.lead}>{t('s03.landing.lead', { n: formatNumber(landing) })}</p>
              <Notice>{t('s03.landing.note')}</Notice>
            </>
          )}
          <ShareBars
            title={t('metric.M10.label')}
            columnLabel={t('column.topChannel')}
            items={CHANNEL_BUCKETS.map((key) => ({
              key,
              label: t(`channel.${key}`),
              value: breakdown.channel[key],
            }))}
            total={value.landingSessions}
          />

          <h3>{t('metric.M11.label')}</h3>
          {social === null ? null : (
            <p className={styles.lead}>{t('lead.sessions', { n: formatNumber(social) })}</p>
          )}
          <ShareBars
            title={t('metric.M11.label')}
            columnLabel={t('metric.M11.label')}
            items={SNS_BUCKETS.map((key) => ({
              key,
              label: t(`sns.${key}`),
              value: breakdown.sns[key],
            }))}
            total={breakdown.channel.social}
          />
        </>
      )}
      {isPreMeasure ? null : <ReferrerBlock referrer30d={referrer30d} />}
    </section>
  );
}
