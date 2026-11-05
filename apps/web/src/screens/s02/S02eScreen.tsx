'use client';

import { useMemo, useState } from 'react';

import { ArticleTable } from '@/components/ArticleTable';
import type { ArticleColumnId } from '@/components/ArticleTable';
import { StateMessage } from '@/components/Notice';
import { PeriodPicker } from '@/components/PeriodPicker';
import { resolvePeriod } from '@/components/usePeriod';
import { useQueryState } from '@/components/useQueryState';
import { formatNumber, formatYearMonth } from '@/lib/format';
import type { ArticleListData } from '@/lib/page-data';
import { parseQuery } from '@/lib/query';
import type { QueryAllow } from '@/lib/query';
import { t } from '@/lib/ui-text';

import { PreMeasureNote } from './PreMeasureNote';
import { publishedMonths, searchRows } from './rows';
import styles from './s02.module.css';

const COLUMNS: readonly ArticleColumnId[] = [
  'title',
  'author',
  'publishedOn',
  'pageviews',
  'pv7',
  'pv30',
  'category',
];
/** 狭い画面の 4 列（05 §4.5）。残りは行の末尾の「詳しく」に入る。 */
const NARROW_COLUMNS: readonly ArticleColumnId[] = ['title', 'publishedOn', 'pageviews', 'pv30'];
/** 検索語の長さの上限（04 §8）。 */
const SEARCH_MAX_LENGTH = 50;

/**
 * S-02e 記事を探す（05 §4.5、FR-24）。data は getArticleListData('search')。
 *
 * - 絞り込みと検索語は URL のクエリで持つ。選択肢も URL の値も、埋め込んだ一覧にあるものだけ。
 * - 並べ替えの操作は、著者・子カテゴリ・公開年月のどれかで絞ったときだけ描く（多い順だけ。NFR-98）。
 *   それ以外は公開日の新しい順で固定する（URL の sort は parseQuery が落とす）。
 */
export function S02eScreen({ data }: { data: ArticleListData }) {
  const months = useMemo(() => publishedMonths(data.posts), [data.posts]);
  const allow = useMemo<QueryAllow>(
    () => ({
      screen: 's02e',
      periodIds: data.periods.map((period) => period.id),
      categories: data.categories,
      authorSlugs: data.authors.map((author) => author.slug),
      publishedMonths: months,
    }),
    [data.periods, data.categories, data.authors, months],
  );
  const { state, update } = useQueryState(allow);
  const { q, cat, author, ym } = state;
  const { period } = resolvePeriod(data.periods, state.p);
  const periodId = period?.id ?? null;

  // 入力欄の文字は、打ったまま持つ（URL の q は前後の空白を除いた形なので、そのまま戻すと
  // 語の間の空白が打てない）。URL の側が変わったとき（戻る・進む、「条件を消す」）だけ合わせる。
  const [draft, setDraft] = useState({ text: q ?? '', q });
  if (draft.q !== q) {
    const typed = parseQuery(new URLSearchParams({ q: draft.text }), allow).q;
    setDraft({ text: typed === q ? draft.text : (q ?? ''), q });
  }

  const rows = useMemo(
    () => searchRows(data, periodId, { q, cat, author, ym }),
    [data, periodId, q, cat, author, ym],
  );

  if (periodId === null) {
    return (
      <>
        <h1>{t('s02e.h1')}</h1>
        <StateMessage kind="empty" />
      </>
    );
  }

  const selectedCategory =
    cat === null ? undefined : data.categories.find((category) => category.id === cat);
  // 04 §8 の sort の規則と同じ条件。親カテゴリだけ、絞り込みなしのときは並べ替えを描かない。
  const isNarrowed =
    author !== null ||
    ym !== null ||
    (selectedCategory !== undefined && selectedCategory.parentId !== null);
  const hasCondition = q !== null || cat !== null || author !== null || ym !== null;

  return (
    <>
      <h1>{t('s02e.h1')}</h1>
      <PeriodPicker periods={data.periods} value={periodId} onChange={(id) => update({ p: id })} />
      <div className={styles.filters} role="group" aria-label={t('s02e.filter.label')}>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>{t('s02e.filter.q')}</span>
          <input
            className={styles.input}
            type="search"
            value={draft.text}
            maxLength={SEARCH_MAX_LENGTH}
            onChange={(event) => {
              const text = event.currentTarget.value;
              setDraft((previous) => ({ ...previous, text }));
              update({ q: text === '' ? null : text });
            }}
          />
        </label>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>{t('s02e.filter.category')}</span>
          <select
            className={styles.select}
            value={cat === null ? '' : String(cat)}
            onChange={(event) => {
              const value = event.currentTarget.value;
              update({ cat: value === '' ? null : Number(value) });
            }}
          >
            <option value="">{t('s02e.filter.all')}</option>
            {data.categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.path}
              </option>
            ))}
          </select>
        </label>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>{t('s02e.filter.author')}</span>
          <select
            className={styles.select}
            value={author ?? ''}
            onChange={(event) => {
              const value = event.currentTarget.value;
              update({ author: value === '' ? null : value });
            }}
          >
            <option value="">{t('s02e.filter.all')}</option>
            {data.authors.map((item) => (
              <option key={item.slug} value={item.slug}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>{t('s02e.filter.ym')}</span>
          <select
            className={styles.select}
            value={ym ?? ''}
            onChange={(event) => {
              const value = event.currentTarget.value;
              update({ ym: value === '' ? null : value });
            }}
          >
            <option value="">{t('s02e.filter.all')}</option>
            {months.map((month) => (
              <option key={month} value={month}>
                {formatYearMonth(month)}
              </option>
            ))}
          </select>
        </label>
        <div className={styles.clear}>
          <button
            type="button"
            className={styles.button}
            disabled={!hasCondition}
            onClick={() =>
              update({ q: null, cat: null, author: null, ym: null, sort: 'published' })
            }
          >
            {t('s02e.filter.clear')}
          </button>
        </div>
      </div>
      <div className={styles.summary}>
        <p className={styles.resultCount} role="status">
          {t('s02e.count', { n: formatNumber(rows.length) })}
        </p>
        {isNarrowed ? null : <p className={styles.sortFixed}>{t('s02e.sort.fixed')}</p>}
      </div>
      <PreMeasureNote rows={rows} columns={COLUMNS} measureStart={data.meta.measureStart} />
      <ArticleTable
        caption={t('s02e.name')}
        rows={rows}
        columns={COLUMNS}
        narrowColumns={NARROW_COLUMNS}
        columnLabels={{ pageviews: t('column.pageviews.period') }}
        sortable={isNarrowed}
        sort={state.sort}
        onSortChange={(sort) => update({ sort })}
        emptyText={t('s02e.empty')}
      />
    </>
  );
}
