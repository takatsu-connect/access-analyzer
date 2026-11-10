'use client';

import { useId, useState } from 'react';
import type { KeyboardEvent } from 'react';

import { formatNumber } from '@/lib/format';
import { t } from '@/lib/ui-text';

import { percent, round2 } from './geometry';
import { heatLevels } from './heat-levels';
import type { HeatLevel } from './heat-levels';
import styles from './Heatmap.module.css';
import type { HeatmapCell, HeatmapProps } from './types';

// 縦の寸法（px）。Heatmap.module.css の --heatmap-header と --heatmap-cell と同じ値にする。
const HEADER_HEIGHT = 18;
const CELL_HEIGHT = 28;
const HEADER_BASELINE = 12;
const LEVELS: readonly HeatLevel[] = [1, 2, 3, 4, 5];
const SWATCH_SIZE = 12;

const LEVEL_CLASS: Record<HeatLevel, string | undefined> = {
  1: styles.shade1,
  2: styles.shade2,
  3: styles.shade3,
  4: styles.shade4,
  5: styles.shade5,
};

type Position = { row: number; col: number };

/** 既定のセル: 値がいちばん大きいセル（最初に見つかったもの）。値がなければ左上。 */
function largestCell(values: readonly (readonly (number | null)[])[]): Position {
  let best: Position = { row: 0, col: 0 };
  let bestValue = -Infinity;
  values.forEach((cells, row) => {
    cells.forEach((value, col) => {
      if (value !== null && value > bestValue) {
        best = { row, col };
        bestValue = value;
      }
    });
  });
  return best;
}

/**
 * 格子のヒートマップ（05 §2.8。S-01 の曜日 × 時間帯、S-06b の月 × カテゴリ）。
 *
 * - セルは、伏せ値を除いた値の分位で 5 段階の濃淡。分位を取る範囲は scale（表全体 / 行ごと / 列ごと）。
 *   伏せ値のセルは面の色（白）と「—」。
 * - セルの中の数字は広い画面だけ（CSS で隠す）。選んだセルの値は、図の下の固定行に出す。
 *   固定行は最初から埋まっている。
 * - rowMeans / colMeans を渡すと、右端に行ごとの平均の列、下端に列ごとの平均の行を足す。
 *   平均のマスは濃淡を付けず、数字は狭い画面でも出す。選ぶと固定行に出る。右下の角は空ける。
 */
export function Heatmap({
  title,
  rowLabels,
  colLabels,
  values,
  cellText,
  hint,
  legend,
  defaultCell,
  formatValue = formatNumber,
  colLabelEvery = 1,
  scale = 'all',
  rowMeans,
  colMeans,
  formatMean = formatValue,
}: HeatmapProps) {
  const fixedRowId = useId();
  const [selected, setSelected] = useState<Position | null>(null);

  const rowCount = rowLabels.length;
  const colCount = colLabels.length;
  if (rowCount === 0 || colCount === 0) return null;

  // 平均の列・行を含めた格子の大きさ。
  const totalRows = rowCount + (colMeans === undefined ? 0 : 1);
  const totalCols = colCount + (rowMeans === undefined ? 0 : 1);
  const isCorner = (position: Position): boolean =>
    position.row >= rowCount && position.col >= colCount;

  const kindOf = (position: Position): HeatmapCell['kind'] => {
    if (position.col >= colCount) return 'rowMean';
    if (position.row >= rowCount) return 'colMean';
    return 'cell';
  };
  const valueAt = (position: Position): number | null => {
    const kind = kindOf(position);
    if (kind === 'rowMean') return rowMeans?.values[position.row] ?? null;
    if (kind === 'colMean') return colMeans?.values[position.col] ?? null;
    return values[position.row]?.[position.col] ?? null;
  };
  const inRange = (position: Position | null | undefined): position is Position =>
    position !== null &&
    position !== undefined &&
    position.row >= 0 &&
    position.row < totalRows &&
    position.col >= 0 &&
    position.col < totalCols &&
    !isCorner(position);
  const inGrid = (position: Position | null | undefined): position is Position =>
    inRange(position) && position.row < rowCount && position.col < colCount;
  // 選んだセルが格子の外になったら（行や列の数が変わったら）、既定のセルに戻る。
  const fallback = inGrid(defaultCell) ? defaultCell : largestCell(values);
  const current = inRange(selected) ? selected : fallback;

  const levels = heatLevels(values, scale);
  const hasMasked = values.some((cells) => cells.some((value) => value === null));
  const cellWidth = 100 / totalCols;
  const leftOf = (col: number): number => round2(col * cellWidth);
  const centerOf = (col: number): number => round2((col + 0.5) * cellWidth);
  const topOf = (row: number): number => HEADER_HEIGHT + row * CELL_HEIGHT;

  const currentKind = kindOf(current);
  const currentCell: HeatmapCell = {
    kind: currentKind,
    row: current.row,
    col: current.col,
    rowLabel: currentKind === 'colMean' ? (colMeans?.label ?? '') : (rowLabels[current.row] ?? ''),
    colLabel: currentKind === 'rowMean' ? (rowMeans?.label ?? '') : (colLabels[current.col] ?? ''),
    value: valueAt(current),
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    let next: Position | null = null;
    if (event.key === 'ArrowLeft') next = { row: current.row, col: current.col - 1 };
    else if (event.key === 'ArrowRight') next = { row: current.row, col: current.col + 1 };
    else if (event.key === 'ArrowUp') next = { row: current.row - 1, col: current.col };
    else if (event.key === 'ArrowDown') next = { row: current.row + 1, col: current.col };
    else if (event.key === 'Home') next = { row: current.row, col: 0 };
    else if (event.key === 'End') {
      // 平均の行（下端）では、右端は角なので、最後の列にする。
      const last = current.row >= rowCount ? colCount - 1 : totalCols - 1;
      next = { row: current.row, col: last };
    }
    if (next === null) return;
    event.preventDefault();
    if (inRange(next)) setSelected(next);
  };

  /** 平均のマス（濃淡なし、数字は常に出す）。 */
  const meanCell = (position: Position, key: string) => {
    const value = valueAt(position);
    return (
      <g key={key}>
        <rect
          className={`${styles.cell} ${styles.mean}`}
          data-part="mean-cell"
          data-kind={kindOf(position)}
          data-row={position.row}
          data-col={position.col}
          x={percent(leftOf(position.col))}
          y={topOf(position.row)}
          width={percent(cellWidth)}
          height={CELL_HEIGHT}
          onClick={() => setSelected(position)}
        />
        <text
          className={value === null ? styles.maskedMark : styles.meanValue}
          data-part={value === null ? 'masked-mark' : 'mean-value'}
          x={percent(centerOf(position.col))}
          y={topOf(position.row) + CELL_HEIGHT / 2}
          textAnchor="middle"
          dominantBaseline="central"
        >
          {value === null ? t('masked.dash') : formatMean(value)}
        </text>
      </g>
    );
  };

  return (
    <div className={styles.chart}>
      <div className={styles.grid}>
        <div className={styles.rowLabels} aria-hidden="true">
          {rowLabels.map((label, row) => (
            <span key={`${row}-${label}`} className={styles.rowLabel}>
              {label}
            </span>
          ))}
          {colMeans === undefined ? null : (
            <span className={`${styles.rowLabel} ${styles.meanLabel}`} data-part="mean-row-label">
              {colMeans.label}
            </span>
          )}
        </div>
        <div
          className={styles.plot}
          role="group"
          tabIndex={0}
          aria-label={title}
          aria-describedby={fixedRowId}
          onKeyDown={onKeyDown}
        >
          <svg className={styles.svg} role="img" height={HEADER_HEIGHT + totalRows * CELL_HEIGHT}>
            <title>{title}</title>
            {colLabels.map((label, col) =>
              col % colLabelEvery === 0 ? (
                <text
                  key={`${col}-${label}`}
                  className={styles.colLabel}
                  data-part="col-label"
                  x={percent(centerOf(col))}
                  y={HEADER_BASELINE}
                  textAnchor="middle"
                >
                  {label}
                </text>
              ) : null,
            )}
            {rowMeans === undefined ? null : (
              <text
                className={`${styles.colLabel} ${styles.meanLabel}`}
                data-part="mean-col-label"
                x={percent(centerOf(colCount))}
                y={HEADER_BASELINE}
                textAnchor="middle"
              >
                {rowMeans.label}
              </text>
            )}
            {rowLabels.map((rowLabel, row) =>
              colLabels.map((colLabel, col) => {
                const value = valueAt({ row, col });
                const level = levels[row]?.[col] ?? null;
                const levelClass = level === null ? styles.masked : LEVEL_CLASS[level];
                return (
                  <g key={`${row}-${col}`}>
                    <rect
                      className={`${styles.cell} ${levelClass}`}
                      data-part="cell"
                      data-row={row}
                      data-col={col}
                      data-level={level ?? 'masked'}
                      x={percent(leftOf(col))}
                      y={topOf(row)}
                      width={percent(cellWidth)}
                      height={CELL_HEIGHT}
                      onClick={() => setSelected({ row, col })}
                    />
                    {value === null ? (
                      <text
                        className={styles.maskedMark}
                        data-part="masked-mark"
                        x={percent(centerOf(col))}
                        y={topOf(row) + CELL_HEIGHT / 2}
                        textAnchor="middle"
                        dominantBaseline="central"
                      >
                        {t('masked.dash')}
                      </text>
                    ) : (
                      <text
                        className={`${styles.cellValue} ${
                          level !== null && level >= 4 ? styles.onStrong : styles.onWeak
                        }`}
                        data-part="cell-value"
                        x={percent(centerOf(col))}
                        y={topOf(row) + CELL_HEIGHT / 2}
                        textAnchor="middle"
                        dominantBaseline="central"
                      >
                        {formatValue(value)}
                      </text>
                    )}
                  </g>
                );
              }),
            )}
            {rowMeans === undefined
              ? null
              : rowLabels.map((_, row) => meanCell({ row, col: colCount }, `mean-row-${row}`))}
            {colMeans === undefined
              ? null
              : colLabels.map((_, col) => meanCell({ row: rowCount, col }, `mean-col-${col}`))}
            <rect
              className={styles.selected}
              data-part="selected"
              x={percent(leftOf(current.col))}
              y={topOf(current.row)}
              width={percent(cellWidth)}
              height={CELL_HEIGHT}
            />
          </svg>
        </div>
      </div>
      <p className={styles.hint}>{hint}</p>
      <p id={fixedRowId} className={styles.fixedRow} data-part="fixed-row" aria-live="polite">
        {cellText(currentCell)}
      </p>
      <ul className={styles.legend}>
        <li className={styles.legendItem}>
          <svg
            className={styles.swatch}
            aria-hidden="true"
            width={SWATCH_SIZE * LEVELS.length}
            height={SWATCH_SIZE}
          >
            {LEVELS.map((level) => (
              <rect
                key={level}
                className={LEVEL_CLASS[level]}
                x={(level - 1) * SWATCH_SIZE}
                y={0}
                width={SWATCH_SIZE}
                height={SWATCH_SIZE}
              />
            ))}
          </svg>
          <span>{legend}</span>
        </li>
        {hasMasked ? (
          <li className={styles.legendItem} data-part="legend-masked">
            {t('legend.masked')}
          </li>
        ) : null}
      </ul>
    </div>
  );
}
