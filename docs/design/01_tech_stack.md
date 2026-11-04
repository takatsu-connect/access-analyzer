# 01 技術選定

- 状態: レビュー中（2026-11-03）
- 更新日: 2026-11-04
- 変更履歴:
  - 2026-11-03: 設計レビュー（audits/2026-11-03-design-review.md）の M-3（heartbeat.yml の分離）を反映
  - 2026-11-03: バッチを Python に、BI を TypeScript のままに。`packages/shared` を廃止（ADR 0004）。書き込みを psycopg と専用ロールに（ADR 0009）
  - 2026-11-03: 書き込み経路の監査（以下「経路監査」。docs/security/audits/2026-11-03-write-path-review.md）の L-7 と W-1 の表記を反映（`colorama` を `requirements-dev.in` へ、TLS の未確定の書き方）
  - 2026-11-04: 著者の除外（FR-36）を初回対象外に（依頼者の決定、ADR 0005 保留）。除外リストの記述と選ばなかった案の行を外した
- 参照: ADR 0001（全体構成）、ADR 0002（WIF）、ADR 0004（言語とフレームワーク）、ADR 0006（配信方式）、ADR 0007（集計の持ち方）、ADR 0009（書き込み経路）

## 1. 選定の方針

- 小規模サイト向けの BI なので、ランニングコスト（無料枠、NFR-60）と運用負荷（無人運用、NFR-70）を最優先に、要件を満たす最も小さい構成を選ぶ。
- 依頼者の決定（GitHub Actions → Supabase → Vercel、ログインなし、public リポジトリ、WIF）は制約として扱い、選定の対象にしない。
- 各所で得意な言語を選ぶ（依頼者の指示。ADR 0004）。データ処理のバッチは Python、画面の BI は TypeScript。両者はコードを共有せず、公開ビューの定義と定数の突き合わせでつなぐ。
- サーバーが実行時に動く部分を作らない。BI は静的生成（ADR 0006）。
- ライブラリは公式クライアントと広く使われているものに限る。バージョンは実装時にロックファイルで固定する（下表の版は 2026-11 時点の方針で、実装時に最新の安定版を確認する）。

## 2. 一覧

| 層 | 選定 | 理由の要約 | ADR |
| --- | --- | --- | --- |
| 言語（バッチ） | Python（mypy で型検査） | データ処理が書きやすい。JST の扱いが標準ライブラリで足りる | 0004 |
| 言語（BI） | TypeScript（strict） | Next.js と型で公開ビューの列を縛れる | 0004 |
| ランタイム | Python（`.python-version` で固定。2026-11 時点では 3.13 系を想定し、実装時に依存の wheel が揃う安定版を確認）、Node.js LTS（BI のみ。実装時の Active LTS） | Actions（Python）と Vercel（Node.js）の両方で標準 | 0004 |
| パッケージ管理 | バッチ: pip + pip-tools（`pip-compile --generate-hashes`、`pip install --require-hashes`）。BI: pnpm（`apps/web` 単独） | `actions/setup-python` だけで成り立つ。追加の Action の許可確認が要らない | 0004 |
| バッチ | `python -m takatsu_batch`、`google-analytics-data`、`psycopg[binary]`、`pydantic`、`httpx` | 公式クライアント。ADC で WIF の資格情報を拾う。pooler 経由で Postgres に書く | 0001、0002、0004、0009 |
| DB | Supabase（Postgres、Free） | 依頼者の決定。RLS とビューで公開範囲を統制 | 0001、0007 |
| スキーマ管理 | Supabase CLI のマイグレーション（`supabase/migrations/*.sql`） | リポジトリに履歴が残る（NFR-73） | 0007 |
| BI フレームワーク | Next.js（App Router、静的生成、`dynamicParams = false`） | Vercel で第一級。`headers()` で応答ヘッダ。静的生成で実行時サーバーなし | 0004、0006 |
| UI | React、CSS Modules（または Tailwind。2 回目で確定）、グラフライブラリ（2 回目で確定。候補: Recharts、Chart.js） | 05_screens.md で画面要件を踏まえて決める | （2 回目） |
| 配信 | Vercel Hobby、Deploy Hook による日次再ビルド | 静的ファイルだけを CDN から配信。リクエストごとに Supabase を読まない（NFR-11） | 0006 |
| ジョブ基盤 | GitHub Actions（cron + workflow_dispatch） | 依頼者の決定。public リポジトリで無料 | 0001 |
| 認証（GA4） | Workload Identity Federation（google-github-actions/auth v3、SA を介する） | 鍵なし（NFR-41） | 0002 |
| テスト | バッチと DB: pytest、respx。BI: Vitest、Playwright（E2E） | 各言語の標準 | 07_test_plan.md |
| lint / format | バッチ: ruff、mypy。BI: ESLint（typescript-eslint）、Prettier | 標準 | ― |
| 依存更新 | Dependabot（pip、npm、github-actions）。監査は pip-audit と pnpm audit | security.md「依存」 | ― |

## 3. 言語とランタイム

- BI は TypeScript strict。`apps/web/src/lib/pub-types.ts` に公開ビューの行の型（`PubPost`、`PubArticlePeriod` など）を置く。Supabase CLI の型生成（`supabase gen types`）は補助として使ってよいが、公開ビューの型は手書きで固定し、生成結果と突き合わせるテストを置く（ビューの列が増えたら気づけるようにする）。
- バッチは Python。公開ビューを読まず、内部表に書く。行の形は pydantic のモデルで検証し、mypy を strict で通す。
- Python の版は `apps/batch/.python-version` と Actions の `actions/setup-python`（`python-version-file`）で揃える。Node.js の版は `.nvmrc` / `engines` と CI の `actions/setup-node`、Vercel のプロジェクト設定で揃える。
- タイムゾーン（バッチ）: 標準の `datetime` と `zoneinfo.ZoneInfo("Asia/Tokyo")`。JST 暦日は `date` で扱い、naive な `datetime` と `date.today()` を使わない（Actions のランナーは UTC。ruff の `DTZ` 規則で検査）。
- タイムゾーン（BI）: 埋め込みデータの JST 暦日は文字列 `YYYY-MM-DD` のまま扱う。`Date` の暗黙のローカルタイムゾーンに依存しない。「今日」を JST で求める関数を `apps/web/src/lib/derive/` に置き、`Intl.DateTimeFormat` の `timeZone: 'Asia/Tokyo'` を使う。

## 4. 日次バッチ

- 1 つの CLI（`python -m takatsu_batch`）に `daily`、`backfill`、`publish-only` のサブコマンド。
- GA4: `google-analytics-data` の `BetaAnalyticsDataClient.run_report`。認証は Application Default Credentials（google-github-actions/auth が `GOOGLE_APPLICATION_CREDENTIALS` を設定する）。ローカル開発では `gcloud auth application-default login` の ADC を使い、JSON 鍵は作らない。
- WP REST API: `httpx`。1 秒間隔、再試行 3 回。
- Supabase: `psycopg`（v3）で shared pooler の session mode に接続し、専用ロール `batch_writer` で書く。`executemany` の `insert ... on conflict do update` を 1,000 行単位、工程 6 全体で 1 トランザクション。SQL 関数（rpc）は使わない（集計はバッチの Python と公開ビューの SQL に分ける。ADR 0007、ADR 0009）。
- 検証: `pydantic`（v2）で環境変数、GA4 / WP の応答の形、設定値、`batch_run.counts` を検証。`hide_input_in_errors=True` を必ず付ける（03 §15）。
- 実行: Actions の ubuntu ランナーで `actions/setup-python` → `pip install --require-hashes --only-binary :all: -r requirements.txt` → `PYTHONPATH=src python -m takatsu_batch daily`。所要 2〜4 分。日次ワークフローは Node.js を使わない。
- 依存のロック: 直接の依存は `requirements.in`、開発用は `requirements-dev.in`（`-c requirements.txt`）に書き、`pip-compile --generate-hashes` で `requirements.txt` と `requirements-dev.txt` を生成してコミットする。生成は Linux と CI と同じ Python 版で行う（WSL、コンテナ、または Dependabot）。pip-compile の結果は実行環境に依存するため。Windows でだけ要る依存のうち、`tzdata` は `requirements.in` に、`colorama` は `requirements-dev.in` に明示する（本番のロックに `colorama` を入れない。経路監査 L-7）。ローカルでは venv を作り、同じ `--require-hashes` で入れる。`--only-binary :all:` により、インストール時に sdist のビルドスクリプトを実行しない。

## 5. BI（Web）

- Next.js App Router。全ページを `generateStaticParams` で静的生成し、`dynamicParams = false`。実行時のサーバー関数（Route Handler、Server Actions）を作らない。
- データはビルド時に `@supabase/supabase-js`（anon、`apps/web` の依存）で `pub_*` を読み、ページごとに必要なぶんを props として埋め込む。期間切り替え（直近 7 / 28 / 90 日、月別）はページに全期間ぶんのデータを含めてクライアントで切り替える（ページ数を実体の数に抑える。ADR 0006）。埋め込む JSON は `zod` で検証する（04 §4）。
- ページ数の見込み: トップ 1、記事 225、著者 21、カテゴリ約 25、タグ数十、投稿活動 1、反応指標 1 → 300〜350 ページ。ビルド時の Supabase 読み出しはビュー単位で全件を一度に読み（約 30 クエリ）、ページ生成はメモリ上で行う。
- 応答ヘッダは `next.config` の `headers()`（06 §6）。`robots.txt` と `<meta name="robots">`。
- グラフ・UI ライブラリは 05_screens.md と同時に決める（スマホ幅 360px、ヒートマップ、折れ線、横棒。NFR-81、NFR-99）。
- CSV エクスポート（FR-05、低）は表示中の表からクライアントで生成する。

## 6. データベース（Supabase）

- Free プラン（DB 500 MB、egress 5 GB / 月）。見積もり: DB は数年で 100 MB 未満（02 §7）、egress はビルド 1 回あたり数 MB × 日 1 回 → 月 1 GB 未満。
- 全表 RLS、anon は `pub_*` の select のみ、既定権限の取り消し（02 §6）。
- 日次の書き込みがあるので 1 週間無アクセスでの一時停止は起きない。
- バックアップ: Free プランの自動バックアップに依存せず、GA4 から再取得できる（NFR-51 の趣旨とは別に、Supabase が失われても 03 §10 のバックフィルで復元できる）。WordPress 由来のメタデータも再取得できる。失われて困るのは `batch_run` の履歴だけ。

## 7. ジョブ実行基盤（GitHub Actions）

- `daily.yml`: `schedule`（08:00 と 09:00 UTC）、`workflow_dispatch`。ジョブ `batch`（`id-token: write`）のみ。使う Action は `actions/checkout`、`actions/setup-python`、`google-github-actions/auth` だけ。最上位 `permissions: contents: read`。`concurrency` で同時実行を 1 に。
- `heartbeat.yml`: 別ワークフロー（設計レビュー M-3、03 §12）。月 1 回の `schedule`、ワークフロー全体で `permissions: contents: write` のみ。`actions/checkout`（`sparse-checkout: ops/`）と `git` CLI だけで、依存のインストール・プロジェクトコード・サードパーティ Action・Secrets を置かない。
- `ci.yml`: `pull_request` と `push`（main）。バッチのジョブ（ruff、mypy、pytest、`pip-audit`）、BI のジョブ（ESLint、`tsc`、Vitest、`pnpm audit`）、マイグレーションの権限検査（Supabase のローカル環境 `supabase start` を CI で起こして適用し、anon と `batch_writer` の権限を検査する。07 §4）。
- Actions の無料枠（public リポジトリ）で、日次 5 分 × 30 日 ≈ 150 分 / 月。制限なし。

## 8. 開発支援（テスト、lint、依存管理）

- pytest: `apps/batch` の正規化、伏せ値、期間計算、派生指標を重点的に単体テスト。バッチは GA4 クライアントを固定応答の偽物に差し替え、WP と Deploy Hook を respx でモックして結合テスト。
- Vitest: `apps/web/src/lib`（比較、構成比、URL クエリ、辞書）と画面の部品。
- Playwright: プレビュー環境に対する E2E（画面の存在、noindex、ヘッダ、存在しないページの 404、順位の数字がないこと）。対象サイトと本番 BI には走らせない（NFR-72）。
- ESLint の規則で `console.log` を禁止し、ロガー経由に限る（NFR-44）。`NEXT_PUBLIC_SUPABASE` を含む識別子を禁止する lint も置く。バッチは ruff で `print`（T201）と naive な日時（DTZ）を禁止し、`banned-api` で `logging`、`traceback`、`pprint` を `log.py` と `errors.py` の外で禁止する。
- Dependabot: 週 1、`pip`（`/apps/batch`）、`npm`（`/apps/web`）、`github-actions`（`/`）。pip-compile のハッシュ付きロックを更新できることは実装時に確認する（§10）。

## 9. 選ばなかったもの（要約）

| 候補 | 理由 | ADR |
| --- | --- | --- |
| TypeScript でバッチ（`@google-analytics/data`。前回の決定） | 依頼者の指示「各所で得意な言語を選ぶ」。共有が要るものは少なかった | 0004 |
| uv（astral-sh/setup-uv） | Action の許可の確認が要る。`actions/setup-python` だけで成り立つ pip + pip-tools を優先した | 0004 |
| Astro（静的サイト） | 静的生成は得意だが、Vercel の `headers()` 相当や ISR への将来の移行を考えると Next.js のほうが選択肢が残る。差は小さく、再検討の余地はある | 0004 |
| Next.js の ISR（時間ベースの再検証）| 実行時に Supabase を読む経路が残り、データ更新後の無効化に別の仕組み（再検証 API + 秘密）が要る | 0006 |
| Supabase Edge Functions / Vercel Cron でバッチ | 依頼者の決定（Actions）に反する。Vercel Hobby の Function は 300 秒上限でバックフィルに足りない | 0001 |
| PostgREST（supabase クライアント + service role キー）でバッチが書く | `internal` が Exposed schemas にないので届かない。公開すれば M-7 の多層防御が崩れる。バッチが触れる表をロールで絞れない | 0009 |
| direct 接続（5432） | Free では IPv6 のみ | 0009 |
| SQL 関数（rpc）で集計 | 伏せ値の規則を SQL に書くとテストしにくい。バッチの Python に寄せた | 0007 |
| 直接 WIF（SA なし） | GA4 の権限は Google アカウントか SA にしか付けられない | 0002 |

## 10. 未確定

- グラフ・UI ライブラリ（2 回目、05_screens.md と同時）。
- Python と Node.js の正確な版（実装時）。
- pip-compile のロックを Windows と Linux の両方で使えるか、Dependabot がハッシュ付きのロックを更新できるか（実装時。ADR 0004）。
- pooler の TLS の基準の段階（第 1 か第 2。実装着手前の確認項目 1）と `executemany` の挙動（実装時。ADR 0009）。
- Vercel Hobby のビルド時間の月間上限（事実票にない。Q-34 として親に確認を依頼。1 日 1 回 2〜3 分のビルドなら月 90 分程度で、どの上限でも収まる見込み）。
- Supabase CLI をローカルで動かすために Docker が要る（結合テストと `supabase db push`）。開発環境の前提として docs/operations/ に書く。
