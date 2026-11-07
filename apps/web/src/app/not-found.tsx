import Link from 'next/link';

import { t } from '@/lib/ui-text';

import styles from './not-found.module.css';

// 404 は固定文だけを出す（05 §10、06 §7、NFR-91）。内部の情報を出さない。
// 更新の状況（DataStatus）は、レイアウトがほかのページと同じ位置に出す。共通の説明（CommonNotes）は出さない。
//
// data-page="not-found" は 404 の印（src/components/useRenderedPathname.ts）。/articles/999999 のように画面の
// パスの形をした 404 でも、ヘッダと共通の説明が、静的な HTML を作ったときと同じパスで中身を選ぶ。
export default function NotFound() {
  return (
    <>
      <h1 data-page="not-found">{t('notFound.h1')}</h1>
      <p>{t('notFound.lead')}</p>
      <p>{t('notFound.reasons.lead')}</p>
      <ul>
        <li>{t('notFound.reason.notYet')}</li>
        <li>{t('notFound.reason.removed')}</li>
        <li>{t('notFound.reason.url')}</li>
      </ul>
      <ul className={styles.links}>
        <li>
          <Link href="/" prefetch={false} className={styles.link}>
            {t('notFound.link.dashboard')}
          </Link>
        </li>
        <li>
          <Link href="/articles" prefetch={false} className={styles.link}>
            {t('notFound.link.search')}
          </Link>
        </li>
        <li>
          <Link href="/authors" prefetch={false} className={styles.link}>
            {t('notFound.link.authors')}
          </Link>
        </li>
      </ul>
    </>
  );
}
