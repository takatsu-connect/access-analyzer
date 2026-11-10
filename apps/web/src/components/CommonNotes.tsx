'use client';

import type { ReactNode } from 'react';

import { notesFor } from '@/lib/common-notes';
import type { NoteId } from '@/lib/common-notes';
import { MEASURE_START } from '@/lib/config';
import { formatDate } from '@/lib/format';
import { t } from '@/lib/ui-text';

import styles from './CommonNotes.module.css';
import { Details } from './Details';
import { useRenderedPathname } from './useRenderedPathname';

const HEADING_ID = 'common-notes-heading';

export type CommonNotesViewProps = {
  /** 出す項目（src/lib/common-notes.ts の notesFor の結果）。空なら何も出さない。 */
  notes: readonly NoteId[];
  /** 読まれた回数を数え始めた日（meta.measureStart）。省くと設定値 MEASURE_START。 */
  measureStart?: string;
};

/** 項目 1 つの中身。 */
function noteBody(id: NoteId, start: string): ReactNode {
  switch (id) {
    case 'pageviews':
      return t('notes.pageviews');
    case 'measureStart':
      return (
        <>
          {t('notes.measureStart', { start })}
          <Details summary={t('notes.more')}>{t('notes.measureStart.detail', { start })}</Details>
        </>
      );
    case 'masked':
      return t('notes.masked');
    case 'band':
      return (
        <>
          {t('notes.band')}
          <Details summary={t('notes.more')}>{t('notes.band.detail')}</Details>
        </>
      );
    case 'bandAll':
      return (
        <>
          {t('notes.band')}
          <Details summary={t('notes.more')}>{t('notes.band.detail.all')}</Details>
        </>
      );
    case 'bandAuthor':
      return (
        <>
          {t('notes.band')}
          <Details summary={t('notes.more')}>{t('notes.band.detail.author')}</Details>
        </>
      );
    case 'ratio':
      return t('notes.ratio');
    case 'source':
      return t('notes.source');
    case 'posting':
      return t('notes.posting');
  }
}

/**
 * 共通の説明文（05 §2.7）の見た目。渡された項目だけを描く。項目が 0 なら折りたたみごと出さない。
 *
 * 閉じた折りたたみで出す。見出し（h2）が summary で、押すと項目が開く（レビュー C-6。依頼者の判断）。
 * 操作はブラウザの details に任せる。
 */
export function CommonNotesView({ notes, measureStart = MEASURE_START }: CommonNotesViewProps) {
  if (notes.length === 0) return null;
  const start = formatDate(measureStart);
  return (
    <section className={styles.notes} aria-labelledby={HEADING_ID}>
      <details className={styles.fold}>
        <summary className={styles.summary}>
          <h2 id={HEADING_ID} className={styles.heading}>
            {t('notes.h2')}
          </h2>
        </summary>
        <ul className={styles.list}>
          {notes.map((id) => (
            <li key={id} data-note={id}>
              {noteBody(id, start)}
            </li>
          ))}
        </ul>
      </details>
    </section>
  );
}

export type CommonNotesProps = Omit<CommonNotesViewProps, 'notes'>;

/**
 * 共通の説明文。レイアウト（src/app/layout.tsx）が本文の後（フッタの直上）に 1 つ置く。ページの側には置かない。
 * 出す項目は、いまのパスから src/lib/common-notes.ts の表で選ぶ（助言 A-2）。
 * 全ページを generateStaticParams で静的生成しているので、パスはビルド時に決まり、静的な HTML に項目が入る。
 * 一覧にない ID の 404 で、ブラウザのパスと静的な HTML が食い違わないよう、useRenderedPathname を使う。
 */
export function CommonNotes({ measureStart }: CommonNotesProps) {
  const pathname = useRenderedPathname();
  return <CommonNotesView notes={notesFor(pathname)} measureStart={measureStart} />;
}
