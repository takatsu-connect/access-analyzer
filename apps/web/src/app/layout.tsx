import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import { SiteFooter } from '@/components/SiteFooter';
import { SiteHeader } from '@/components/SiteHeader';
import { SkipLink } from '@/components/SkipLink';
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

// 全ページ共通の枠（05 §1、§2.7）: スキップリンク、ヘッダ、main、フッタ。
// DataStatus と CommonNotes は、データを持つ各画面が main の先頭と末尾に置く。
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ja">
      <body>
        <SkipLink targetId={MAIN_ID} />
        <SiteHeader />
        <main id={MAIN_ID} tabIndex={-1} className={styles.main}>
          {children}
        </main>
        <SiteFooter />
      </body>
    </html>
  );
}
