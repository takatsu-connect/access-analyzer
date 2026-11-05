// E-18（データ更新の遅れ）の spec だけを、E2E_STALE=1 を付けて流す（07 §6）。
//
// 先に、遅れたフィクスチャ（load_e2e_fixture --stale）を読み込み、pnpm run build をしておく。
// 終わったら、--stale なしで読み込み直し、ビルドをやり直して元に戻す（README の手順）。
// 環境変数の付け方がシェルで違うので、Node から起動する。
import { spawnSync } from 'node:child_process';

const result = spawnSync('pnpm exec playwright test e2e/stale.spec.ts', {
  stdio: 'inherit',
  shell: true,
  env: { ...process.env, E2E_STALE: '1' },
});

process.exit(result.status ?? 1);
