import a11y from '@/components/a11y.module.css';
import { BandDot, Curve } from '@/components/charts';
import { Details } from '@/components/Details';
import { Notice } from '@/components/Notice';
import { formatNumber } from '@/lib/format';
import type { ArticleDetailData } from '@/lib/page-data';
import { t } from '@/lib/ui-text';

import { benchmarkAt, curveDays, FULL_DAYS, MIN_COMPARE_DAYS, youngProgress } from './progress';
import styles from './s03.module.css';
import { TableSummary } from './TableSummary';

export type CurveSectionProps = {
  post: ArticleDetailData['post'];
  cumulative: ArticleDetailData['cumulative'];
  benchmark: ArticleDetailData['benchmark'];
  /** 比べる相手（記事どうし、イベント記事どうし、null は全体）。帯の文の下に一言で添える。 */
  benchmarkSection: ArticleDetailData['benchmarkSection'];
};

/**
 * 帯の文。30 日以上たった記事は n = 30、30 日未満は n = ageDays の帯と比べる（04 §3.4）。
 * 3 日未満か、帯が出せないときは null（「まだ比較できません」）。
 */
function bandSentence({ post, cumulative, benchmark }: CurveSectionProps): string | null {
  if (post.ageDays < MIN_COMPARE_DAYS) return null;
  if (post.ageDays >= FULL_DAYS) {
    const point = benchmarkAt(benchmark, FULL_DAYS);
    if (post.pv30 === null || point === null) return null;
    return t('s03.curve.text', {
      pv30: formatNumber(post.pv30),
      p25: formatNumber(point.p25),
      p50: formatNumber(point.p50),
      p75: formatNumber(point.p75),
    });
  }
  const progress = youngProgress(post.ageDays, cumulative);
  const point = progress === null ? null : benchmarkAt(benchmark, progress.n);
  if (progress === null || point === null) return null;
  return t('s03.curve.text.young', {
    n: progress.n,
    pv: formatNumber(progress.pv),
    p25: formatNumber(point.p25),
    p75: formatNumber(point.p75),
  });
}

/**
 * 公開からの読まれ方（M-18、M-19、M-20。FR-23 (3)）。期間に依らない。
 * 図（Curve）、帯の文、帯と点（BandDot）、注記、同じ値の表の順。
 * 数え始める前に公開した記事では、呼び出し側がこの節を見出しごと出さない。
 */
export function CurveSection(props: CurveSectionProps) {
  const { post, cumulative, benchmark } = props;
  const days = curveDays(post.ageDays);
  const sentence = bandSentence(props);
  const dayLabel = (day: number): string => t('absent.dayN', { n: day });
  const drawsBand =
    benchmark !== null && benchmark.p25.slice(0, days).some((value) => value !== null);

  const rows = cumulative.slice(0, days).flatMap((value, index) => {
    if (value === null) return [];
    return [{ day: index + 1, value, point: benchmarkAt(benchmark, index + 1) }];
  });

  return (
    <section className={styles.section} aria-labelledby="s03-curve">
      <h2 id="s03-curve">{t('metric.M18.label')}</h2>
      <Curve
        title={t('metric.M18.label')}
        cumulative={cumulative}
        benchmark={benchmark}
        days={days}
        labels={{
          post: t('legend.curve.post'),
          band: t('metric.M19.label'),
          median: t('metric.M27.label'),
        }}
        dayLabel={dayLabel}
      />
      {/*
        比べる相手の一言は、図に帯を描くとき（描く日数の中に帯の値があるとき）に、凡例の直下に置く。
        帯の文が「まだ比較できません」でも、帯が見えていれば誰の帯かを書く（レビュー 2026-11-10 M-4）。
      */}
      {drawsBand ? (
        <Notice>{t(`s03.curve.scope.${props.benchmarkSection ?? 'all'}`)}</Notice>
      ) : null}
      <p className={styles.lead}>{sentence ?? t('absent.band')}</p>
      {/* 帯の文が出せないときは、点も出さない（「まだ比較できません」と区分の名前を並べない）。 */}
      {sentence === null || post.band30 === null ? null : <BandDot band={post.band30} />}
      <Notice>{t('metric.M18.note')}</Notice>
      {/* 帯の文を出さない（まだ比較できません）ときは、3 つの区分の説明も出さない（助言 A-3）。 */}
      {sentence === null ? null : <Notice>{t('band.note')}</Notice>}
      {rows.length === 0 ? null : (
        <Details summary={<TableSummary name={t('metric.M18.label')} />}>
          <table className={styles.table}>
            <caption className={a11y.srOnly}>{t('s03.curve.caption')}</caption>
            <thead>
              <tr>
                <th scope="col">{t('s03.curve.table.day')}</th>
                <th scope="col" className={styles.num}>
                  {t('legend.curve.post')}
                </th>
                <th scope="col" className={styles.num}>
                  {t('metric.M19.label')}
                </th>
                <th scope="col" className={styles.num}>
                  {t('metric.M27.label')}
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.day}>
                  <th scope="row">{dayLabel(row.day)}</th>
                  <td className={styles.num}>{formatNumber(row.value)}</td>
                  <td className={styles.num}>
                    {row.point === null
                      ? t('absent.band')
                      : t('s03.curve.table.range', {
                          p25: formatNumber(row.point.p25),
                          p75: formatNumber(row.point.p75),
                        })}
                  </td>
                  <td className={styles.num}>
                    {row.point === null ? t('absent.band') : formatNumber(row.point.p50)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Details>
      )}
    </section>
  );
}
