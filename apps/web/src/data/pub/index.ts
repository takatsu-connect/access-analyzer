/**
 * 読み出し層（docs/design/04_api.md §5）。Supabase の公開ビューを読むのは、このディレクトリだけ。
 */
export { createPubClient, PubConfigError } from './client';
export * from './load';
