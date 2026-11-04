# ADR 0004: 言語とフレームワークの選定（バッチと BI）

- 状態: 確定（2026-11-04。依頼者の確認済み。実装時の確認項目は ADR 0009 にある）
- 更新日: 2026-11-03
- 関係: 01_tech_stack.md、00_architecture.md §6、ADR 0009、NFR-60、NFR-70、NFR-91
- 変更履歴:
  - 2026-11-03: 依頼者の指示「各所で得意な言語を選ぶ」により決定を変更。バッチを Python、BI を TypeScript とし、`packages/shared` を廃止。前回の決定（TypeScript 統一）は案 B として残す
  - 2026-11-03: 書き込み経路の監査（以下「経路監査」。docs/security/audits/2026-11-03-write-path-review.md）の W-7、W-9、L-7 を反映。案 A と P1 に異論なし。依存の更新の備えと、起動時の出力の塞ぎ方を追加。`colorama` を本番のロックから外す

## 文脈

- 作るものは 2 つ。(1) GitHub Actions で日 1 回動くバッチ（GA4 / WP REST API から取得、正規化、伏せ値、派生指標、Supabase へ書き込み）。(2) Vercel で配信する BI（6 画面、静的生成、クライアント側で期間切り替えとフィルタ）。
- 依頼者の指示（2026-11-03）: 各所で得意な言語を選ぶ。バッチのデータ処理は Python、Web の画面は TypeScript。
- 前回の決定は TypeScript 統一で、理由は「規則と型を両側で共有できる」だった。設計が進んだ結果、両側で共有が要るものは少ないと分かった（下の「共有の実態」）。
- 開発者は少数（エージェントと依頼者）。運用は無人。依存の更新は Dependabot で回す。小規模・低運用負荷を最優先にする。
- GitHub Actions の許可は GitHub 製 + verified creators + `google-github-actions/*` だけで、SHA 固定が必須（06 §9）。

### 共有の実態

| 対象 | 使う側 | 扱い |
| --- | --- | --- |
| 正規化（pagePath、SNS、チャネル）、伏せ値、二次伏せ、累積、判定、期間計算 | バッチだけ | Python に置く。BI は結果を公開ビューから読むだけ |
| `compare`、`share`、`fold6`、URL クエリの検証、辞書（`ui-text.ts`）、公開ビューの型、埋め込み JSON の型 | BI だけ | `apps/web` に置く |
| 公開ビューの列 | バッチは内部表に書き、ビューの列は BI が読む | 共有の相手はコードではなくビューの定義。`tests/snapshots/pub-columns.json`（07 I-DB-16、I-DB-11）で固定する |
| バケット名（チャネル 5 区分、SNS 5 区分、axis など）、鮮度区分、`SITE_ORIGIN` | 両方 | 両言語に定数を持ち、`contracts/constants.json` と突き合わせるテストでずれを止める（07 S-16） |
| 分布と帯 | 公開ビュー（SQL） | `quantiles` / `band` はビューと突き合わせる参照実装で、結合テストの補助として `apps/batch/tests/support/` に置く |

## 選択肢

### (1) 言語とフレームワーク

| 案 | バッチ | BI | 共有 |
| --- | --- | --- | --- |
| A（採用） | Python（`google-analytics-data`、`psycopg`、`pydantic`、`httpx`） | TypeScript（Next.js App Router、静的生成） | コードは共有しない。公開ビューのスナップショットと定数の突き合わせで固定する |
| B（前回の決定） | TypeScript（Node.js、`@google-analytics/data`、`@supabase/supabase-js`） | TypeScript（Next.js App Router、静的生成） | `packages/shared` に規則・型・設定を置き両方から import |
| C | TypeScript | Astro（静的サイト、islands） | B と同じ |

### (2) Python のパッケージ管理

| 案 | ロックの作り方 | Actions での導入 | 評価 |
| --- | --- | --- | --- |
| P1（採用） | `pip-compile --generate-hashes`（pip-tools）で `requirements.txt` と `requirements-dev.txt` を生成 | `actions/setup-python` と `pip install --require-hashes --only-binary :all: -r requirements.txt` | `actions/setup-python` だけで成り立つ。追加の Action の許可確認が要らない。ロックは実行環境に依存して解決される弱みがある（結果の節） |
| P2 | `uv lock` | `astral-sh/setup-uv` | 速く、1 つのロックで複数 OS を扱える。ただし setup-uv は許可の確認が要るので使わない |
| P3 | `uv lock` | `pip install uv` で導入 | Action の問題は避けられるが、ロックの外で導入する uv の固定が別に要り、依存の入口が 2 つになる |

## 比較

| 観点 | A: Python + Next.js | B: TS + Next.js | C: TS + Astro |
| --- | --- | --- | --- |
| 言語の数 | 2 | 1 | 1 |
| 規則の共有 | 共有が要るものは少ない（上の表）。残りは突き合わせテストで止める | import で共有 | B と同じ |
| 依存の更新 | Dependabot の pip、npm、github-actions | npm、github-actions | B と同じ |
| GA4 クライアント | 公式 Python クライアント。ADC で WIF の資格情報を拾う | 公式 Node クライアント。同じ | B と同じ |
| 日付と集計の書きやすさ | 標準の `datetime`、`zoneinfo`、`statistics` で足りる。JST 暦日を `date` で扱える | `Temporal` か `date-fns-tz` の選択が残る。分位点は自前 | B と同じ |
| Postgres への書き込み | `psycopg` のトランザクションと `executemany`（ADR 0009） | `pg` でも可能 | B と同じ |
| Actions での実行 | `setup-python` + `pip install`。日次ワークフローから Node.js を外せる | `setup-node` + `pnpm install` | B と同じ |
| BI の静的生成 | `generateStaticParams`、`dynamicParams = false`。Vercel で第一級 | 同じ | 静的生成は最も得意。islands で JS を最小化 |
| 応答ヘッダ、noindex | `next.config` の `headers()` | 同じ | `vercel.json` の headers で可能 |
| テスト | pytest + Vitest | Vitest 1 系統 | Vitest 1 系統 |
| 依頼者の指示との一致 | 一致 | 一致しない | 一致しない |

## 決定

案 A と P1。

- `apps/batch`: Python。依存は `requirements.txt`（ハッシュ固定）、テストは pytest、lint は ruff、型検査は mypy、検証は pydantic。パッケージは `apps/batch/src/takatsu_batch/`、実行は `python -m takatsu_batch <サブコマンド>`。ビルド工程を持たない。
- `apps/web`: TypeScript（strict）、Next.js App Router。全ページ静的生成（ADR 0006）。pnpm、Vitest、Playwright、ESLint、Prettier。
- `packages/shared` と pnpm workspace は廃止する。BI 専用の内容（`ui-text.ts`、`pub-types.ts`、`page-data.ts`、`query.ts`、`derive/`、BI の設定値）は `apps/web/src/lib/` へ移す。正規化、伏せ値、ログ、環境変数の検証は `apps/batch/src/takatsu_batch/` の Python モジュールに置き換える。`apps/web` は単独の pnpm プロジェクトで、ロックファイルは `apps/web/pnpm-lock.yaml`。
- 言語をまたぐ定数は `contracts/constants.json` を正とし、pytest と Vitest の両方で自分の定数と一致することを検査する（07 S-16）。実行時には読まない。Vercel の Root Directory を `apps/web` にしても、ビルドがリポジトリ全体に依存しないようにするため。
- 依存監査は `pip-audit` と `pnpm audit`。更新は Dependabot（pip、npm、github-actions）。
- 依存の更新の備え（W-9。詳細は 06 §10）: ハッシュ固定と wheel のみは、インストール時の実行と差し替えを止める。ただし wheel のコードは import 時に接続文字列の下で動く。そこで Dependabot に `cooldown`（例: 7 日。セキュリティ更新を除く。要確認 V-6）を設定し、自動 merge を禁止する。週 1 の `schedule` で `pip-audit` と `pnpm audit` を流し、失敗を通知する。Dependabot が pip-compile のハッシュを再生成することを初回の PR で確かめる。

Astro（案 C）は差が小さく、BI の JS の量を見たときに再検討してよい。再検討しても `apps/batch` は変わらない。

## 結果

- 良い点: 依頼者の指示に沿う。日次ワークフローが Node.js のツールチェーンと npm の依存を持たないので、Secrets の下で動く依存が減る。JST の扱いが標準ライブラリで足りる。BI と無関係な依存が `apps/web` に入らない。
- 引き受ける点:
  - テストと依存更新が 2 系統になる。CI の所要時間も増える。
  - 型の一貫性をコンパイル時に検出できなくなる。「バッチが書く値」と「BI が読む値」のずれは、CI の突き合わせ（S-16、I-DB-16）と、BI のビルド時の zod 検証（ビルド失敗なら前回のデプロイが残る。04 §4）で止める。
  - pip-compile の結果は実行した OS と Python の版に依存する。正のロックは Linux と CI と同じ Python 版で生成する（手順は 01 §4）。Windows の開発環境でだけ要る依存のうち、`tzdata` は `requirements.in` に明示して、同じロックを使えるようにする。`colorama` は本番のロックに入れず、`requirements-dev.in` に寄せる（経路監査 L-7）。これで足りるかは実装時に確認する。
  - Python の例外は既定でメッセージとスタックを stderr に出す。pydantic の検証エラーは入力値を含み、psycopg の例外は行の値を含みうるので、ログの規律を Python に合わせて作り直した（03 §14・§15）。ネイティブのライブラリの出力も塞ぐため、本番のエントリは起動の最初に fd 2 を `/dev/null` へ向ける（W-7）。ネイティブのクラッシュは Actions のログに何も残らず、終了コードだけになる。原因はローカルの再現で調べる。出力を戻すフラグや環境変数は作らない。
- 影響: 00_architecture.md §6 のリポジトリ構成。CLAUDE.md の「src/、tests/」は `apps/*/src`、`apps/*/tests` に読み替える（CLAUDE.md の更新は親に依頼）。
