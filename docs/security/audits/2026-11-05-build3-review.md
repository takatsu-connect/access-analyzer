# セキュリティ監査: 構築 3（BI、apps/web）

- 状態: 草案（依頼者の確認の前）
- 更新日: 2026-11-06（監査の開始は 2026-11-05。ファイル名は依頼の指定どおり）
- 監査者: security-auditor
- 対象: apps/web（構築 3。画面 S-01〜S-08 の実装後。コミット 3f31676 の時点）

## 1. 範囲と読んだファイル

範囲は、BI アプリ（apps/web）のコードを読んで分かること。観点 1（公開するデータ）、2（秘密）、5（BI アプリ）、6（依存）と、ADR 0010 の「かわりに守ること」1〜8 への準拠。コード、設定、ADR は変更していない。E2E とビルド出力の検査は別の担当が作っているので、重ならないようにした（応答ヘッダの実測、インライン script の形、バンドルの中身は見ていない）。

読んだファイル:

- 規則と設計: .claude/rules/security.md、docs/design/06_security.md 109〜131 行、docs/design/adr/0010-csp-script-src.md 69〜105 行、docs/security/audits/2026-11-05-csp-script-src.md 1〜60 行（体裁と前回の条件）
- 設定: apps/web/next.config.ts、eslint.config.mjs、eslint-rules/pub-from-only.mjs、package.json
- 入力と出口: src/lib/query.ts、src/components/useQueryState.ts、src/lib/derive/links.ts、src/components/ExternalLink.tsx、SiteLinks.tsx、SiteHeader.tsx、SkipLink.tsx
- 動的なパスとエラー: src/app/articles/[postId]/page.tsx、authors/[slug]/page.tsx、tags/[id]/page.tsx、not-found.tsx、error.tsx、layout.tsx
- データの入口: src/data/pub/client.ts、load.ts、src/lib/page-data.ts
- 伏せ値の周り: src/lib/derive/heatmap.ts、channel.ts、src/screens/s03/ShareBars.tsx、s05/ReferrerSection.tsx 14〜63 行、s01/Breakdown.tsx 20〜69 行、s02/S02eScreen.tsx 30〜159 行

画面のコードは全体を読まず、次の語で検索して該当箇所だけを見た: `href=`、`window.`、`location`、`history.`、`document.`、`localStorage`、`sessionStorage`、`fetch(`、`new URL`、`RegExp(`、`.match(`、`.replace(`、`createElement`、`cloneElement`、`useRef`、`setAttribute`、`createPortal`、JSX のスプレッド、`<title`、`aria-label=`、`title=`、`.slug`、`authorSlug`、`.reduce(`、`total -`、`throw new`、`.parse(`、`from '@/data`、`server-only`、`process.env`、`console.`。

読み取りコマンドで確かめたこと:

- `git log -- apps/web/package.json`: 変更は 8088928（構築 3 の土台）の 1 回だけ。
- `git ls-files`: apps/web/pnpm-lock.yaml は追跡されている。`.github/` に追跡されたファイルはない。src/app に `global-error.tsx`、Route Handler、Middleware はない。
- `pnpm audit`（apps/web）: 中 1 件（minimatch 10.2.6、GHSA-g3hv-75wg-m249。直る版は 11.0.1 以上）。致命的・高は 0 件。

読んでいないもの: usePeriod.ts、PeriodPicker、DataStatus、CommonNotes、charts の各部品の中身、src/lib/page-data-schema.ts、src/data/pages/ の組み立ての全体、テスト、e2e。`gh api` による GitHub の設定の確認はしていない（今回の範囲外）。外部の文書は取っていない。ESLint、eslint-plugin-react、Next.js、zod の挙動についての記述は監査者の知識によるもので、§6 に分けて書いた。

## 2. 結論

**判断: 修正後に公開。構築は進めてよい。**

致命的 0、高 0、中 2、低 6、情報 4。

- 今のコードに、値を HTML として描く経路、利用者の入力から URL やリンク先を作る経路、秘密がブラウザに渡る経路は見つからなかった。公開される項目（page-data.ts）は規則の範囲に収まっている。
- 中の 2 件は、どちらも ADR 0010（`'unsafe-inline'` を許す判断）を支える側の話である。1 つは ADR の見直し条件に S-02e の検索欄が文言上当たること（M-1）、もう 1 つは lint の歯止めに抜け道が残ること（M-2。今のコードに該当の書き方は 0 件）。ADR 0010 を「確定」にする前と、初回公開の前に片づける。
- ADR 0010 の 7（lint、E2E、ビルド後の検査を CI の必須チェックにする）は、`.github/` がまだないので未了。デプロイ工程の残りとして §7 に書いた。

## 3. 指摘（重要度順）

### 致命的

なし。

### 高

なし。

### 中

#### M-1 ADR 0010 の見直し条件「訪問者が入力する欄を足すとき」に、S-02e の検索欄が文言上当たる

- 対象: docs/design/adr/0010-csp-script-src.md:86、apps/web/src/screens/s02/S02eScreen.tsx:97-107、apps/web/src/lib/query.ts:122-128
- 確かめたこと:
  - ADR:83-86 は「どれかに当たれば、案 A のままにしない」条件に「訪問者が入力する欄…を足すとき」を挙げている。
  - S-02e には `<input type="search">` があり、打った文字は `?q=` として URL に書き戻される。
  - `q` の経路は、`parseQuery`（NFC、前後の空白を除く、1〜50 文字）→ 題名との部分一致（`foldText(...).includes(needle)`、rows.ts:110）→ 入力欄の `value`（React の値）→ `URLSearchParams` による符号化、だけである。正規表現、HTML、問い合わせには入らない。`form-action 'none'` と `connect-src 'self'` で、外へ送る経路もない。
- 問題: 匿名の第三者がリンク 1 本でページに持ち込める文字列は、いまのところ `q` だけである。CSP がインラインの script を止めない構成で、その入口についての判断が ADR に書かれていない。ADR の条件を文字どおり読めば、検索欄を実装した時点で案 A は見直しになる。検索欄は ADR より前から設計（04 §8）にあったので、書いた側の意図は「秘密や個人情報を入れる欄」だったと思われるが、ADR の 69〜105 行からは読み取れない（推測。ADR の前半は読んでいない）。
- 起こりうること: 将来、`q` を見出しや「◯◯ の検索結果」のような文に HTML として差し込む変更が入ると、リンクを踏ませるだけでスクリプトが動く。今のコードではそうなっていない。
- 直し方の案:
  1. ADR 0010 に、S-02e の検索欄を名指しで書く。条件の文言を「秘密や個人情報を入力させる欄、または入力をサーバーや外部へ送る欄を足すとき」に絞るか、検索欄を例外として理由（送らない、秘密でない、React の値としてだけ描く）を書く。
  2. 「かわりに守ること」に、URL のクエリ由来の値（`q`）も記事の題名と同じ扱い（テキストと属性値にだけ使う）であることを足す。
  3. E2E の担当への申し送り: フィクスチャ（データ側）だけでなく、`?q=` に HTML として解釈されうる文字列を入れた URL を開く場合も E-01 に入れる。
- 関係する要件: NFR-91、FR-24、ADR 0010

#### M-2 lint の歯止めに抜け道が残る（今のコードに該当の書き方はない）

- 対象: apps/web/eslint.config.mjs:51-126
- 前提: ADR:74 のとおり、案 A では静的検査が主な守りになる。
- 確かめたこと（コード側）: `createElement`、`cloneElement`、`useRef`、`setAttribute`、`createPortal` の一致は src に 0 件。JSX のスプレッドは 6 か所で、すべて自前の部品（`HBar`、`LineChart`、`Heatmap`、`HeatmapTable`）に対するもので、DOM 要素へのスプレッドはない。`window.open`、`location.assign`、`location.href` への代入もない。
- 抜け道（設定を読んだ結果。挙動は監査者の知識で、実機では確かめていない。§6）:
  1. DOM 要素へのスプレッド。`<div {...props}>` の中の `dangerouslySetInnerHTML` と `style` は、`react/no-danger` と `react/forbid-dom-props` が見ない。
  2. `createElement` の props。`createElement('div', { dangerouslySetInnerHTML: … })` は `react/no-danger` の対象外（JSX の属性だけを見る）。
  3. `createElement('script')` の規則（:65-69）は、`x.createElement('script')` の形で第 1 引数がリテラルのときだけ当たる。`import { createElement } from 'react'` して直接呼ぶ形、タグ名が変数の形は通る。
  4. 変数のタグ名。`const Tag = 'a'`（または `'script'`）として `<Tag …>` と書くと、`react/forbid-elements` を通る。`a` を ExternalLink だけに限る決まりも、ここで外れる。
  5. `next/link` の `href`。データ由来の値を渡すことへの歯止めがない。`react/jsx-no-script-url` は既定では `a` の `href` のリテラルだけを見る。いまの `Link` の href は、固定の文字列、`/articles/${検証した整数}`、`/tags/${数}`、`/authors/${encodeURIComponent(slug)}`、`{ pathname: '/articles', query }`、`#main` だけで、問題はない。
  6. 移動の出口。`location.assign`、`location.replace`、`location.href =`、`window.open` は禁止されていない（ADR の 3「値から URL を作らない」の JSX の外の側）。
  7. `setAttribute` の規則（:75）は、第 1 引数がリテラルの `on…` のときだけ。`setAttribute('href', 値)`、`setAttribute('srcdoc', 値)`、名前が変数の形は通る。
- 起こりうること: 将来の変更でこれらの書き方が入ると、lint は通り、CSP も止めない。E2E のフィクスチャがその画面と値を通っていれば見つかるが、通っていなければ残る。
- 直し方の案:
  - `react/jsx-props-no-spreading` を DOM 要素にだけ効かせる（`html: 'enforce'`、`custom: 'ignore'`）。
  - `no-restricted-syntax` に、`Property[key.name='dangerouslySetInnerHTML']`、`CallExpression[callee.name='createElement']`、`CallExpression[callee.property.name='createElement']`（引数を問わない）、`CallExpression[callee.name='cloneElement']` を足す。`no-restricted-imports` で `react` の `createElement`、`cloneElement` の import を止める。
  - `no-restricted-properties` に `location.assign`、`location.replace`、`window.open` を足し、`AssignmentExpression[left.property.name='href']` を止める。`setAttribute` は src では全面禁止にする（いま 0 件）。
  - `next/link` を import できるファイルを、`SiteLinks.tsx`、`SiteHeader.tsx`、`SkipLink.tsx`、`not-found.tsx` と、固定のパスだけを渡す画面に限るか、href をテンプレートで作る箇所を `SiteLinks.tsx` に集める（`/tags/${id}` の TagsScreen.tsx:22 と、CategoriesScreen.tsx:29 を移す）。
  - 規則ごとに「落ちるべき書き方」のフィクスチャを置き、lint が落とすことをテストで確かめる（規則が効いていることの証拠になる。プラグインの更新で黙って効かなくなるのも防げる）。
- 関係する要件: NFR-91、ADR 0010 の 1・2・3・6、07 S-03、S-04

### 低

#### L-1 `replaceState` に渡す URL を `pathname` の連結で作っている

- 対象: apps/web/src/components/useQueryState.ts:58-61
- 確かめたこと: `${pathname}?${query}${hash}` を相対 URL として渡している。`query` は `toQueryString` が検証と符号化をした値で、`hash` は現在の値そのまま。
- 起こりうること: パスが `//` で始まる URL でページが開かれた場合、この文字列は別のホストを指す URL として解釈され、`replaceState` が例外を投げる（別のサイトへ移動はしない）。操作が効かなくなるだけで、害は開いた本人にとどまる。Vercel が `//` で始まるパスにページを返すかは未確認。
- 直し方の案: `const next = new URL(window.location.href); next.search = query; window.history.replaceState(null, '', next);` のように、いまの URL から作る。

#### L-2 著者の slug の形の定義が 3 か所で違う

- 対象: apps/web/src/data/pages/shared.ts:34（`/^[a-z0-9-]+$/`）、src/app/authors/[slug]/page.tsx:11 と src/lib/query.ts:106（どちらも `{1,64}`）
- 起こりうること: 65 文字以上の slug の著者がいると、リンクは描かれるのにページは 404 になり、S-02e の絞り込みも効かない。セキュリティ上の害はない。WordPress の slug は 50 文字までのはずなので、実際には起きにくい（監査者の知識）。
- 直し方の案: 定数を 1 つにして 3 か所から使う。06 §7 の記述（`^[a-z0-9-]+$`）も合わせる。

#### L-3 BI 側のスキーマが、文字列の形と長さを確かめていない

- 対象: apps/web/src/data/pub/schemas.ts:14（`const text = z.string()`）、51-61、127、135、167
- 確かめたこと: `source_domain`、`city`、`title`、`display_name`、`post_url`、`author_url`、`author_slug` は、どれも形の検査のない文字列。URL は描く直前に `safeExternalUrl` が、slug は `SLUG_PATTERN` が確かめている。参照元ドメインと市の名前には BI 側の検査がない。参照元ドメインはリンクにしておらず、文字として描くだけ（`href=` の検索で確認）。
- 起こりうること: 参照元ドメインは、第三者が偽の参照元でアクセスを重ねれば入れられる値である。しきい値を超えて上位に入ると、任意の文字列（宣伝や誘導の文言、長い文字列）が公開ページに載る。スクリプトの実行にはつながらない。バッチの側でドメインの形を確かめているかは、今回は見ていない。
- 直し方の案: `source_domain` にドメインの形と長さ（バッチと同じ定義）を、名前の類に長さの上限を足す。外れた行は落とすか、ビルドを止める（前日の版が残る）。

#### L-4 `@/data` を Client Component から import できないようにする歯止めがない

- 対象: apps/web/src/data/pub/client.ts、load.ts、src/data/index.ts
- 確かめたこと: `@/data` を import しているのは src/app の page.tsx と layout.tsx だけで、どれにも `'use client'` はない。`'use client'` のある 35 ファイルに `@/data` の import はない。`server-only` の import は 0 件。
- 起こりうること: 画面の部品から誤って import すると、supabase-js と読み出しのコードがブラウザ向けに束ねられる。環境変数は `NEXT_PUBLIC_` の名前ではないので値は入らないはずだが（監査者の知識）、気づくのがビルド出力の検査まで遅れる。
- 直し方の案: `src/data/index.ts`（または client.ts）の先頭に `import 'server-only'` を置く。あるいは lint の `no-restricted-imports` で、src/screens と src/components からの `@/data` を止める。

#### L-5 ページのデータの検査が、zod の例外をそのまま投げる

- 対象: apps/web/src/data/pages/activity.ts:104、authors.ts:46・163、articles.ts:148・290、dashboard.ts:161 ほか（`…DataSchema.parse(data)`）
- 確かめたこと: 読み出しの層（load.ts:258-259）は `safeParse` を使い、ビューの名前と種類だけの例外に置き換えている。ページの組み立ての層は `parse` で、zod の例外がそのままビルドのログに出る。ほかの `throw new Error` は固定の文で、値を含まない。
- 起こりうること: zod の例外の文面に、行の値（題名や名前）が含まれる場合がある（監査者の知識。zod 4 の文面は未確認）。規則は「ログに出すのは件数、所要時間、エラーの種別まで」。値は公開ビューのもので秘密ではないが、ビルドを GitHub Actions で行う構成にすると、public のログに行データが出る。
- 直し方の案: load.ts と同じく `safeParse` にして、ページの名前だけを持つ固定の例外に置き換える。

#### L-6 minimatch の中 1 件（開発用の依存）

- 対象: apps/web/pnpm-lock.yaml（minimatch 10.2.6。`eslint-config-next` と `typescript-eslint` から `@typescript-eslint/typescript-estree` 8.72.1 を経由。18 経路）
- 確かめたこと: `pnpm audit` で中 1 件。直る版は 11.0.1 以上で、10 系に直った版はない（audit の出力）。本番の依存（`dependencies` の 7 個）には含まれない。
- 評価: 害は、細工したパターンを渡されたときに処理が重くなること。この依存が受け取るパターンは自分の設定ファイルのものだけで、利用者の入力は届かない。BI の配信物にも入らない。規則の「致命的または高が残った状態でデプロイしない」には当たらない。
- 扱いの意見:
  - `pnpm.overrides` で 11 系へ上げるのは勧めない。メジャーをまたぐので lint が黙って壊れるおそれがあり、案 A では lint が主な守りなので、そちらの害のほうが大きい。上げるなら、M-2 の「落ちるべき書き方」のテストを先に入れてから。
  - `typescript-eslint` と `eslint-config-next` の更新を Dependabot で待つ。アラートは消さずに残すか、「本番で使わないコード」として理由と見直しの日付を書いて閉じる。どちらにするかは依頼者の判断（§5）。

### 情報

#### I-1 著者ごとの数値が、ページの JSON から分かる範囲

- S-04（AuthorIndexData）: 名前、slug、URL だけ。数値はない。
- S-02e と一覧の `authors[]`: slug と名前だけ。数値はない。
- S-08（`ActivityData.authorCounts`、page-data.ts:303）: 期間ごとに、全著者の名前と公開本数が 1 つの JSON に載る。名前の順で、0 本の著者は載らない。M-31、FR-51 で確定した設計どおり。画面で並べ替えはできないが、JSON を読めば本数の順に並べられる。
- S-02e（記事を探す）: 全記事の `authorName`、`authorSlug` と、`pvTotal`、`pv7`、`pv30`、`pvByPeriod` が 1 つの JSON に載る。著者ごとに足せば、読まれた回数の合計を著者同士で比べられる。記事ごとの数字に著者名を添える設計（FR-20、FR-24）から避けられない。設計がこの残りを明記しているかは未確認（06 §4 は読んでいない）。依頼者の判断事項に入れた（§5）。
- S-05（AuthorPageData）: 著者 1 人分の合計がページごとに載る。1 ページにまとまってはいない。

#### I-2 slug の出る場所

- 画面の文字にはなっていない（NFR-35）。使われるのは、`key`、サイト内リンクの href、S-02e の `option` の `value`、URL の `?author=` だけ（`.slug`、`authorSlug` の検索で確認）。`?author=` はアドレスバーに出るが、`/authors/<slug>` と同じ扱いである。

#### I-3 外部リンクの `rel` は `noopener` だけ

- ExternalLink.tsx:24。`noreferrer` はない。応答ヘッダの `Referrer-Policy: strict-origin-when-cross-origin` により、高津コネクトへ渡るのは BI のオリジンだけで、`?q=` や `?author=` は渡らない（06 §6 の意図どおり）。ヘッダが外れた環境でも同じにしたければ、`a` に `referrerPolicy` の属性を足す。任意。

#### I-4 `global-error.tsx` がない

- error.tsx は固定文だけを出し、`error` の中身を受け取っていない。not-found.tsx も固定文と固定のリンクだけ。ルートのレイアウトで起きたエラーには error.tsx が効かず、Next.js の既定の画面になる（本番では固定文のはず。監査者の知識）。静的生成なので、`generateMetadata` を含むサーバー側の例外はビルドの失敗になり、ページには出ない。

## 4. 規則と ADR 0010 に照らして問題がなかった項目

### 公開するデータ

- page-data.ts の次元は、記事、著者の表示名、カテゴリ、タグ、日付（日、曜日 × 時間、月）、デバイス、流入チャネルと SNS の種類、参照元ドメイン、都道府県と市。規則の列挙にない「新規 / リピーター」は要件に ID がある（M-15）。川崎 / 国内のその他 / 不明の区分は、市区より粗い。
- 著者について載るのは、表示名、slug、著者ページの URL だけ。メール、ログイン名、ユーザー ID、アバターはない。
- ユーザー ID、完全な参照 URL、サイト内検索語（GA4 のもの）、IP、リアルタイムの値に当たる項目はない。
- 読むビューは `pub_*` の 31 個だけで、名前は文字列リテラル（load.ts:92-230、lint の `local/pub-from-only`）。列は列挙して読む。
- 伏せ値の周りで、画面が新しく和や差を作っている箇所はなかった。
  - heatmap.ts:28-31: 6 区分に畳むとき、伏せ値が 1 つでもあれば区分ごと伏せる。
  - ReferrerSection.tsx:26-33: 区分の和は、全区分が見えているときだけ使う。
  - numbers.ts:29-39、ShareBars.tsx、Breakdown.tsx: 比率は見えている値にだけ出し、伏せ値の区分は伏せたまま。「合計 − 見えている値」を計算している箇所はない（`total -`、`- total` の検索で 0 件）。
  - channel.ts:14-25: 見えている値の最大が 0 なら、最多の区分を名指ししない。
  - 合計の列と見えている区分が同じ JSON に載ることによる逆算は、格納の側の話で、ADR 0003 判断 7 の範囲（今回の対象外）。

### 入力の検証

- `p`、`n`、`cat`、`author`、`ym`、`sort`、`line`、`heat`、`axis` は、形の照合のあと、埋め込んだ一覧との照合か固定の値への読み替えを通る。外れた値は既定値になり、エラーは出ない。同じ名前が複数あれば最初の値だけを見る。その画面が使わないパラメータと未知のパラメータは落ちる（query.ts:130-179）。
- URL へ書き戻す前にもう一度検証し、`URLSearchParams` で符号化する（query.ts:196-216）。
- `q` は正規表現に入らない（`RegExp(` は src に 0 件）。長さは 1〜50 文字。入力欄にも `maxLength` がある。
- パスの値: 記事とタグの ID は `^[1-9][0-9]{0,9}$`、slug は `^[a-z0-9-]{1,64}$` を通してから使う。3 つとも `dynamicParams = false`。
- 値を問い合わせに埋め込む箇所はない。読み出しのフィルタは固定の 1 つ（`scope = 'all'`）だけ。

### 出口

- `a` を描くのは ExternalLink だけで、使っているのは 3 か所（ArticleTable.tsx:241、ArticleHeader.tsx:34、AuthorScreen.tsx:47）。渡しているのは `post.url` と著者の `url` だけ。
- `safeExternalUrl`（links.ts:12-24）の判定を読んで確かめた（実行はしていない）。
  - 大文字の混じる URL、ポートつき、末尾にドットのあるホスト、国際化ドメイン、`takatsu-connect.com@別のホスト` の形は、先頭の完全一致で落ちる。
  - `https://takatsu-connect.com//別のホスト`、`https://takatsu-connect.com/\別のホスト`、`/@…` は、ホストが変わらずパスになる。
  - 途中のタブや改行は、ホストが `/` で決まったあとなので、行き先を変えない。
  - 利用者名とパスワードつきの URL は別に落としている。
  - パスとクエリの中身は検証しない。値は WP REST API 由来で、利用者の入力からは作らないので、指摘にしない。
- サイト内リンクの href は、固定の文字列か、固定の接頭辞に検証済みの数・符号化した slug を続けたもの。
- 題名や名前を入れる `aria-label` と SVG の `<title>` は、React の属性値とテキストとして渡している。
- `localStorage`、`sessionStorage`、`fetch(` は src に 0 件。ブラウザからの通信と保存はない。

### ADR 0010 の「かわりに守ること」

| 番号 | 状況 |
| --- | --- |
| 1 | lint の設定あり（eslint.config.mjs:90-113）。抜け道は M-2 |
| 2 | lint の設定あり（:82-85）。値はテキストと属性値にだけ使われている（検索した範囲） |
| 3 | 守られている。lint の側の抜け道は M-2 の 5・6 |
| 4 | next.config.ts:11-23 が ADR と一致。`'unsafe-inline'` は `script-src` の 1 か所だけ。`object-src 'none'` あり |
| 5 | 別の担当が作成中。今回は見ていない |
| 6 | lint の設定あり（:21-28、64-78、115-123）。抜け道は M-2 の 3・7 |
| 7 | `noInlineConfig` は全ファイルに効く形で入っている（:44）。CI の必須チェックと、日次のビルドでの検査は未了（§7） |
| 8 | `script-src-attr 'none'` は next.config.ts:14 に入っている。全画面での確認は E2E（別の担当） |

### エラーと秘密

- error.tsx と not-found.tsx は固定文だけ。例外のメッセージ、スタック、内部の URL、SQL を出さない。
- client.ts と load.ts の例外は、変数の名前、ビューの名前、失敗の種類だけを持つ。ライブラリの例外は引き継がない。
- `process.env` を読むのは client.ts:22 の 1 か所。`NEXT_PUBLIC_` の参照は lint と scripts/check-public-env-names.mjs で止めている。
- src に `console.` は 0 件。load.ts にログの出力はない（件数も出していない）。

### 依存

- 構築 3 の土台のあとに足した依存はない。本番の依存は 7 個（supabase-js、d3-scale、d3-shape、next、react、react-dom、zod）で、版は固定。ロックファイルはコミット済み。致命的・高は 0 件。

## 5. 依頼者の判断が要ること

1. ADR 0010 の見直し条件と検索欄（M-1）。検索欄を例外として ADR に書くか、条件の文言を絞るか。
2. minimatch の扱い（L-6）。更新を待つ（アラートを残す、または理由と見直し日を書いて閉じる）か、`overrides` で上げるか。監査者の意見は「待つ」。
3. 記事一覧の JSON から、著者ごとの読まれた回数の合計を第三者が計算できること（I-1）を引き受けるか。避けるなら、S-02e の著者での絞り込みと、一覧の著者名をどうするかの見直しになる。
4. ADR 0010 の「依頼者に確認すること」1〜4（公開ドメイン、残る害の引き受け、WordPress で題名や名前を編集できる人と 2 要素認証、Vercel の Web Analytics・Speed Insights・Toolbar を本番で使わないこと）。ADR に回答の記録がない。
5. リポジトリの外で確かめてほしいこと:
   - Vercel のビルドログを見られる人の範囲（L-5）。
   - Vercel が `//` で始まるパスにページを返すか（L-1）。

## 6. 未確認と、確かめ方

- lint の規則の実際の挙動（M-2 の 1〜7）。監査者の知識による。「落ちるべき書き方」のファイルを lint にかけて確かめる。
- zod 4 の例外の文面に値が含まれるか（L-5）。形の違うデータで `parse` を呼び、メッセージを見る。
- Next.js 16.4.5 で、`global-error.tsx` がないときの既定の画面の文面と、`dynamicParams = false` のページがビルド時に `notFound()` を返したときの扱い（I-4、L-2）。E2E かビルドの出力で確かめる。
- `NEXT_PUBLIC_` でない環境変数がブラウザ向けの束で空になること（L-4）。ビルド出力の検査（別の担当）で、Supabase の URL とキーの文字列がないことを見る。
- バッチが参照元ドメインの形を確かめているか（L-3）。docs/design/03 §4 とバッチのコードを読む。
- 設計（06 §4）が I-1 の残りを明記しているか。
- 読んでいない画面のコード（§1）。検索語に当たらない書き方は見落としうる。
- GitHub の設定（secret scanning、main の保護、Dependabot）は今回見ていない。初回公開前の監査で `gh api` で確かめる。

## 7. 次の工程への申し送り

- 初回公開の前に: M-1、M-2 を片づける。ADR 0010 の 7（lint、E2E、ビルド後の検査を CI の必須チェックにし、日次の本番ビルドでも検査を走らせる）を実装する。いまは `.github/` がなく、`build` は `next build` だけである。
- E2E の担当へ: `?q=` に HTML として解釈されうる文字列を入れた URL を開く場合を足す（M-1）。
- 構築の担当へ: L-1〜L-5 は、次に該当のファイルを触るときにまとめて直せばよい。
- 初回公開前の監査（全観点）で、GitHub の設定、Vercel の設定、ビルド出力、応答ヘッダの実測をまとめて確かめる。
