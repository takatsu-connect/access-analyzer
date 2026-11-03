# ADR 0004: 言語とフレームワークの選定（バッチと BI）

- 状態: レビュー中（2026-11-03）
- 更新日: 2026-11-03
- 関係: 01_tech_stack.md、00_architecture.md §6、NFR-60、NFR-70、NFR-91

## 文脈

- 作るものは 2 つ。(1) GitHub Actions で日 1 回動くバッチ（GA4 / WP REST API から取得、正規化、伏せ値、派生指標、Supabase へ書き込み）。(2) Vercel で配信する BI（6 画面、静的生成、クライアント側で期間切り替えとフィルタ）。
- 正規化規則（pagePath、SNS 参照元、チャネル）、伏せ値のアルゴリズム、公開ビューの行の型は、バッチが書く側と BI が読む側で一致している必要がある。
- 開発者は少数（エージェントと依頼者）。運用は無人。依存の更新は Dependabot で回す。
- 小規模・低運用負荷を最優先にする。

## 選択肢

| 案 | バッチ | BI | 共有 |
| --- | --- | --- | --- |
| A（採用） | TypeScript（Node.js、`@google-analytics/data`、`@supabase/supabase-js`） | TypeScript（Next.js App Router、静的生成） | `packages/shared` に規則・型・設定を置き両方から import |
| B | Python（`google-analytics-data`、`supabase-py`、pandas） | TypeScript（Next.js） | 共有できない。規則を 2 言語で実装し、JSON Schema などで型を突き合わせる |
| C | TypeScript | Astro（静的サイト、islands） | A と同じく共有できる |

## 比較

| 観点 | A: TS + Next.js | B: Python + Next.js | C: TS + Astro |
| --- | --- | --- | --- |
| 言語の数 | 1 | 2 | 1 |
| 規則の共有（正規化、伏せ値、型） | import で共有。単体テストも 1 か所 | 二重実装。片方だけ直すずれが起きる | A と同じ |
| 依存の更新 | Dependabot の npm 1 系統 + Actions | npm + pip の 2 系統 | A と同じ |
| GA4 クライアント | 公式 Node クライアント。ADC で WIF を拾う | 公式 Python クライアント。ADC で同じ | A と同じ |
| 集計の書きやすさ | 配列操作で足りる規模（記事 300 × 日 400）。pandas は不要 | pandas で書きやすいが、規模に対して過剰 | A と同じ |
| Actions での実行 | `setup-node` + `pnpm install`。1〜2 分 | `setup-python` + `pip install`。同程度 | A と同じ |
| BI の静的生成 | `generateStaticParams`、`dynamicParams = false`。Vercel で第一級 | 同じ | 静的生成は最も得意。islands で JS を最小化 |
| 応答ヘッダ、noindex | `next.config` の `headers()` | 同じ | `vercel.json` の headers で可能 |
| 将来の ISR への移行 | 可能（ADR 0006 で不採用だが選択肢が残る） | 同じ | Vercel アダプタで可能だが Next.js ほど枯れていない |
| 実装者の慣れ | frontend-engineer は Next.js を前提にしやすい | バッチ担当が Python でも書ける利点はある | Astro の経験は Next.js より少ない見込み |
| テスト | Vitest 1 系統 | pytest + Vitest | Vitest 1 系統 |

## 決定

案 A。TypeScript（strict）で統一し、pnpm workspace の monorepo にする。

- `apps/batch`: Node.js LTS で動く CLI。`tsx` で実行（ビルド工程を持たない）。
- `apps/web`: Next.js App Router。全ページ静的生成（ADR 0006）。
- `packages/shared`: 設定値、正規化規則、伏せ値、期間計算、公開ビューの型、ロガー、環境変数の検証（zod）。
- テストは Vitest（単体・結合）、Playwright（E2E）。lint は ESLint + Prettier。

Astro（案 C）は差が小さく、05_screens.md でグラフライブラリと JS の量を見たときに再検討してよい。再検討しても `packages/shared` と `apps/batch` は変わらない。

## 結果

- 良い点: 規則と型を 1 か所で持ち、「バッチが書く列」と「BI が読む列」のずれをコンパイル時に検出できる。Dependabot と CI が 1 系統。実装者が 1 つの言語とツールチェーンで両方に手を入れられる。
- 引き受ける点: Node.js での日付・タイムゾーンの扱いに注意が要る（`Temporal` または `date-fns-tz` に固定し、JST 暦日を文字列で扱う。01 §3）。pandas のような集計の道具がないので、分位点などは自前の小さな関数（単体テスト付き）になる。
- 影響: 00_architecture.md §6 のリポジトリ構成。CLAUDE.md の「src/、tests/」は `apps/*/src`、`apps/*/tests`、`packages/*/src`、`packages/*/tests` に読み替える（CLAUDE.md の更新は親に依頼）。
