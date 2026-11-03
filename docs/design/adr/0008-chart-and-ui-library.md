# ADR 0008: グラフと UI のライブラリ（CSP の `style-src` を含む）

- 状態: 草案
- 更新日: 2026-11-03
- 関係: NFR-10、NFR-80、NFR-81、NFR-91、NFR-97、NFR-99、01_tech_stack.md §3・§5、05_screens.md §2.8、06_security.md §6、ADR 0006
- 事実の出典: context7 で 2026-11-03 に確認（Chart.js 公式文書「Accessibility」「Why Chart.js > Canvas rendering」、Recharts リポジトリ `ResponsiveContainer.tsx` / `Tooltip.tsx` / 3.0 移行ガイド）

## 文脈

- 使うグラフは 4 種類で、どれも単純: 折れ線（日別推移。前期間の薄い線、未確定の日の薄い色、公開日の点を重ねる）、横棒（構成比。前期間との比較）、分布の帯（3 区分の帯に「この記事はここ」の点）、ヒートマップ（全体のみ。曜日 × 時間帯。スマホでは 6 区分に畳む）。円グラフは使わない（05 §2.8）。
- 色は 1 色の濃淡が基本で、良し悪しの色を使わない（NFR-97）。装飾より「数字と 1 文の注記」が主役で、グラフは補助。
- 読者の 77% がスマホで、BI もスマホ優先（幅 360px、NFR-81）。ホバーに頼る操作（ツールチップ）は主の手段にできない。
- 静的生成（ADR 0006）なので、HTML に描いた状態で届くほうが初期表示（NFR-10）とアクセシビリティに有利。
- 06 §6 の CSP は `style-src 'self' 'unsafe-inline'` を「グラフライブラリの都合で必要なら許し、不要なら外す」と保留していた。静的生成で React の `style` prop を使うと、HTML に `style="…"` 属性として出力され、`'unsafe-inline'` がないと適用されない（CSSOM 経由の実行時の変更は許されるが、サーバー出力の属性は許されない）。したがって「ライブラリがインライン style 属性を出すか」が CSP の決め手になる。
- ランニングコストと運用負荷を最優先する（依存の数、更新の追従、`pnpm audit` の対象）。

## 選択肢

| 案 | 内容 | 描画 |
| --- | --- | --- |
| A | Recharts（React 向け、D3 ベースの宣言的 SVG） | SVG |
| B | Chart.js + react-chartjs-2 | canvas |
| C（採用） | 自前の SVG 部品（React コンポーネント）+ `d3-scale`、`d3-shape` だけを依存にする | SVG |

UI（レイアウト・表・折りたたみ・タブ）はどの案でも共通で、コンポーネントライブラリは入れず、CSS Modules（Next.js 標準）と `globals.css` の設計トークン（色の濃淡 5 段階、間隔、文字サイズ）で組む。Tailwind は採らない（理由は下の比較の末尾）。

## 比較

| 観点 | A: Recharts | B: Chart.js | C: 自前 SVG |
| --- | --- | --- | --- |
| CSP（`style-src`） | Tooltip と Legend は `wrapperStyle` をインライン style でラッパー div に当て、位置も translate のインライン style で指定する（Tooltip.tsx、Customise.mdx）。`'unsafe-inline'` が要る | canvas 描画で CSS を使わない（公式「canvas rendering disallows CSS styling」）。寸法は実行時に CSSOM で設定される。`'unsafe-inline'` は不要 | SVG の presentation 属性（`fill`、`stroke`、`x`、`width`）と CSS クラスだけで描く。`style` prop を lint で禁止する。`'unsafe-inline'` は不要 |
| 静的生成との相性 | `ResponsiveContainer` は幅・高さが数値で確定するときだけサーバーで描ける（ResponsiveContainer.tsx）。`width="100%"` では ResizeObserver 待ちで、HTML には空の枠が出る | canvas は HTML に描けない。JS が動くまで空。数値は DOM テキストで別に出すので致命ではない | `viewBox` と `width="100%"`（CSS）で HTML に描いた状態で届く。JS なしでも見える |
| スマホ（360px、タップ） | ホバー前提のツールチップ。タップでも動くが小さい | canvas 上のツールチップ。タップで動く | 「タップした日の値を図の下のテキスト領域に出す」を自分で決められる。ツールチップを作らない |
| 必要な図の実現 | 折れ線・横棒は得意。帯 + 点、ヒートマップは `customized` / `Cell` で作ることになり、結局自前に近い | 折れ線・横棒は得意。帯、ヒートマップはプラグイン（matrix）か自前 | 4 種類とも 1 部品ずつ書く。合計 5〜6 部品、数百行 |
| アクセシビリティ | SVG テキスト。`accessibilityLayer` あり | canvas はスクリーンリーダーに読めない。ARIA か fallback content が必要（公式「Accessibility」） | SVG に `<title>` / `<desc>`、値は表（`<table>`）を併記して読める。低リテラシー向けの「数字 + 1 文」と一致 |
| 依存 | recharts（D3 の一部を含む。大きい） | chart.js、react-chartjs-2 | d3-scale、d3-shape（小さく安定。型は `@types/d3-*`） |
| 実装の初速 | 速い | 速い | 遅い（部品を書く）。ただし図の仕様が単純で、デザインの自由度（1 色の濃淡、帯の点、公開日の点）はこちらが高い |
| 運用負荷 | 大きな依存の更新に追従 | 中 | 小（依存が小さい）。部品の保守は自前 |

Tailwind を採らない理由: 画面数が少なく、トークン（濃淡 5 段階と間隔）で足りる。生成されるスタイルシートは CSP 上問題ないが、依存とビルド設定が増える。CSS Modules は Next.js 標準で追加依存がない。動的な値（棒の長さ、濃淡）は Tailwind の任意値クラスでもインライン style でも書けないので、どちらにしても SVG 属性か段階クラスで表す。

## 決定

案 C。

- グラフは `apps/web/src/components/charts/` の自前 SVG 部品: `LineChart`（日別推移）、`HBar`（横棒。表の行に埋める小さな棒と、構成比の棒）、`BandDot`（分布の帯 + 点）、`Heatmap`（7 × 24 / 7 × 6）、`Curve`（累積曲線 + 四分位帯。LineChart と `d3-shape` の `area` を共有）。依存は `d3-scale`、`d3-shape` のみ。
- 動的な見た目は SVG 属性（`x`、`y`、`width`、`height`、`d`、`fill`、`stroke`、`opacity`）か、段階クラス（`shade-1`〜`shade-5`、`faded`）で表す。React の `style` prop と `dangerouslySetInnerHTML` を ESLint で禁止する（`react/forbid-dom-props`、`react/no-danger`。07 §7）。
- タップ / クリックの反応は「図の下の固定テキスト領域に、選んだ日や区分の値を出す」方式に統一する。ツールチップ（追従する浮動要素）は作らない。
- 値はグラフだけでなく、同じ値を表（スマホでは折りたたみ）でも出す（NFR-99、アクセシビリティ）。
- UI はコンポーネントライブラリなし。CSS Modules + `globals.css` のトークン。フォントはシステムフォント（外部フォントを読まない。CSP `font-src 'self'`）。
- **CSP: `style-src 'self'` に確定し、`'unsafe-inline'` を外す**（06 §6 を更新）。Next.js 自体は CSS Modules を `<link>` で配信し、インラインの `<style>` を出さない。開発モード（`next dev`）はこの CSP を適用しない。

## 結果

- 良い点: CSP を厳しいまま保てる。HTML に描いた状態で届く。1 色の濃淡・帯の点・公開日の点という要件固有の表現を、ライブラリの制約なしに作れる。依存が小さく、監査と更新の負荷が低い。
- 引き受ける点: frontend-engineer が 5 部品を書く（見積もり 2〜3 日）。部品の仕様は 05 §2.8 に書き、Vitest の描画テストで「順位の数字がない」「伏せ値は —」「`style` 属性がない」を検査する（07 §3）。軸の目盛りと日付ラベルの間引き（スマホで重ならないように）を自分で決める必要がある。
- 選ばなかった案を再検討する条件: 図の種類が増える（散布図、積み上げ、ズーム）か、部品の保守が負担になったとき。そのときは案 B（canvas、CSP 不要）を第一候補にする。案 A は `'unsafe-inline'` を要する限り採らない。
- 残る CSP の課題（この ADR の範囲外、実装時に確認。06 §13）: Next.js App Router の静的生成は RSC ペイロードをインライン `<script>` で出すため、`script-src 'self'` だけでは動かない可能性がある。nonce は実行時のレンダリングが要るので静的生成と両立しない。対応は (1) インラインスクリプトの hash を列挙する、(2) `script-src` にだけ `'unsafe-inline'` を許し `'strict-dynamic'` と組み合わせる、のいずれかで、security-auditor と決める。`style-src` の判断には影響しない。
