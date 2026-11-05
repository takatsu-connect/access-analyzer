import type { ArticleColumnId, ArticleTableRow } from '@/components/ArticleTable';
import { Notice } from '@/components/Notice';
import { formatDate } from '@/lib/format';
import { t } from '@/lib/ui-text';

import { showsPreMeasure } from './rows';

export type PreMeasureNoteProps = {
  /** 表に渡す行と同じもの。 */
  rows: readonly ArticleTableRow[];
  /** 表に渡す列と同じもの。 */
  columns: readonly ArticleColumnId[];
  /** meta.measureStart（'YYYY-MM-DD'）。 */
  measureStart: string;
};

/**
 * 表の上に置く 1 行の注記（助言 2026-11-05 §4）。
 * 表に「数え始める前」と書かれるセルがあるときだけ出す。
 */
export function PreMeasureNote({ rows, columns, measureStart }: PreMeasureNoteProps) {
  if (!showsPreMeasure(rows, columns)) return null;
  return <Notice>{t('list.preMeasure.note', { start: formatDate(measureStart) })}</Notice>;
}
