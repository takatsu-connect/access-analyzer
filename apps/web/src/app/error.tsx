'use client';

import { StateMessage } from '@/components/Notice';

// 描画中のエラーは固定文だけを出す（NFR-91）。エラーの中身、スタック、内部の URL は出さない。
export default function ErrorPage() {
  return <StateMessage kind="error" />;
}
