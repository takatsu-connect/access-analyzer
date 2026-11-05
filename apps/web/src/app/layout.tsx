import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import { uiText } from '@/lib/ui-text';

import './globals.css';

// 全ページを検索エンジンに載せない（NFR-21、05 §2.7）。応答ヘッダの X-Robots-Tag と二重にする。
export const metadata: Metadata = {
  title: uiText.site.title,
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}
