# 00 全体構成

- 状態: 確定（2026-11-04。依頼者の確認済み。実装時の確認項目は ADR 0009 にある）
- 更新日: 2026-11-28
- 変更履歴:
  - 2026-11-28: WP REST API の中継（`apps/wp-relay`。ADR 0011、レビュー中）を反映（§1、§2、§3、§4、§5、§6）。Vercel の「Hobby」の記述を、BI と中継が Pro のチームにある実態に合わせた（要件 Q-06 の想定とは違う）
  - 2026-11-03: 設計レビュー（audits/2026-11-03-design-review.md）の M-3（heartbeat.yml の分離）を反映
  - 2026-11-03: バッチを Python に変更し `packages/shared` を廃止（ADR 0004）。書き込みを psycopg と専用ロール `batch_writer` に変更（ADR 0009）。除外リストの変更を SQL エディタに変更（ADR 0005）
  - 2026-11-03: 書き込み経路の監査（以下「経路監査」。docs/security/audits/2026-11-03-write-path-review.md）の W-1、W-3、W-8、W-9 を反映（週 1 の `audit.yml`、`apps/batch/certs/`、`supabase/checks/`、Environment の Secret）
  - 2026-11-04: 著者の除外（FR-36）を初回対象外に（依頼者の決定、ADR 0005 保留）。`excluded_author` と運用担当の除外の経路を図と表から外した
  - 2026-11-04: tech-writer の整合確認。§6 の CLAUDE.md への言及を現状に合わせた
- 参照: 00_overview.md §3〜§5、ADR 0001、ADR 0004、ADR 0005（保留）、ADR 0006、ADR 0007、ADR 0009、ADR 0011（レビュー中）

## 1. 概要

- 高津コネクト（WordPress）のアクセス集計を、GA4 Data API と WP REST API から日次で取り込み、Supabase に蓄積し、Vercel 上の静的な BI として公開する。
- 依頼者の決定（00_overview.md §5）に従い、構成は 2 つに分ける。(1) 取得・集計・格納: GitHub Actions の日次バッチ。Web サービスとしては公開しない。(2) 表示: Supabase から読む BI。Vercel で動かし、Supabase はブラウザからではなくサーバー側（ビルド時）から読む。
- 選定の優先順位は、ランニングコスト（無料枠、NFR-60）と運用負荷（無人運用、NFR-70）、公開データの安全（NFR-30〜NFR-45）、対象サイトへの負荷（NFR-72）。この順で小さい構成を選んだ（ADR 0001）。
- 実行時にサーバーが動く部分をなくした。BI は日次バッチの終わりに再ビルドされる静的サイトで、リクエストごとに Supabase を読まない（NFR-11、ADR 0006）。
- 例外が 1 つある。対象サイトのホスティング（XServer）は国外からの API アクセスを禁止しているので、GitHub Actions（国外の IP）のバッチは WP REST API を直接読めない。国外制限を緩めずに、Vercel の東京リージョン（hnd1）の関数 1 つ（中継、`apps/wp-relay`）を経由して読む（ADR 0011。2026-11-09 から本番で動いている）。中継は日次バッチが呼んだときだけ動き、常駐するサーバーではない。BI の配信とは別のプロジェクトで、BI が実行時にサーバー処理を持たないことは変わらない。

## 2. 全体構成図

```mermaid
flowchart TB
  subgraph EXT[外部（読むだけ）]
    GA[GA4 Data API<br/>プロパティ: 高津コネクト ウェブサイト]
    WP[WP REST API<br/>takatsu-connect.com/wp-json/wp/v2]
  end

  subgraph GH[GitHub（public リポジトリ）]
    REPO[リポジトリ<br/>apps/batch (Python), apps/web (TypeScript),<br/>supabase/migrations, .github/workflows]
    ACT[GitHub Actions<br/>日次バッチ cron 17:00 JST<br/>Secrets: WIF, GA4_PROPERTY_ID<br/>Environment production の Secrets:<br/>SUPABASE_BATCH_DB_URL, VERCEL_DEPLOY_HOOK_URL,<br/>WP_RELAY_URL, WP_RELAY_TOKEN]
  end

  subgraph GCP[Google Cloud]
    WIF[Workload Identity Federation<br/>pool: github / provider: access-analyzer]
    SA[サービスアカウント<br/>GA4 閲覧者]
  end

  subgraph SB[Supabase（Free）]
    INT[(内部表<br/>RLS 有効・anon 権限なし)]
    PUB[公開ビュー pub_*<br/>anon select のみ]
  end

  subgraph VC[Vercel プロジェクト 1: BI（Pro のチーム）]
    BUILD[ビルド<br/>Next.js 静的生成<br/>env: SUPABASE_URL, SUPABASE_ANON_KEY]
    CDN[CDN<br/>静的 HTML / JS / JSON<br/>noindex, CSP]
  end

  subgraph VR[Vercel プロジェクト 2: 中継（Pro のチーム、hnd1）]
    RELAY[apps/wp-relay<br/>関数 1 つ GET /api/relay<br/>env: WP_RELAY_TOKEN（Production だけ）<br/>Git 連携なし、CLI でデプロイ]
  end

  USER[運営者 / ライター / URL を知る人<br/>ブラウザ]

  ACT -->|OIDC トークン| WIF --> SA -->|1 時間の AT| GA
  GA -->|集計値| ACT
  ACT -->|GET、Bearer トークン、X-WP-Path| RELAY
  RELAY -->|許可リストに合う GET だけ<br/>転送先は定数| WP
  WP -->|記事メタデータ| RELAY
  RELAY -->|状態コード、本文、X-WP-Total 系| ACT
  ACT -->|psycopg, shared pooler session mode<br/>batch_writer: upsert| INT
  INT --> PUB
  ACT -->|Deploy Hook| BUILD
  REPO -->|push main| BUILD
  PUB -->|anon: select| BUILD
  BUILD --> CDN --> USER
  USER -->|記事・著者ページへのリンク| WP
```

- Vercel のプロジェクトは 2 つ（BI と中継）。どちらも Small Piece のチーム（Pro）に置いた。要件 Q-06 の回答は Hobby（無料枠）の想定だったが、依頼者の判断で Pro のチームに置いている（非商用）。中継で追加の費用が発生するかは未確認（ADR 0011「未確認の事項」）。
- 2 つのプロジェクトは環境変数を共有しない。中継は Supabase の接続情報も GA4 の認証も持たない。BI は Git 連携と Deploy Hook でビルドし、中継は main のチェックアウトから CLI で production だけをデプロイする（プレビューを作らない。docs/operations/deploy.md 手順 8.5）。
- バッチから WP への直接の矢印はない。中継を経由しない経路や、失敗したときに直接接続へ切り替える動きは持たない（ADR 0011）。

## 3. コンポーネントと責務

| コンポーネント | 置き場所 | 責務 | 持つ秘密 | 担当 |
| --- | --- | --- | --- | --- |
| 日次バッチ（`apps/batch`） | GitHub Actions（ubuntu、Python） | WP REST API（中継経由）と GA4 Data API から取得、pagePath・参照元の正規化、期間集計、伏せ値・二次伏せ、派生指標（累積、判定）、Supabase への書き込み（psycopg）、実行記録、Deploy Hook の呼び出し。設定値、ロガー、環境変数の検証もここに置く。WP への再試行と 1 秒の間隔もバッチが持つ | WIF 経由の短命トークン、`SUPABASE_BATCH_DB_URL`（`batch_writer`）、Deploy Hook URL、`WP_RELAY_URL`、`WP_RELAY_TOKEN` | backend-engineer |
| WP 取得の中継（`apps/wp-relay`） | Vercel の関数（TypeScript、`api/relay.ts` の 1 つ、regions `hnd1`、`maxDuration` 25 秒）。BI とは別のプロジェクト | バッチからの GET を、日本の IP から WP REST API へ転送する。共有トークンの検査、メソッド・パス・クエリの許可リスト（完全一致）、定数の転送先、応答の絞り込み（状態コード、本文、`X-WP-Total`、`X-WP-TotalPages`）。再試行、cron、キャッシュ、データの保存を持たない。実行時の依存はなし（ADR 0011、06 §11） | `WP_RELAY_TOKEN`（Vercel の Production だけ、Sensitive）。Supabase と GA4 の秘密は持たない | backend-engineer（実装）、devops-engineer（デプロイ） |
| 定数の突き合わせ（`contracts/constants.json`） | リポジトリ | 言語をまたぐ定数（`SITE_ORIGIN`、バケット名、中継が許可する `_fields` と `User-Agent` など）の正。実行時には読まず、各言語のテストが突き合わせる（ADR 0004、ADR 0011、07 S-16） | なし | backend-engineer、frontend-engineer |
| Supabase（Postgres） | Supabase Free | 内部表（蓄積、全期間保持）、公開ビュー（伏せ済みの投影）、実行記録。マイグレーションで管理 | `batch_writer` の接続文字列は Actions に、anon キーは Vercel に。service role キーは配らない | backend-engineer（スキーマ）、devops-engineer（プロジェクト） |
| BI（`apps/web`） | Vercel（Pro のチーム。§2 の注記） | ビルド時に公開ビューを読み、6 画面を静的生成。期間切り替え・フィルタ・並べ替え・CSV はクライアント側。応答ヘッダ、noindex。辞書、公開ビューの型、埋め込み JSON の型もここに置く | Supabase anon キー（ビルド時のみ） | frontend-engineer |
| ワークフロー（`.github/workflows`） | GitHub | cron とディスパッチ、WIF 認証、バッチの実行、失敗通知、heartbeat、CI（lint / test / audit） | Secrets の参照 | devops-engineer |

## 4. データの流れ

1. 取得（毎日 JST 17:00 ごろ、基準日 = 前日）: WP REST API から追加・更新された記事と ID 一覧、カテゴリ、タグ、必要な著者を差分で取る（約 7 リクエスト）。この取得はすべて中継（`apps/wp-relay`、hnd1）を経由する。バッチは中継に、トークンと WP のパス（ヘッダ）、WP に渡すクエリを送り、中継が検証してから takatsu-connect.com へ転送する。バッチの 1 リクエストは WP への最大 1 リクエストになる（ADR 0011）。GA4 Data API から直近 7 日の日別値と、取り直す期間（移動窓 6 + 当月 + 未確定の前月）の期間別値を取る（約 30 リクエスト、約 450 トークン）。詳細は 03 §4、§5。
2. 正規化: pagePath / landingPage → 記事 ID（`^/(\d+)/$`）。sessionSource → SNS 5 区分。sessionDefaultChannelGroup → 5 区分。city → 川崎市 / 国内その他 / 不明。
3. 集計と伏せ値: 05 §4.1 の表どおりに、日別は生値（全体、記事）、期間別は生値を合算してから T = 5 と二次伏せを適用。著者 × 内訳軸 は記事の生値を著者で合算してから伏せる。合計・累積は伏せる前の値から。
4. 派生: 累積（M-18）、M-22〜M-24 の判定、節目。分布（M-19）と帯は公開ビューが計算する（02 §4.1）。
5. 格納: Supabase の内部表へ upsert（psycopg、`batch_writer`、1 トランザクション。ADR 0009）。移動窓は上書き、月は確定後に固定、確定した暦月の参照元・市別と記事の公開後 30 日時点の参照元は 1 回だけ書く。実行記録を `batch_run` に残す。
6. 公開: Deploy Hook で Vercel を再ビルド。ビルドは anon キーで `pub_*` ビューだけを読み、全ページを静的生成。CDN から配信。
7. 閲覧: ブラウザは静的ファイルだけを受け取る。期間の切り替えはページに埋め込んだ全期間ぶんのデータをクライアントで切り替える。記事・著者へのリンクは takatsu-connect.com へ。

時刻の基準は Asia/Tokyo（保存は `date` = JST 暦日、`timestamptz` = UTC。表示は JST 明示。02 §2.1）。

## 5. 信頼境界

| 境界 | 内側 | 外側 | 通るもの | 守り |
| --- | --- | --- | --- | --- |
| B1: GitHub Actions ランナー | バッチのプロセス、Secrets | インターネット | GA4 への HTTPS 読み出し、中継への HTTPS の GET（WP の読み出しはここを通る。直接は読まない）、Supabase の pooler への Postgres 接続（TLS）、Deploy Hook | Secrets は main の workflow だけが参照。fork PR は Secrets に触れない。ログに秘密・行データを出さない（NFR-44、NFR-45） |
| B2: GCP | WIF プール・プロバイダ、SA | GitHub の OIDC 発行者 | OIDC トークン → 連携トークン → SA のアクセストークン | 属性条件（repository と ref が main）。SA は GA4 閲覧者のみ。JSON 鍵なし（ADR 0002） |
| B3: Supabase | 内部表 | Actions（`batch_writer`）、Vercel ビルド（anon）、運用担当（SQL エディタ） | `batch_writer` の内部表の読み書き、anon の `pub_*` select、`batch_writer` のパスワードの設定 | RLS + grant。`batch_writer` は許可した表だけ。anon は公開ビュー以外に触れない。公開ビューの列を対応表で統制（02 §4〜§6） |
| B4: Vercel ビルド | ビルドのプロセス、環境変数（anon） | Supabase、CDN | `pub_*` の select、静的ファイルの出力 | anon キーのみ。`NEXT_PUBLIC_` を使わない。fork PR のプレビューを止める |
| B5: CDN と閲覧者 | 静的ファイル | 誰でも | HTTPS の GET | 公開ビューに載るものだけが載る。noindex、CSP、frame-ancestors。実行時のサーバー処理なし（入力はクライアント側で許可リスト検証） |
| B6: 対象サイト | takatsu-connect.com | 中継（バッチの代わりに問い合わせる）、閲覧者のブラウザ | wp/v2 の読み出し（中継の hnd1 の出口 IP から。問い合わせの主体はバッチのまま）、記事ページへのリンク（閲覧者） | 日次・差分・間隔 1 秒（NFR-72。間隔と再試行はバッチが守り、中継は自分からは問い合わせない）。対象サイトの国外制限は緩めない。リンク先は固定ドメイン（FR-04） |
| B7: 中継（Vercel の関数） | 関数のプロセス、環境変数（`WP_RELAY_TOKEN`） | インターネット（入口は公開の URL）、対象サイト | 入り: トークンつきの GET（`/api/relay`）。出: 定数の転送先（takatsu-connect.com の wp/v2）への GET だけ | 共有トークンを SHA-256 にしてから定数時間で比較、未設定なら全拒否（fail closed）。GET だけ、パスとクエリは許可リストの完全一致、転送先を入力から作らない、リダイレクトを追わない、受信したヘッダを WP に渡さない。ログは `outcome`、`status`、`duration_ms` だけ。Git 連携なし、プレビューなし（ADR 0011、06 §11）。Firewall のレート制限と費用の上限は未確認 |

最も強い前提は B3 と B5: 「公開ビューに載っているもの = 誰でも読めるもの」。設計文書では公開ビューの列（02 §4）を 05 §4.1 の表と 1 対 1 で対応づけ、security-auditor の設計レビューの対象にする。

## 6. リポジトリ構成

1 つのリポジトリに Python のバッチと TypeScript の BI を置く（ADR 0004）。workspace は使わない。CLAUDE.md の表にある `packages/shared/` は置かない（ADR 0004）。構成は次のとおり。

```
apps/
  batch/            日次バッチ（Python）
    src/takatsu_batch/   __main__.py、config.py、env.py、log.py、errors.py、db.py、page_path.py、sns_source.py、mask.py、period.py、derive.py、ga4.py、wp.py
    certs/               pooler の検証に使う CA（秘密ではない。ADR 0009）
    tests/               unit/、integration/、db/（マイグレーションと公開ビューの検査）、support/（参照実装）
    requirements.in、requirements.txt、requirements-dev.in、requirements-dev.txt（ハッシュ固定）
    pyproject.toml       ruff、mypy、pytest の設定
    .python-version
  web/              BI（Next.js App Router、静的生成、pnpm）
    src/lib/             ui-text.ts、pub-types.ts、page-data.ts、query.ts、derive/、config.ts
    src/data/            公開ビューの読み出しと組み立て
    tests/
    package.json、pnpm-lock.yaml
  wp-relay/         WP 取得の中継（TypeScript、Vercel の関数。ADR 0011）
    api/relay.ts         関数は 1 つ。`api/` にほかのファイルを置かない
    vercel.json          regions ["hnd1"]、maxDuration 25
    tests/
    package.json、pnpm-lock.yaml（実行時の依存はなし）
contracts/
  constants.json    言語をまたぐ定数の正（07 S-16）
supabase/
  migrations/       NNNN_*.sql（02 §8）
  checks/           batch_writer_privileges.sql（権限の検査。02 §6）
.github/
  workflows/        daily.yml（バッチ。contents: read、environment: production）、heartbeat.yml（月 1 回。contents: write のみ、checkout と git だけ。03 §12）、ci.yml（lint / test / audit）、audit.yml（週 1 の依存の監査。Secrets なし。06 §10）
docs/               要件・設計・運用
.env.example        環境変数の名前だけ
```

- Vercel の BI のプロジェクトは Root Directory を `apps/web` に設定する。中継のプロジェクトは Git 連携を付けず、`apps/wp-relay` から CLI でデプロイする（deploy.md 手順 8.5）。
- CI は `ci.yml` の `wp-relay` ジョブ（型検査と Vitest）と、依存の監査（`apps/wp-relay` の `pnpm audit`）、Dependabot（`/apps/wp-relay`）で中継を対象にする。
- バッチは `apps/batch` で `PYTHONPATH=src python -m takatsu_batch daily`（`backfill`、`publish-only` も同様）で動かす。

## 7. 設計文書の構成と 2 回目で書くもの

| 文書 | 内容 | 状態 |
| --- | --- | --- |
| 00_architecture.md | 本文書 | 1 回目 |
| 01_tech_stack.md | 技術選定の要約 | 1 回目 |
| 02_data_model.md | Supabase のスキーマ、公開ビュー、05 §4.1 との対応 | 1 回目 |
| 03_data_pipeline.md | 日次バッチの流れ、割当、再実行、バックフィル | 1 回目 |
| 04_api.md | BI が読むデータの契約。本設計では HTTP の API は作らず、公開ビュー（`pub_*`）とページに埋め込む JSON の形を「API」として定義する | 2 回目 |
| 05_screens.md | 6 画面の構成、指標と要件 ID の対応、埋め込む説明文、クライアント側の検証 | 2 回目 |
| 06_security.md | 認証・認可、秘密情報、公開範囲、ヘッダ、ログ | 1 回目 |
| 07_test_plan.md | 単体（正規化、伏せ値、派生指標）、結合（マイグレーション + ビューの権限検査）、E2E（画面）、受入基準との対応 | 2 回目 |
| adr/0001〜0009 | 判断の記録 | 1 回目（0008 は 2 回目、0009 は 2026-11-03 の改訂） |
| traceability.md | 要件 ID → 設計要素 | 1 回目は骨子と 02・03・06 の範囲、2 回目で完成 |
