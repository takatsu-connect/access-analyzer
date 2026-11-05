/**
 * Supabase のクライアント（ビルド時だけ使う。docs/design/04_api.md §2、06 §3）。
 *
 * - 接続先とキーは SUPABASE_URL と SUPABASE_ANON_KEY から読む。ブラウザに渡る名前の変数は使わない。
 * - セッションを保存しない（ビルドのたびに読み切りで使う）。
 * - 値をログやエラーに出さない。エラーに入れるのは変数の名前だけ。
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export type PubClient = SupabaseClient;

type Env = Record<string, string | undefined>;

/** 設定が足りないときのエラー。変数の名前だけを持つ。 */
export class PubConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PubConfigError';
  }
}

export function createPubClient(env: Env = process.env): PubClient {
  const { SUPABASE_URL: url, SUPABASE_ANON_KEY: anonKey } = env;
  const missing = [
    url === undefined || url === '' ? 'SUPABASE_URL' : null,
    anonKey === undefined || anonKey === '' ? 'SUPABASE_ANON_KEY' : null,
  ].filter((name) => name !== null);
  if (url === undefined || url === '' || anonKey === undefined || anonKey === '') {
    throw new PubConfigError(`環境変数が設定されていません: ${missing.join(', ')}`);
  }

  try {
    return createClient(url, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
  } catch {
    // ライブラリのエラーは値を含みうるので、固定の文に置き換える。
    throw new PubConfigError(
      '環境変数 SUPABASE_URL または SUPABASE_ANON_KEY の形式が正しくありません',
    );
  }
}
