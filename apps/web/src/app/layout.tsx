import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import { CommonNotes } from '@/components/CommonNotes';
import { DataStatus } from '@/components/DataStatus';
import { SiteFooter } from '@/components/SiteFooter';
import { SiteHeader } from '@/components/SiteHeader';
import { SkipLink } from '@/components/SkipLink';
import { getPageMeta } from '@/data';
import { uiText } from '@/lib/ui-text';

import './globals.css';
import styles from './layout.module.css';

/** スキップリンクの行き先（main の id）。 */
const MAIN_ID = 'main';

// 全ページを検索エンジンに載せない（NFR-21、05 §2.7）。応答ヘッダの X-Robots-Tag と二重にする。
export const metadata: Metadata = {
  title: uiText.site.title,
  robots: { index: false, follow: false },
};

// 全ページ共通の枠（05 §1、§2.7）: スキップリンク、ヘッダ、DataStatus、main、CommonNotes、フッタ。
//
// 決まり: DataStatus（データの日付と更新の状況）と CommonNotes（共通の説明文）は、ここが
// 全ページ（404 を含む）に 1 つずつ出す。ページの側（page.tsx、not-found.tsx）には置かない。
// main もここが持つので、ページは main を書かず、フラグメントを返す。
export default async function RootLayout({ children }: { children: ReactNode }) {
  // ビルド時に 1 回だけ読む（静的生成）。DataStatus は Client Component なので、使う値だけを渡す。
  const { baseDate, finishedAt, isStale, measureStart } = await getPageMeta();
  return (
    <html lang="ja">
      <body>
        <SkipLink targetId={MAIN_ID} />
        <SiteHeader />
        <div className={styles.beforeMain}>
          <DataStatus meta={{ baseDate, finishedAt, isStale }} />
        </div>
        <main id={MAIN_ID} tabIndex={-1} className={styles.main}>
          {children}
        </main>
        <div className={styles.afterMain}>
          <CommonNotes measureStart={measureStart} />
        </div>
        <SiteFooter />
      </body>
    </html>
  );
}
