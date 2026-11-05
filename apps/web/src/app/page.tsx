import type { Metadata } from 'next';

import { getDashboardData } from '@/data';
import { t } from '@/lib/ui-text';
import { DashboardScreen } from '@/screens/s01/DashboardScreen';

export const metadata: Metadata = { title: t('s01.name') };

// S-01 全体ダッシュボード（05 §3）。ビルド時にデータを取り、画面の部品に渡すだけ。
// main はレイアウトが持つので、画面の部品は h1 から始まるフラグメントを返す。
export default async function DashboardPage() {
  const data = await getDashboardData();
  return <DashboardScreen data={data} />;
}
