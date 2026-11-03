# 01 技術選定

- 状態: 草案
- 更新日: 2026-11-03
- 変更履歴: 2026-11-03: 設計レビュー（audits/2026-11-03-design-review.md）の M-3（heartbeat.yml の分離）を反映
- 参照: ADR 0001（全体構成）、ADR 0002（WIF）、ADR 0004（言語とフレームワーク）、ADR 0006（配信方式）、ADR 0007（集計の持ち方）

## 1. 選定の方針

- 小規模サイト向けの BI なので、ランニングコスト（無料枠、NFR-60）と運用負荷（無人運用、NFR-70）を最優先に、要件を満たす最も小さい構成を選ぶ。
- 依頼者の決定（GitHub Actions → Supabase → Vercel、ログインなし、public リポジトリ、WIF）は制約として扱い、選定の対象にしない。
- 言語は 1 つに揃える（TypeScript）。バッチと BI で正規化規則・伏せ値・公開ビューの型を共有し、依存の更新先（Dependabot のエコシステム）を 1 つにする（ADR 0004）。
- サーバーが実行時に動く部分を作らない。BI は静的生成（ADR 0006）。
- ライブラリは公式クライアントと広く使われているものに限る。バージョンは実装時にロックファイルで固定する（下表の版は 2026-11 時点の方針で、実装時に最新の安定版を確認する）。

## 2. 一覧

| 層 | 選定 | 理由の要約 | ADR |
| --- | --- | --- | --- |
| 言語 | TypeScript（strict） | バッチと BI で 1 言語。型で公開ビューの列を縛れる | 0004 |
| ランタイム | Node.js LTS（実装時の Active LTS。2026-11 時点では 24 系を想定） | Actions と Vercel の両方で標準 | 0004 |
| パッケージ管理 | pnpm（workspace） | monorepo で `apps/batch`、`apps/web`、`packages/shared` を 1 つのロックファイルで管理 | 0004 |
| バッチ | Node.js スクリプト（`tsx` で実行）、`@google-analytics/data`、`@supabase/supabase-js`、`zod`、`undici`（標準 fetch） | 公式クライアント。ADC で WIF の資格情報を拾う | 0001、0002、0004 |
| DB | Supabase（Postgres、Free） | 依頼者の決定。RLS とビューで公開範囲を統制 | 0001、0007 |
| スキーマ管理 | Supabase CLI のマイグレーション（`supabase/migrations/*.sql`） | リポジトリに履歴が残る（NFR-73） | 0007 |
| BI フレームワーク | Next.js（App Router、静的生成、`dynamicParams = false`） | Vercel で第一級。`headers()` で応答ヘッダ。静的生成で実行時サーバーなし | 0004、0006 |
| UI | React、CSS Modules（または Tailwind。2 回目で確定）、グラフライブラリ（2 回目で確定。候補: Recharts、Chart.js） | 05_screens.md で画面要件を踏まえて決める | （2 回目） |
| 配信 | Vercel Hobby、Deploy Hook による日次再ビルド | 静的ファイルだけを CDN から配信。リクエストごとに Supabase を読まない（NFR-11） | 0006 |
| ジョブ基盤 | GitHub Actions（cron + workflow_dispatch） | 依頼者の決定。public リポジトリで無料 | 0001 |
| 認証（GA4） | Workload Identity Federation（google-github-actions/auth v3、SA を介する） | 鍵なし（NFR-41） | 0002 |
| テスト | Vitest（単体・結合）、Playwright（E2E、プレビュー環境に対して） | TypeScript と相性がよく設定が少ない | （07_test_plan.md、2 回目） |
| lint / format | ESLint（typescript-eslint）、Prettier | 標準 | ― |
| 依存更新 | Dependabot（npm、github-actions） | security.md「依存」 | ― |

## 3. 言語とランタイム

- TypeScript strict。`packages/shared` に公開ビューの行の型（`PubPost`、`PubArticlePeriod` など）を置き、バッチの書き込みと BI の読み出しで同じ型を使う。Supabase CLI の型生成（`supabase gen types`）は補助として使ってよいが、公開ビューの型は手書きで固定し、生成結果と突き合わせるテストを置く（ビューの列が増えたら気づけるようにする）。
- Node.js の版は `.nvmrc` / `engines` と Actions の `setup-node`、Vercel のプロジェクト設定で揃える。
- タイムゾーンの扱いは `Temporal` か `date-fns-tz` のどちらか 1 つに固定する（実装時に決定。Node.js の `Temporal` 対応状況による）。文字列の `YYYY-MM-DD` を JST 暦日として扱う関数を `packages/shared` に置き、`Date` の暗黙のローカルタイムゾーンに依存しない（Actions のランナーは UTC）。

## 4. 日次バッチ

- 1 つの CLI（`apps/batch`）に `daily`、`backfill`、`publish-only`、`exclude-author` のサブコマンド。
- GA4: `@google-analytics/data` の `BetaAnalyticsDataClient.runReport`。認証は Application Default Credentials（google-github-actions/auth が `GOOGLE_APPLICATION_CREDENTIALS` を設定する）。ローカル開発では `gcloud auth application-default login` の ADC を使い、JSON 鍵は作らない。
- WP REST API: 標準の `fetch`。1 秒間隔、再試行 3 回。
- Supabase: `@supabase/supabase-js`（service role）。upsert を 1,000 行単位。SQL 関数（rpc）は使わない（集計はバッチの TypeScript と公開ビューの SQL に分ける。ADR 0007）。
- 検証: `zod` で環境変数、GA4 / WP の応答の形、設定値を検証。
- 実行: Actions の ubuntu ランナーで `pnpm install --frozen-lockfile` → `pnpm --filter batch run daily`。所要 2〜4 分。

## 5. BI（Web）

- Next.js App Router。全ページを `generateStaticParams` で静的生成し、`dynamicParams = false`。実行時のサーバー関数（Route Handler、Server Actions）を作らない。
- データはビルド時に `@supabase/supabase-js`（anon）で `pub_*` を読み、ページごとに必要なぶんを props として埋め込む。期間切り替え（直近 7 / 28 / 90 日、月別）はページに全期間ぶんのデータを含めてクライアントで切り替える（ページ数を実体の数に抑える。ADR 0006）。
- ページ数の見込み: トップ 1、記事 225、著者 21、カテゴリ約 25、タグ数十、投稿活動 1、反応指標 1 → 300〜350 ページ。ビルド時の Supabase 読み出しはビュー単位で全件を一度に読み（約 30 クエリ）、ページ生成はメモリ上で行う。
- 応答ヘッダは `next.config` の `headers()`（06 §6）。`robots.txt` と `<meta name="robots">`。
- グラフ・UI ライブラリは 05_screens.md と同時に決める（スマホ幅 360px、ヒートマップ、折れ線、横棒。NFR-81、NFR-99）。
- CSV エクスポート（FR-05、低）は表示中の表からクライアントで生成する。

## 6. データベース（Supabase）

- Free プラン（DB 500 MB、egress 5 GB / 月）。見積もり: DB は数年で 100 MB 未満（02 §7）、egress はビルド 1 回あたり数 MB × 日 1 回 → 月 1 GB 未満。
- 全表 RLS、anon は `pub_*` の select のみ、既定権限の取り消し（02 §6）。
- 日次の書き込みがあるので 1 週間無アクセスでの一時停止は起きない。
- バックアップ: Free プランの自動バックアップに依存せず、GA4 から再取得できる（NFR-51 の趣旨とは別に、Supabase が失われても 03 §10 のバックフィルで復元できる）。WordPress 由来のメタデータも再取得できる。失われて困るのは `excluded_author` と `batch_run` の履歴だけで、`excluded_author` は台帳（リポジトリ外）から復元する。

## 7. ジョブ実行基盤（GitHub Actions）

- `daily.yml`: `schedule`（08:00 と 09:00 UTC）、`workflow_dispatch`。ジョブ `batch`（`id-token: write`）のみ。最上位 `permissions: contents: read`。`concurrency` で同時実行を 1 に。
- `heartbeat.yml`: 別ワークフロー（設計レビュー M-3、03 §12）。月 1 回の `schedule`、ワークフロー全体で `permissions: contents: write` のみ。`actions/checkout`（`sparse-checkout: ops/`）と `git` CLI だけで、`pnpm install`・プロジェクトコード・サードパーティ Action・Secrets を置かない。
- `ci.yml`: `pull_request` と `push`（main）。lint、型検査、単体テスト、`pnpm audit`、マイグレーションの権限検査（Supabase のローカル環境 `supabase start` を CI で起こして適用し、anon の grant を検査する。結合テストの詳細は 2 回目）。
- Actions の無料枠（public リポジトリ）で、日次 5 分 × 30 日 ≈ 150 分 / 月。制限なし。

## 8. 開発支援（テスト、lint、依存管理）

- Vitest: `packages/shared`（正規化、伏せ値、期間計算、派生指標）を重点的に単体テスト。バッチは GA4 / WP の応答を固定 JSON にしたモックで結合テスト。
- Playwright: プレビュー環境に対する E2E（画面の存在、noindex、ヘッダ、除外著者の 404、順位の数字がないこと）。対象サイトと本番 BI には走らせない（NFR-72）。
- ESLint の規則で `console.log` を禁止し、ロガー経由に限る（NFR-44）。`NEXT_PUBLIC_SUPABASE` を含む識別子を禁止する lint も置く。
- Dependabot: 週 1、`npm` と `github-actions`。

## 9. 選ばなかったもの（要約）

| 候補 | 理由 | ADR |
| --- | --- | --- |
| Python でバッチ（google-analytics-data、supabase-py） | 正規化・伏せ値の規則を 2 言語で持つことになり、テストと依存更新が 2 系統になる。GA4 クライアントは Node でも公式 | 0004 |
| Astro（静的サイト） | 静的生成は得意だが、Vercel の `headers()` 相当や ISR への将来の移行を考えると Next.js のほうが選択肢が残る。差は小さく、再検討の余地はある | 0004 |
| Next.js の ISR（時間ベースの再検証）| 実行時に Supabase を読む経路が残り、除外リスト変更後の無効化に別の仕組み（再検証 API + 秘密）が要る | 0006 |
| Supabase Edge Functions / Vercel Cron でバッチ | 依頼者の決定（Actions）に反する。Vercel Hobby の Function は 300 秒上限でバックフィルに足りない | 0001 |
| 直接の Postgres 接続（`pg`）でバッチが書く | トランザクションと bulk が楽だが、DB パスワードという秘密が増え、IPv4 のプーラー経由の設定が要る。supabase-js の upsert で足りる | 0007 |
| SQL 関数（rpc）で集計 | 伏せ値・分布の規則を SQL に書くとテストしにくい。TypeScript 側に寄せた | 0007 |
| 環境変数に除外リスト | Secrets は読み返せず、現在の一覧を確認できない。公開ビューでの除外のほうが 1 か所で効く | 0005 |
| 直接 WIF（SA なし） | GA4 の権限は Google アカウントか SA にしか付けられない | 0002 |

## 10. 未確定

- グラフ・UI ライブラリ（2 回目、05_screens.md と同時）。
- Node.js の版と `Temporal` の利用可否（実装時）。
- Vercel Hobby のビルド時間の月間上限（事実票にない。Q-34 として親に確認を依頼。1 日 1 回 2〜3 分のビルドなら月 90 分程度で、どの上限でも収まる見込み）。
- Supabase CLI をローカルで動かすために Docker が要る（結合テストと `supabase db push`）。開発環境の前提として docs/operations/ に書く。
