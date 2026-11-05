# apps/web — 高津コネクト アクセス解析 BI（画面）

- 更新日: 2026-11-05
- 設計: docs/design/04_api.md（データの契約）、05_screens.md（画面）、06_security.md §6・§7、ADR 0006（静的生成）、ADR 0008（グラフと UI）、ADR 0010（CSP）

Next.js（App Router）で全ページを静的生成する。ビルド時に Supabase の公開ビュー（`pub_*`）を読み、ページごとのデータを HTML に埋め込む。実行時のサーバー処理（Route Handler、Server Actions、Middleware）は作らない。

## 動かし方

前提: Node 24、pnpm。データはローカルの Supabase から読む（Docker を起動し、リポジトリ直下で `npx supabase start`）。フィクスチャは `apps/batch` で `PYTHONPATH="src;tests" .venv/Scripts/python.exe -m support.load_e2e_fixture` を実行して入れる。接続先は `apps/web/.env.local`（git に入れない）に `SUPABASE_URL` と `SUPABASE_ANON_KEY` を書く。`NEXT_PUBLIC_` で始まる変数は作らない。

| コマンド         | 内容                                                                              |
| ---------------- | --------------------------------------------------------------------------------- |
| `pnpm run check` | lint、書式、型、単体テスト、文字列の検査（07 §7 の S-01〜S-05、S-07、S-12、S-16） |
| `pnpm run build` | 静的生成。Supabase を読む                                                         |
| `pnpm run e2e`   | Playwright。先に `pnpm run build` が要る                                          |
| `pnpm run dev`   | 開発サーバー                                                                      |

## ファイルの置き方

| 場所                     | 役割                                                                                                                                                                                              |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/app/**/page.tsx`    | ページ。Server Component。`@/data` の入口を呼んでデータを取り、画面の部品に渡すだけ。動的なパスは `generateStaticParams` と `export const dynamicParams = false`。データが null なら `notFound()` |
| `src/screens/sXX/`       | 画面の部品（05 の画面 ID ごと）。期間の切り替えなどの操作を持つので Client Component（`'use client'`）。データは props で受ける                                                                   |
| `src/components/`        | 共通部品（ヘッダ、`PeriodPicker`、`ArticleTable`、`MaskedCell`、`KpiCard` など）と、URL のクエリのフック（`useQueryState`、`usePeriod`）                                                          |
| `src/components/charts/` | 自前の SVG のグラフ（`LineChart`、`Curve`、`HBar`、`MiniBar`、`BandDot`、`Heatmap`）                                                                                                              |
| `src/lib/`               | 型（`page-data.ts`）、辞書（`ui-text.ts` と `ui-text/screens/`）、書式（`format.ts`）、表示用の計算（`derive/`）、クエリの検証（`query.ts`）、設定値（`config.ts`）                               |
| `src/data/`              | 公開ビューの読み出し（`pub/`。Supabase を読むのはここだけ）と、ページのデータの組み立て（`pages/`）。入口は `src/data/index.ts`                                                                   |
| `tests/`                 | Vitest。`lib`・`lint`・`data` は node、`components`・`screens` は jsdom                                                                                                                           |
| `e2e/`                   | Playwright                                                                                                                                                                                        |

`src/app/layout.tsx` が、ヘッダ、`DataStatus`（◯月◯日までのデータです）、`<main>`、`CommonNotes`（このページの数字について）、フッタを持つ。ページと画面の部品は `<main>`、`DataStatus`、`CommonNotes` を書かず、h1 から始まるフラグメントを返す。

## 画面を作るときの決まり

文言:

- 画面に出る日本語は、すべて辞書から `t(key, params)` で取る。JSX に文字列を直接書かない（lint が止める）。
- 画面ごとの文言は `src/lib/ui-text/screens/sXX.ts` に足す。キーは画面の接頭辞（`s01.` など）で始める。共通の文言（`metric.*`、`band.*`、`notes.*`、`absent.*`、`column.*` など）は `src/lib/ui-text.ts` にある。
- 使わない語: 偏り、下位、読まれなかった、少ない、悪い、低い、ランキング、順位、ワースト、ベスト、あなた。「出ません」で終わる文を作らない。まだ値がないものは「〜になると出ます」の形にする。
- 著者は表示名で「◯◯さんの…」と書く。著者の slug は href にだけ使い、文字として出さない。

数字:

- 順位の数字（連番）をどの表にも付けない。著者同士を比べる表示、著者を数値で並べ替える表示を作らない。
- 伏せ値（データの null）は `MaskedCell` で「—」と「伏せ値」。0 は「0」。伏せ値でない「値がない」は、文字で書く（`absent.*`）。
- 比率（%）は分母が 20 以上のときだけ（`compare`、`share`、`tenOf` がそう返す）。前の期間との比較は `Delta`。
- 記事では前の期間と比べない（S-03）。数字には比較の相手を 1 つ添える: 前の期間、全記事の分布（帯）、著者自身の過去のいずれか。
- 数と日付は `format.ts` の関数で書く。`Date` のローカルのタイムゾーンに頼らない。
- 数え始める前（`meta.measureStart` より前）に公開した記事は、`PostRow.isPreMeasure` で文言を切り替える。null から理由を推測しない。

見た目と安全:

- `style` prop、`dangerouslySetInnerHTML`、`<script>`、`iframe`、生の `<a>`、`innerHTML` などは使えない（lint が止める。無効化コメントも使えない）。CSS は CSS Modules と `globals.css` のトークンだけ。色は基調色の濃淡とグレーだけで、赤・緑・黄などの評価色を使わない。
- サイト内のリンクは `next/link`（`prefetch={false}`）か `ArticleLink` / `AuthorLink`、外部は `ExternalLink`（`https://takatsu-connect.com/` 配下だけをリンクにする）。値から URL を組み立てない。
- 狭い画面（幅 600px 未満。360px で設計）で横スクロールを出さない。表は 4 列までにし、残りは「詳しく」に入れる。
- 図には同じ値の表を併記する（狭い画面では `Details` に入れてよい）。ツールチップは作らない。

状態:

- 期間や絞り込みは URL のクエリで持つ。`useQueryState(allow)` か `usePeriod(periods)` を使う。Next.js の `useSearchParams` は使わない（静的な HTML が空になる）。
- 静的な HTML には、既定の状態（直近 28 日）で描いた内容が入る。URL のクエリは、マウント後に読んで切り替える。
