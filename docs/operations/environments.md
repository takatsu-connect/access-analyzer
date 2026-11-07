# 環境と設定値の一覧

- 状態: 草案
- 更新日: 2026-11-07

この BI が動く環境と、各環境に置く設定値（Secrets、Variables、Environment、Vercel の環境変数）の一覧。値はこの文書に書かない（.claude/rules/security.md「秘密情報」、06 §3）。設定の手順は deploy.md、日々の運用は runbook.md、監視は monitoring.md。

## 1. 環境の一覧

| 環境 | 何が動くか | データの接続先 | URL | 本番の秘密 |
| --- | --- | --- | --- | --- |
| ローカル | 開発者の PC。`apps/batch` の pytest、`apps/web` の dev / build / E2E | Supabase ローカル（Docker、`npx supabase start`。api 54421、db 54422） | `http://localhost:3000`（dev）、3100（E2E）、3101（check:headers） | 置かない（ローカルの `.env`、`apps/web/.env.local` はローカルの値だけ） |
| CI | GitHub Actions の `ci.yml`（PR と main への push） | ジョブの中で起動する Supabase ローカル。GA4 と WP は偽物（07 §5） | ― | 渡さない（Secrets と Environment を参照しない） |
| 本番 | 日次バッチ（Actions の `daily.yml`）→ Supabase（本番プロジェクト）→ Vercel（BI） | 本番の Supabase、GA4 Data API、takatsu-connect.com の WP REST API | Vercel の既定のドメイン `<プロジェクト名>.vercel.app`（2026-11-07 の依頼者の決定）。プロジェクト名は未確定（§8） | §3〜§5 |

- 検証用の環境（ステージングの Supabase）は作らない。Vercel の Preview は本番の Supabase の anon キーで公開ビューだけを読む（07 §2 の選択肢のうち前者。公開データなので新しい露出はない）。理由: 無料枠の Supabase プロジェクトを増やすと管理の手間と一時停止の対象が増え、Preview で見るのは構造とヘッダだけで足りる（07 §2）。

## 2. 構成

### 2.1 本番の流れ

```
GitHub Actions（daily.yml、main、Environment production）
  ├─ WIF（OIDC → GCP STS → SA の短命トークン） → GA4 Data API
  ├─ WP REST API（https://takatsu-connect.com/wp-json/wp/v2/、差分取得）
  ├─ psycopg（batch_writer、shared pooler の session mode、verify-full + 固定 CA） → Supabase の internal.*
  └─ Deploy Hook（POST） → Vercel が main をビルド → ビルド時に anon キーで pub_* を読み、全ページを静的生成
```

### 2.2 ワークフローの一覧

| ファイル | 起点 | ジョブ | 役割 | 権限 | Secrets |
| --- | --- | --- | --- | --- | --- |
| `.github/workflows/ci.yml` | `pull_request`、main への `push` | `batch` | ruff check、ruff format --check、mypy、pytest（単体。U） | `contents: read` | なし |
| | | `web` | `pnpm run check`（ESLint、Prettier、tsc、Vitest、S-01 の名前、禁止語） | 同上 | なし |
| | | `integration` | Supabase ローカルを起動 → pytest（I-DB、I-B）→ E2E のフィクスチャ → `pnpm run build` → `check:build`（S-14）→ `check:headers`（S-11）→ `e2e`（Chromium） | 同上 | なし |
| | | `static` | actionlint、gitleaks（全履歴、`--redact`）、`check_repo_rules.py`（S-10、S-15、S-01） | 同上 | なし |
| | | `deps-audit` | pip-audit（S-08）、`pnpm audit --audit-level=high` | 同上 | なし |
| `.github/workflows/daily.yml` | `schedule`（UTC 08:00 と 09:00）、`workflow_dispatch` | `daily` / `backfill` / `publish_only` | 日次バッチ、バックフィル、Deploy Hook だけ（03 §2） | 最上位 `contents: read`。`daily` と `backfill` だけ `id-token: write` | Environment `production` とリポジトリの Secrets（§3） |
| `.github/workflows/wif-check.yml` | `workflow_dispatch` だけ | `wif-check` | WIF で認証して GA4 Data API を 1 回呼ぶ（状態コードと行数だけを出す） | `id-token: write`（このジョブ） | リポジトリの Secrets 3 つ |
| `.github/workflows/audit.yml` | `schedule`（毎週月曜 UTC 00:00）、`workflow_dispatch` | `pip-audit`、`pnpm-audit` | 依存の週 1 の監査（W-9） | `contents: read` | なし |
| `.github/workflows/heartbeat.yml` | `schedule`（毎週月曜 UTC 03:00）、`workflow_dispatch` | `heartbeat` | main の最新コミットが 45 日以上前なら `ops/heartbeat.txt` をコミット（03 §12） | `contents: write`（これだけ） | なし |

- すべてのジョブに `if: github.ref == 'refs/heads/main'` を付けている（ci.yml を除く）。`daily.yml` はさらに、リポジトリの Variable `DAILY_ENABLED` が `true` のときだけ動く。本番の設定が終わるまで、schedule が毎日失敗のメールを出さないようにするため。
- `uses:` はすべて commit SHA で固定し、行末に版を書いた（版と SHA は親が 2026-11-07 に `gh api` で確認した事実票による）。
- actionlint v1.7.12 と gitleaks v8.30.1 はバイナリを取り、SHA-256 を確かめて動かす（`.github/scripts/install-tools.sh`。チェックサムは 2026-11-07 に `gh api repos/<owner>/<repo>/releases/tags/<tag>` の `assets[].digest` で確認）。gitleaks-action は使わない。
- pip-audit は `.github/requirements/audit.txt`（ハッシュ固定、2026-10-24 より前に公開された版だけで生成）から入れる。`apps/batch` の依存とは別のロック。

### 2.3 検査のファイル

| ファイル | 内容 |
| --- | --- |
| `.github/scripts/check_repo_rules.py` | 07 S-10 のワークフローの規律、S-15 の `.env.example` の形と名前の一覧、S-01 の名前（文書と検査の道具を除く）。標準ライブラリだけ。ローカルでも `python .github/scripts/check_repo_rules.py` で動く |
| `.github/scripts/install-tools.sh` | actionlint と gitleaks を固定の版とチェックサムで入れる |
| `.github/scripts/pip-audit.sh` | pip-audit。例外の ID は理由つきでこのファイルに書く |
| `.github/scripts/supabase-local-env.sh` | CI の Supabase ローカルの接続情報を `GITHUB_ENV` に書く。`batch_writer` のパスワードはジョブの中で生成する使い捨ての値 |
| `.gitleaks.toml` | gitleaks の既定のルール + S-09 のパターン（JWT、`sb_secret_`、パスワードつきの Postgres の URL、pooler の URL、Deploy Hook の URL、SA の JSON 鍵） |
| `.github/dependabot.yml` | github-actions、pip（`/apps/batch`、`/.github/requirements`）、npm（`/apps/web`）。すべて `cooldown` つき。自動 merge はしない |

## 3. GitHub の Secrets、Variables、Environment

| 名前 | 種類 | 置き場所 | 使うジョブ | 設定する人 | 手順 |
| --- | --- | --- | --- | --- | --- |
| `GCP_WORKLOAD_IDENTITY_PROVIDER` | Secret | リポジトリ（Settings → Secrets and variables → Actions） | `daily`、`backfill`、`wif-check` | 依頼者 | deploy.md 手順 1 |
| `GCP_SERVICE_ACCOUNT` | Secret | リポジトリ | 同上 | 依頼者 | 手順 1 |
| `GA4_PROPERTY_ID` | Secret | リポジトリ | 同上 | 依頼者 | 手順 1 |
| `SUPABASE_BATCH_DB_URL` | Secret | Environment `production` だけ。リポジトリの Secret に同名を置かない（W-3） | `daily`、`backfill` の実行のステップだけ | 依頼者 | 手順 5 |
| `VERCEL_DEPLOY_HOOK_URL` | Secret | Environment `production` だけ | `daily`、`backfill`、`publish_only` の実行のステップだけ | 依頼者 | 手順 7 |
| `production` | Environment | リポジトリ（Settings → Environments）。Deployment branches を main だけに限る | `daily.yml` の 3 ジョブだけ | 依頼者 | 手順 5 |
| `DAILY_ENABLED` | Variable | リポジトリ（Settings → Secrets and variables → Actions → Variables）。値は `true` のときだけ有効 | `daily.yml` の実行の条件 | 依頼者 | 手順 8 |

- 2026-11-07 に `gh api repos/takatsu-connect/access-analyzer/environments` で、Environment がまだ 1 つもないことを確かめた。
- `GITHUB_RUN_ID` は Actions が自動で設定し、バッチが `batch_run` に記録する（数字だけを受ける。`env.py`）。設定は不要。
- 失敗通知のための Secret は置かない（GitHub の失敗メール。Q-12）。

## 4. Vercel の環境変数と設定

| 名前 / 項目 | 値の置き場所 | 対象 | 設定する人 |
| --- | --- | --- | --- |
| `SUPABASE_URL` | Vercel の Environment Variables（`NEXT_PUBLIC_` を付けない） | Production と Preview に同じ値（06 §2.4） | 依頼者 |
| `SUPABASE_ANON_KEY` | 同上 | 同上 | 依頼者 |
| Root Directory | `apps/web` | プロジェクト | 依頼者 |
| Build Command | `pnpm run build && pnpm run check:build`（ADR 0010 の 7。`check:build` が失敗したらビルドが失敗し、前のデプロイが残る） | プロジェクト | 依頼者 |
| Deploy Hook | Settings → Git → Deploy Hooks。ブランチ main。URL は GitHub の Environment の Secret にだけ置く | プロジェクト | 依頼者 |
| Deployment Protection | Standard Protection（本番ドメイン以外のデプロイの URL を閉じる） | プロジェクト | 依頼者 |
| Web Analytics、Speed Insights、Toolbar | 使わない（2026-11-07 の依頼者の決定。06 §6 の CSP とも合う） | プロジェクト | 依頼者 |

- Vercel のアカウント所有者（NFR-60）: 未記入。依頼者が §7 に書く。

## 5. Supabase

| 項目 | 内容 | 置き場所 | 設定する人 |
| --- | --- | --- | --- |
| 本番プロジェクト | 作成済み（2026-11-04）。マイグレーション 0001〜0005 は未適用（2026-11-07） | Supabase | 依頼者 |
| `postgres` のパスワード | マイグレーションの適用（`supabase db push`）のときに入力する。保存先はパスワード管理ツール（依頼者の管理）とし、リポジトリ、Actions、Vercel に置かない（06 §3） | 依頼者のパスワード管理ツール | 依頼者 |
| `batch_writer` のパスワード | 英数字 32 文字以上のランダム値（ADR 0009）。SQL エディタで設定し、接続文字列にして Environment の Secret にだけ置く | Environment `production` | 依頼者 |
| CA | `apps/batch/certs/supabase-root-2021.crt`（Supabase Root 2021 CA。SHA-256 指紋 `80:70:25:AD:50:D4:ED:21:9D:2C:9C:7D:29:9C:00:4F:82:4E:B0:0C:F7:F6:5A:FE:F6:07:D0:7B:72:E6:CA:FA`、有効期限 2031-04-26。pooler のサーバー証明書の有効期限は 2030-03-11。ADR 0009） | リポジトリ（秘密ではない） | ― |
| service role キー | 使わない。どこにも置かない | ― | ― |

## 6. GCP

| 項目 | 値 |
| --- | --- |
| プロジェクト | `affable-enigma-513514-q8`（番号 359672952827） |
| SA | `sa-takatsu-connect-ga4@affable-enigma-513514-q8.iam.gserviceaccount.com`（GA4 プロパティの閲覧者。GCP のロールは持たない） |
| WIF のプール / プロバイダ | `github` / `access-analyzer`（未作成。deploy.md 手順 1）。属性条件は repository、repository_id（1443616803）、ref = refs/heads/main |
| JSON 鍵 | 動作確認後に削除する（deploy.md 手順 11） |

## 7. 権限を持つ人

| 対象 | 権限 | 人 | 備考 |
| --- | --- | --- | --- |
| GitHub organization `takatsu-connect` | Owner | 依頼者（メンバー 2 アカウント） | 2FA 必須を有効化済み（initial_setup.md §1） |
| GCP プロジェクト | 所有者 | 依頼者 | SA の「サービス アカウント トークン作成者」をローカル確認用に付与済み。WIF 移行後に不要なら外す（deploy.md 手順 11） |
| Supabase の organization / プロジェクト | 未記入 | 依頼者が記入 | 多要素認証の状態を記入する（ADR 0009 確認項目 4） |
| Vercel のアカウント（Hobby） | 所有者 | 未記入（NFR-60） | 依頼者が記入 |
| GA4 プロパティ | 管理者 | 未記入 | SA は閲覧者 |

## 8. 確認が要ること

1. Vercel のプロジェクト名（= `<プロジェクト名>.vercel.app` の URL）。
2. Supabase CLI の版。CI は `npx supabase@3.0.0` に固定した。3.0.0 はローカルの `supabase/.temp/cli-latest` に残っていた値で、npm に同じ版があるか、公開日（2 週間たっているか）、`start -x` の除外名と `status -o env` の出力の名前（`ANON_KEY` か `SUPA_ANON_KEY` か、anon キーが JWT か新しい publishable キーか）は確かめていない。context7（supabase/cli、2026-11-07）では、`-x` の不正な名前は警告だけで続行し、名前は版によって `storage-api` / `storage`、`edge-runtime` / `edgeRuntime` などと違う。
3. pnpm は Node に付いている corepack で入れる（`corepack enable`。版は apps/web/package.json の `packageManager`）。`pnpm/action-setup` はリポジトリの Action の許可リスト（GitHub 製、Marketplace の認証済み、`google-github-actions/*`）にないので使わない（2026-11-07、最初の CI で判明）。
4. Vercel のビルドが `packageManager: pnpm@10.6.5` を使うか（corepack の扱い）。Node は `engines.node: 24.x` を読む見込み。
5. Vercel の Git の設定で、fork からの PR のプレビューをビルドしない設定（06 §2.4）の名前と既定値。
6. Standard Protection で `<プロジェクト名>.vercel.app` が「本番ドメイン」として公開のまま残ること（Vercel Docs「Deployment Protection」、2026-11-07 確認: Standard Protection は本番ドメイン以外をすべて保護し、本番の生成 URL も制限される）。
