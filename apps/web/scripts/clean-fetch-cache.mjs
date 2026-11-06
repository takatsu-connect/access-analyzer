/**
 * ビルドの前に、Next.js の fetch のキャッシュ（.next/cache/fetch-cache）を消す。
 *
 * ビルド時に Supabase の公開ビューを fetch で読むと、Next.js はその応答を fetch-cache に残し、
 * 次のビルドで同じ問い合わせに使い回す。データが日次で変わってもキャッシュの応答が使われ、
 * ページごとに古い時点のデータが混ざる（2026-11-06 の E2E で、60 ページ中 41 ページが前回の時点だった）。
 * fetch に cache: 'no-store' を付けるとページが静的生成でなくなるので、キャッシュのほうを消す。
 * Vercel は .next/cache をビルド間で引き継ぐので、package.json の prebuild から必ず呼ぶ。
 */
import { rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const target = fileURLToPath(new URL('../.next/cache/fetch-cache', import.meta.url));
rmSync(target, { recursive: true, force: true });
process.stdout.write('fetch-cache を消しました（ビルドのたびに公開ビューを読み直す）。\n');
