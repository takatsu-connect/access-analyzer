import a11y from '@/components/a11y.module.css';
import { cx } from '@/components/class-names';
import { Delta } from '@/components/Delta';
import { Details } from '@/components/Details';
import { Notice, StateMessage } from '@/components/Notice';
import { compare } from '@/lib/derive';
import { formatNumber } from '@/lib/format';
import type { ByPeriod, Period } from '@/lib/page-data';
import { t } from '@/lib/ui-text';

import styles from './s01.module.css';
import { monthlyTarget, pick } from './series';

/** 表に出す行数（上位 10。連番は付けない）。 */
const TOP_ROWS = 10;

export type MonthTableRow = {
  key: string;
  /** 名前の前に置く区分（都道府県）。広い画面では別の列、狭い画面では名前の前に添える。 */
  group?: string;
  name: string;
  sessions: number;
};

export type MonthTableProps<Row extends { sessions: number }> = {
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
};

type OtherMonthProps = {
  current: number;
  /** 比べる月の値。null は、その月の表にこの行がない。 */
  other: number | null;
  absentText: string;
};

function OtherMonth({ current, other, absentText }: OtherMonthProps) {
  if (other === null) return <span className={styles.absent}>{absentText}</span>;
  return <Delta comparison={compare(current, other)} />;
}

/**
 * 月ごとに集計する表（リンク元のサイト、市別。FR-13、FR-15）。
 * 名前 | 訪問回数 | 前の月と比べて | 去年の同じ月と比べて。狭い画面では最後の列を「詳しく」に入れる。
 * 期間の選択に連動しないことを、表の下に書く。
 */
export function MonthTable<Row extends { sessions: number }>({
  caption,
  groupHeader,
  nameHeader,
  table,
  toRow,
  periods,
  selected,
}: MonthTableProps<Row>) {
  const target = monthlyTarget(periods, selected);
  const current = target === null ? undefined : table[target.id];
  if (target === null || current === undefined || current.length === 0) {
    return <StateMessage kind="empty" />;
  }

  const sessionsByKey = (rows: Row[] | undefined): Map<string, number> =>
    new Map((rows ?? []).map((row) => [toRow(row).key, row.sessions]));
  const prev = sessionsByKey(pick(table, target.prevId));
  const yoy = sessionsByKey(pick(table, target.yoyId));
  const rows = current.slice(0, TOP_ROWS).map(toRow);

  return (
    <>
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
            <th scope="col" className={styles.narrowCell}>
              {t('column.more')}
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const yoyCell = (
              <OtherMonth
                current={row.sessions}
                other={yoy.get(row.key) ?? null}
                absentText={t('absent.yoy')}
              />
            );
            return (
              <tr key={row.key}>
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
                    other={prev.get(row.key) ?? null}
                    absentText={t('s01.monthly.noPrev')}
                  />
                </td>
                <td className={cx(styles.num, styles.wideCell)}>{yoyCell}</td>
                <td className={styles.narrowCell}>
                  <Details summary={t('column.more')}>
                    <span className={styles.compareLabel}>{t('compare.yoy')}</span>
                    {yoyCell}
                  </Details>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <Notice>
        {target.id === selected.id
          ? t('s01.monthly.note.selected', { month: target.label })
          : t('s01.monthly.note.latest', { month: target.label })}
      </Notice>
    </>
  );
}
