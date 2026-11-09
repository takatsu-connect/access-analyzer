import type { Metadata } from 'next';

import { getDashboardData } from '@/data';
import { t } from '@/lib/ui-text';
import { DashboardScreen } from '@/screens/s01/DashboardScreen';

// トップページの title はサイトの名前だけ（05 §2.7）。layout の title.template は同じ階層の
// page には効かない（Next.js の仕様）ので、雛形に頼らず absolute で名前をそのまま書く。
export const metadata: Metadata = { title: { absolute: t('site.title') } };

// S-01 全体ダッシュボード（05 §3）。ビルド時にデータを取り、画面の部品に渡すだけ。
// main はレイアウトが持つので、画面の部品は h1 から始まるフラグメントを返す。
export default async function DashboardPage() {
  const data = await getDashboardData();
  return <DashboardScreen data={data} />;
}
