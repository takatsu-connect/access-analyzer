'use client';

import Link from 'next/link';
import { useMemo } from 'react';

import a11y from '@/components/a11y.module.css';
import { Heatmap } from '@/components/charts';
import type { HeatmapCell } from '@/components/charts';
import { cx } from '@/components/class-names';
import { Details } from '@/components/Details';
import { Notice, StateMessage } from '@/components/Notice';
import { useQueryState } from '@/components/useQueryState';
import { compare, monthProgress, splitYmd } from '@/lib/derive';
import type { Comparison, MonthProgress } from '@/lib/derive';
import {
  formatChange,
  formatDate,
  formatDiff,
  formatMonthWithProgress,
  formatNumber,
  formatSettlingUntil,
  formatYearMonth,
  isFlatChange,
} from '@/lib/format';
import type { MonthId, SeasonalData } from '@/lib/page-data';
import type { QueryAllow } from '@/lib/query';
import { t } from '@/lib/ui-text';

import styles from './seasonal.module.css';
import parts from './shared/parts.module.css';

/** 広い画面に出す月の数と、狭い画面に出す月の数（05 §7.2）。 */
const WIDE_MONTHS = 24;
const NARROW_MONTHS = 12;
/** 月の見出しを間引く間隔（12 か月を超えるとき）。 */
const LABEL_EVERY_WHEN_LONG = 3;

const AXIS_KEYS = ['parent', 'child'] as const;

type Category = { id: number; name: string };

const MONTH_ID_PATTERN = /^m(\d{4})-(0[1-9]|1[0-2])$/;

function partsOf(month: MonthId): { year: number; month: number } {
  const match = MONTH_ID_PATTERN.exec(month);
  if (!match) throw new RangeError('月の ID が正しくありません。');
  return { year: Number(match[1]), month: Number(match[2]) };
}

/** 'm2026-10' → 「2026 年 10 月」。 */
function longLabel(month: MonthId): string {
  return formatYearMonth(month.slice(1));
}

/** 'm2026-10' → 「2026/10」。格子の見出しに使う。 */
function shortLabel(month: MonthId): string {
  return t('s06b.month.short', partsOf(month));
}

/** 前年の同じ月。'm2026-10' → 'm2025-10'。 */
function yoyOf(month: MonthId): MonthId {
  const { year } = partsOf(month);
  return `m${year - 1}-${month.slice(-2)}`;
}

/**
 * 差を文字にする。向きは、矢印と符号の 2 つで伝える（色に頼らない）。
 * 比率の書き方は Delta と同じ（丸めて 0% なら「ほぼ同じ」で印なし、+100% 以上は倍）。
 */
function diffText({ diff, ratio }: Comparison): string {
  const amount =
    ratio === null
      ? formatDiff(diff)
      : t('compare.withRatio', { diff: formatDiff(diff), ratio: formatChange(diff, ratio) });
  if (diff === 0 || (ratio !== null && isFlatChange(diff, ratio))) return amount;
  return `${t(diff > 0 ? 'compare.arrow.up' : 'compare.arrow.down')} ${amount}`;
}

/**
 * S-06b 月ごと × カテゴリ（05 §7.2）。期間は直近 24 か月で固定（PeriodPicker を置かない）。
 *
 * - 広い画面: 行 = カテゴリ、列 = 月（24 か月まで）。
 * - 狭い画面: 直近 12 か月。親カテゴリのときは行と列を入れ替える（行 = 月、列 = カテゴリ）。
 *   子カテゴリのときだけ、図を横に送れるようにする。
 * - 広い画面用と狭い画面用の 2 つの図を描き、CSS で片方だけを見せる（静的な HTML を同じにする）。
 */
export function SeasonalScreen({ data }: { data: SeasonalData }) {
  const allow = useMemo<QueryAllow>(
    () => ({ screen: 's06b', periodIds: data.periods.map((item) => item.id) }),
    [data.periods],
  );
  const { state, update } = useQueryState(allow);
  const axis = state.axis;

  // 行に出すカテゴリ。親は 4 区分をそのまま、子は月ごとの数字が 1 つでもあるものだけ。
  const categories: Category[] =
    axis === 'parent'
      ? data.axes.map((item) => item.parent)
      : data.axes
          .flatMap((item) => item.children)
          .filter((child) => data.pvByMonth[child.id] !== undefined);
  const wideMonths = data.months.slice(-WIDE_MONTHS);
  const narrowMonths = data.months.slice(-NARROW_MONTHS);

  // 月の状態。途中の月（inProgress）と、月は終わったが数字を取り直している月（settling）を分ける。
  const progressByMonth = new Map<string, MonthProgress>(
    data.periods
      .filter((item) => item.kind === 'month')
      .map((item) => [item.id, monthProgress(item)]),
  );
  // periods にない月は、状態が分からないので安全側（月の途中）とみなす（比較を出さない）。
  const progressOf = (month: MonthId): MonthProgress => progressByMonth.get(month) ?? 'inProgress';
  // 月の末日（ほぼ確定の月の「◯月◯日ごろまでは」に使う）。
  const endByMonth = new Map<string, string>(
    data.periods.filter((item) => item.kind === 'month').map((item) => [item.id, item.end]),
  );
  // 数え始めた月。月の途中から数えているときだけ、注記を添える。
  const start = splitYmd(data.meta.measureStart);
  const startMonth: MonthId = `m${start.year}-${String(start.month).padStart(2, '0')}`;
  const isPartialStart = start.day > 1;
  const partialText = t('s06b.partial', { month: longLabel(startMonth), day: start.day });
  const showsPartialNote =
    isPartialStart &&
    wideMonths.some((month) => month === startMonth || yoyOf(month) === startMonth);

  // その月に行がないカテゴリは 0 として描く（月そのものがないときは、列を作らない）。
  const valueOf = (category: Category, month: MonthId): number =>
    data.pvByMonth[category.id]?.[month] ?? 0;

  /** 選んだマスの文。「2026 年 10 月 イベント: 820 回。去年の同じ月と比べて ▲ +130」。 */
  const describe = (category: Category | undefined, month: MonthId | undefined): string => {
    if (category === undefined || month === undefined) return '';
    const label = longLabel(month);
    const progress = progressOf(month);
    const value = valueOf(category, month);
    const text = t('s06b.cell', {
      month: formatMonthWithProgress(label, progress),
      category: category.name,
      count: formatNumber(value),
    });
    // 途中までの月は、去年の 1 か月分と比べない（月が終わってから比べる）。
    if (progress === 'inProgress') return t('s06b.cell.unconfirmed', { text });
    const yoyMonth = yoyOf(month);
    const hasYoy = data.months.includes(yoyMonth) || data.yoyMonths.includes(yoyMonth);
    const withYoy = !hasYoy
      ? t('s06b.cell.noYoy', { text, absent: t('absent.yoy') })
      : isPartialStart && yoyMonth === startMonth
        ? // 去年の同じ月が数え始めた月: 日数がそろわないので、差を出さずに数字を並べる（助言 B-2）。
          t('s06b.cell.partialYoy', {
            text,
            day: start.day,
            count: formatNumber(valueOf(category, yoyMonth)),
          })
        : t('s06b.cell.yoy', {
            text,
            label: t('compare.yoy'),
            diff: diffText(compare(value, valueOf(category, yoyMonth))),
          });
    const withStart =
      isPartialStart && month === startMonth
        ? t('s06b.cell.note', { text: withYoy, note: partialText })
        : withYoy;
    // 月は終わったが、月末から 7 日たつまでは数字を取り直している。
    const monthEnd = endByMonth.get(month);
    return progress === 'settling' && monthEnd !== undefined
      ? t('s06b.cell.note', {
          text: withStart,
          note: t('s06b.settling', { date: formatSettlingUntil(monthEnd) }),
        })
      : withStart;
  };

  /** 最初に選んでおく月: 終わっている月のうち、いちばん新しい月。 */
  const defaultMonthIndex = (months: readonly MonthId[]): number => {
    for (let index = months.length - 1; index >= 0; index -= 1) {
      const month = months[index];
      if (month !== undefined && progressOf(month) !== 'inProgress') return index;
    }
    return Math.max(0, months.length - 1);
  };

  const labelEvery = (months: readonly MonthId[]): number =>
    months.length > NARROW_MONTHS ? LABEL_EVERY_WHEN_LONG : 1;

  /** 行 = カテゴリ、列 = 月の図。 */
  const byCategory = (months: readonly MonthId[]) => (
    <Heatmap
      key={axis}
      title={t('s06b.chart.title')}
      rowLabels={categories.map((category) => category.name)}
      colLabels={months.map(shortLabel)}
      values={categories.map((category) => months.map((month) => valueOf(category, month)))}
      cellText={(cell: HeatmapCell) => describe(categories[cell.row], months[cell.col])}
      hint={t('s06b.tap.hint')}
      legend={t('s06b.legend')}
      defaultCell={{ row: 0, col: defaultMonthIndex(months) }}
      colLabelEvery={labelEvery(months)}
    />
  );

  /** 行 = 月、列 = カテゴリの図（狭い画面の親カテゴリ）。 */
  const byMonth = (months: readonly MonthId[]) => (
    <Heatmap
      key={axis}
      title={t('s06b.chart.title')}
      rowLabels={months.map(shortLabel)}
      colLabels={categories.map((category) => category.name)}
      values={months.map((month) => categories.map((category) => valueOf(category, month)))}
      cellText={(cell: HeatmapCell) => describe(categories[cell.col], months[cell.row])}
      hint={t('s06b.tap.hint')}
      legend={t('s06b.legend')}
      defaultCell={{ row: defaultMonthIndex(months), col: 0 }}
    />
  );

  const hasData = categories.length > 0 && wideMonths.length > 0;

  return (
    <>
      <h1>{t('s06b.h1')}</h1>
      <div className={styles.toolbar}>
        <div className={styles.segment} role="group" aria-label={t('s06b.axis.label')}>
          <span className={styles.segmentLabel} aria-hidden="true">
            {t('s06b.axis.label')}
          </span>
          {AXIS_KEYS.map((key) => (
            <button
              key={key}
              type="button"
              className={styles.button}
              aria-pressed={key === axis}
              onClick={() => update({ axis: key })}
            >
              {t(`s06b.axis.${key}`)}
            </button>
          ))}
        </div>
        <p className={styles.fixedPeriod}>
          <span className={parts.wideOnly}>{t('s06b.period.wide')}</span>
          <span className={parts.narrowOnly}>{t('s06b.period.narrow')}</span>
        </p>
      </div>
      <p className={parts.nav}>
        <Link href="/categories" prefetch={false} className={parts.link}>
          {t('s06.h1')}
        </Link>
      </p>
      {!hasData ? (
        <StateMessage kind="empty" />
      ) : (
        <>
          <div className={cx(styles.figure, parts.wideOnly)} data-view="wide">
            {byCategory(wideMonths)}
          </div>
          <div className={cx(styles.figure, parts.narrowOnly)} data-view="narrow">
            {axis === 'parent' ? (
              byMonth(narrowMonths)
            ) : (
              <>
                <Notice>{t('s06b.scroll')}</Notice>
                <div className={styles.scroll}>
                  <div className={styles.scrollInner}>{byCategory(narrowMonths)}</div>
                </div>
              </>
            )}
          </div>
          {showsPartialNote ? (
            <Notice>
              {t('s06b.partial.note', {
                date: formatDate(data.meta.measureStart),
                month: longLabel(startMonth),
                day: start.day,
              })}
            </Notice>
          ) : null}
          <Details summary={t('s06b.table.summary')}>
            {axis === 'child' ? <Notice>{t('s06b.scroll')}</Notice> : null}
            <div className={axis === 'child' ? parts.scroll : undefined}>
              <table className={parts.table}>
                <caption className={a11y.srOnly}>{t('s06b.table.caption')}</caption>
                <thead>
                  <tr>
                    <th scope="col" className={parts.head}>
                      {t('column.month')}
                    </th>
                    {categories.map((category) => (
                      <th
                        key={category.id}
                        scope="col"
                        className={cx(parts.head, parts.numeric, axis === 'child' && parts.nowrap)}
                      >
                        {category.name}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {[...wideMonths].reverse().map((month) => (
                    <tr key={month}>
                      <th scope="row" className={cx(parts.cell, parts.nowrap)}>
                        {formatMonthWithProgress(shortLabel(month), progressOf(month))}
                      </th>
                      {categories.map((category) => (
                        <td key={category.id} className={cx(parts.cell, parts.numeric)}>
                          {formatNumber(valueOf(category, month))}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Details>
        </>
      )}
    </>
  );
}
