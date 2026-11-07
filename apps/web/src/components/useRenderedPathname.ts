'use client';

import { usePathname } from 'next/navigation';
import { useSyncExternalStore } from 'react';

/** 404 の画面であることの印（src/app/not-found.tsx の h1 に付ける）。 */
export const NOT_FOUND_MARKER = 'data-page';
export const NOT_FOUND_VALUE = 'not-found';
/** 404 の静的な HTML を作ったときのパス。 */
const NOT_FOUND_PATH = '/_not-found';

const noop = () => () => undefined;

function isNotFoundPage(): boolean {
  if (typeof document === 'undefined') return false;
  return document.querySelector(`[${NOT_FOUND_MARKER}="${NOT_FOUND_VALUE}"]`) !== null;
}

/**
 * 静的な HTML を作ったときと同じパスを返す。
 *
 * 全ページを静的生成していて、一覧にない ID（例 /articles/999999）には、/_not-found で作った
 * 404 の HTML が返る。そのときブラウザの usePathname は /articles/999999 を返すので、パスで
 * 中身を選ぶ部品（ヘッダのサブナビ、共通の説明文）が静的な HTML と食い違い、描き直しになる。
 * 404 の印が DOM にあるときは /_not-found とみなし、HTML を作ったときと同じ結果にそろえる。
 *
 * サーバー（ビルド）では document がないので、usePathname の値をそのまま使う。
 * ブラウザでは、ハイドレーションのときも DOM を見る（getServerSnapshot も同じ関数）。
 */
export function useRenderedPathname(): string {
  const pathname = usePathname() ?? '/';
  const notFound = useSyncExternalStore(noop, isNotFoundPage, isNotFoundPage);
  return notFound ? NOT_FOUND_PATH : pathname;
}
