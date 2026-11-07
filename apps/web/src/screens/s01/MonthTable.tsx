import { Fragment } from 'react';

import a11y from '@/components/a11y.module.css';
import { cx } from '@/components/class-names';
import { Delta } from '@/components/Delta';
import { Details } from '@/components/Details';
import { Notice, StateMessage } from '@/components/Notice';
import { compare, partialMonthStartDay } from '@/lib/derive';
import { formatNumber } from '@/lib/format';
import type { ByPeriod, Period } from '@/lib/page-data';
import { t } from '@/lib/ui-text';

import styles from './s01.module.css';
import { monthlyTarget, pick } from './series';

/** 表に出す行数（上位 10。連番は付けない）。 */
const TOP_ROWS = 10;

/** 狭い画面で見えている列の数（名前、訪問回数、前の月と比べて）。「詳しく」の段の colSpan。 */
const NARROW_COLUMNS = 3;

export type MonthTableRow = {
  key: string;
  /** 名前の前に置く区分（都道府県）。広い画面では別の列、狭い画面では名前の前に添える。 */
  group?: string;
  name: string;
  sessions: number;
};

export type MonthTableProps<Row extends { sessions: number }> = {
  /** 見出し（h3）の名前。「リンク元のサイト」。見出しは「{label}（{month}）」になる。 */
  label: string;
  /** 表の説明（caption）。 */
  caption: string;
  /** 区分の列の見出し（都道府県）。渡さなければ列を作らない。 */
  groupHeader?: string;
  nameHeader: string;
  /** 月ごとの行（確定月だけ）。 */
  table: ByPeriod<Row[]>;
  toRow: (row: Row) => MonthTableRow;
  periods: readonly Period[];
  /** 選んでいる期間。確定した月ならその月、それ以外は最新の確定月の表を出す。 */
  selected: Period;
  /** 見出しの段（既定は h3。市別は h4）。 */
  headingLevel?: 3 | 4;
  /** meta.measureStart。比べる月が数え始めた月なら、差を出さずに数字を並べる。 */
  measureStart: string;
};

type OtherMonthProps = {
  current: number;
  /** 比べる月の表。undefined は、その月の表そのものがない。 */
  rows: Map<string, number> | undefined;
  rowKey: string;
  /** 比べる月が数え始めた月なら、数え始めた日。 */
  partialDay: number | null;
  target: 'prev' | 'yoy';
};

function OtherMonth({ current, rows, rowKey, partialDay, target }: OtherMonthProps) {
  if (rows === undefined) {
    const text = target === 'prev' ? t('s01.monthly.noPrev') : t('absent.yoy');
    return <span className={styles.absent}>{text}</span>;
  }
  const other = rows.get(rowKey);
  if (other === undefined) {
    // 表はあるが、上位 10 行に入っていない。
    const text = target === 'prev' ? t('s01.monthly.prevNotListed') : t('s01.monthly.yoyNotListed');
    return <span className={styles.absent}>{text}</span>;
  }
  if (partialDay !== null) {
    return (
      <span className={styles.absent}>
        {t(`compare.partial.${target}`, { value: formatNumber(other), day: partialDay })}
      </span>
    );
  }
  return <Delta comparison={compare(current, other)} />;
}

/**
 * 月ごとに集計する表（リンク元のサイト、市別。FR-13、FR-15）。
 * 見出し「リンク元のサイト（2026 年 9 月）」と、その直下に、期間の選択に連動しないことの注記。
 * 名前 | 訪問回数 | 前の月と比べて | 去年の同じ月と比べて。
 * 狭い画面では最後の列を隠し、行の下の段の「詳しく」に入れる（レビュー P-1。ArticleTable の .moreRow と同じ形）。
 */
export function MonthTable<Row extends { sessions: number }>({
  label,
  caption,
  groupHeader,
  nameHeader,
  table,
  toRow,
  periods,
  selected,
  measureStart,
  headingLevel = 3,
}: MonthTableProps<Row>) {
  const Heading = headingLevel === 4 ? 'h4' : 'h3';
  const headingClass = headingLevel === 4 ? styles.h4 : styles.h3;
  const target = monthlyTarget(periods, selected);
  const current = target === null ? undefined : table[target.id];
  if (target === null || current === undefined || current.length === 0) {
    return (
      <>
        <Heading className={headingClass}>{label}</Heading>
        <StateMessage kind="empty" />
      </>
    );
  }

  const sessionsByKey = (rows: Row[] | undefined): Map<string, number> | undefined =>
    rows === undefined ? undefined : new Map(rows.map((row) => [toRow(row).key, row.sessions]));
  const prev = sessionsByKey(pick(table, target.prevId));
  const yoy = sessionsByKey(pick(table, target.yoyId));
  const prevPartial = partialMonthStartDay(target.prevId, measureStart);
  const yoyPartial = partialMonthStartDay(target.yoyId, measureStart);
  const rows = current.slice(0, TOP_ROWS).map(toRow);

  return (
    <>
      <Heading className={headingClass}>
        {t('s01.monthly.heading', { label, month: target.label })}
      </Heading>
      <Notice>{t('s01.monthly.note')}</Notice>
      <table className={styles.table}>
        <caption className={a11y.srOnly}>{caption}</caption>
        <thead>
          <tr>
            {groupHeader === undefined ? null : (
              <th scope="col" className={styles.wideCell}>
                {groupHeader}
              </th>
            )}
            <th scope="col">{nameHeader}</th>
            <th scope="col" className={styles.num}>
              {t('column.sessions')}
            </th>
            <th scope="col" className={styles.num}>
              {t('compare.prevMonth')}
            </th>
            <th scope="col" className={cx(styles.num, styles.wideCell)}>
              {t('compare.yoy')}
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const yoyCell = (
              <OtherMonth
                current={row.sessions}
                rows={yoy}
                rowKey={row.key}
                partialDay={yoyPartial}
                target="yoy"
              />
            );
            return (
              <Fragment key={row.key}>
                <tr className={styles.hasMore}>
                  {groupHeader === undefined ? null : (
                    <td className={styles.wideCell}>{row.group}</td>
                  )}
                  <th scope="row" className={styles.name}>
                    {groupHeader === undefined || row.group === undefined ? null : (
                      <span className={styles.narrowGroup}>{row.group}</span>
                    )}
                    {row.name}
                  </th>
                  <td className={styles.num}>{formatNumber(row.sessions)}</td>
                  <td className={styles.num}>
                    <OtherMonth
                      current={row.sessions}
                      rows={prev}
                      rowKey={row.key}
                      partialDay={prevPartial}
                      target="prev"
                    />
                  </td>
                  <td className={cx(styles.num, styles.wideCell)}>{yoyCell}</td>
                </tr>
                {/* 狭い画面だけの段。見えている列（名前、訪問回数、前の月と比べて）の幅いっぱいに置く。 */}
                <tr className={styles.moreRow} data-part="more-row">
                  <td colSpan={NARROW_COLUMNS} className={styles.moreCell}>
                    <Details
                      summary={
                        <>
                          {t('column.more')}
                          <span className={a11y.srOnly}>{row.name}</span>
                        </>
                      }
                    >
                      <span className={styles.compareLabel}>{t('compare.yoy')}</span>
                      {yoyCell}
                    </Details>
                  </td>
                </tr>
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </>
  );
}
