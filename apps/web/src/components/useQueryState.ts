'use client';

import { useCallback, useMemo, useSyncExternalStore } from 'react';

import { parseQuery, toQueryString } from '@/lib/query';
import type { QueryAllow, QueryState } from '@/lib/query';

/** replaceState は popstate を起こさないので、書き戻したことを自分で知らせる。 */
const QUERY_CHANGE_EVENT = 'access-analyzer:query-change';

function subscribe(onChange: () => void): () => void {
  window.addEventListener('popstate', onChange);
  window.addEventListener(QUERY_CHANGE_EVENT, onChange);
  return () => {
    window.removeEventListener('popstate', onChange);
    window.removeEventListener(QUERY_CHANGE_EVENT, onChange);
  };
}

function getSearch(): string {
  return window.location.search;
}

/** 静的生成の HTML は、クエリなし（既定の状態）で描く。 */
function getServerSearch(): string {
  return '';
}

/** 状態の一部を差し替える関数。渡した値も書き戻す前に検証される。 */
export type QueryStateUpdate = (patch: Partial<QueryState>) => void;

export type UseQueryStateResult = {
  /** 検証済みの状態。サーバーと最初の描画では既定値（期間は直近 28 日）。 */
  state: QueryState;
  /** 状態を変えて、URL に書き戻す（history.replaceState）。 */
  update: QueryStateUpdate;
};

/**
 * URL のクエリで表示の状態を持つ（04 §8、05 §2.5）。
 *
 * - Next.js の useSearchParams は使わない（静的なページの中身がクライアント描画に切り替わり、
 *   HTML が空になる）。静的な HTML は既定の状態で描き、マウント後に location.search を読む。
 * - 読むときも書くときも parseQuery / toQueryString を通す。許可されない値は既定値になり、
 *   未知のパラメータと既定値は URL に書かない。
 * - 戻る・進む（popstate）にも追従する。
 *
 * @param allow 画面の種類と許可リスト。呼び出し側で useMemo して、同じ参照を渡す。
 */
export function useQueryState(allow: QueryAllow): UseQueryStateResult {
  const search = useSyncExternalStore(subscribe, getSearch, getServerSearch);
  const state = useMemo(() => parseQuery(search, allow), [search, allow]);

  const update = useCallback<QueryStateUpdate>(
    (patch) => {
      const current = parseQuery(window.location.search, allow);
      const query = toQueryString({ ...current, ...patch }, allow);
      // いまの URL から作る（パスの連結だと、// で始まるパスが別のホストに読まれる。監査 L-1）。
      const url = new URL(window.location.href);
      url.search = query;
      // 第 1 引数は null（Next.js のルーターが URL の変化を取り込む形）。
      window.history.replaceState(null, '', url);
      window.dispatchEvent(new Event(QUERY_CHANGE_EVENT));
    },
    [allow],
  );

  return useMemo(() => ({ state, update }), [state, update]);
}
