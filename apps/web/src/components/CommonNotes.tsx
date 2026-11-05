import { MEASURE_START } from '@/lib/config';
import { formatDate } from '@/lib/format';
import { t } from '@/lib/ui-text';

import styles from './CommonNotes.module.css';
import { Details } from './Details';

const HEADING_ID = 'common-notes-heading';

export type CommonNotesProps = {
  /** 読まれた回数を数え始めた日（meta.measureStart）。省くと設定値 MEASURE_START。 */
  measureStart?: string;
};

/**
 * 全画面共通の説明文（05 §2.7）。本文の後（フッタの直上）に、折りたたまずに出す。
 * レイアウト（src/app/layout.tsx）が全ページ（404 を含む）に 1 つ置く。ページの側には置かない。
 */
export function CommonNotes({ measureStart = MEASURE_START }: CommonNotesProps) {
  const start = formatDate(measureStart);
  return (
    <section className={styles.notes} aria-labelledby={HEADING_ID}>
      <h2 id={HEADING_ID} className={styles.heading}>
        {t('notes.h2')}
      </h2>
      <ul className={styles.list}>
        <li>{t('notes.pageviews')}</li>
        <li>
          {t('notes.measureStart', { start })}
          <Details summary={t('notes.more')}>{t('notes.measureStart.detail', { start })}</Details>
        </li>
        <li>{t('notes.masked')}</li>
        <li>
          {t('notes.band')}
          <Details summary={t('notes.more')}>{t('notes.band.detail')}</Details>
        </li>
        <li>{t('notes.ratio')}</li>
        <li>{t('notes.source')}</li>
      </ul>
    </section>
  );
}
