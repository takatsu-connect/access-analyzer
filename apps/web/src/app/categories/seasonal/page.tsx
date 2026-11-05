import type { Metadata } from 'next';

import { getSeasonalData } from '@/data';
import { t } from '@/lib/ui-text';
import { SeasonalScreen } from '@/screens/s06/SeasonalScreen';

export const metadata: Metadata = { title: t('s06b.name') };

// S-06b 月ごと × カテゴリ（05 §7.2）。ビルド時にデータを取り、画面の部品に渡すだけ。
export default async function SeasonalPage() {
  const data = await getSeasonalData();
  return <SeasonalScreen data={data} />;
}
