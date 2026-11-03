# セキュリティ監査: 設計 1 回目（確定前レビュー）

- 状態: 草案
- 更新日: 2026-11-03
- 範囲: 観点 1〜3 と設計固有の点（公開ビューの列、権限、除外の実装、ゼロの扱い、Actions のジョブ権限、秘密の置き場所）。コードはまだないため文書に対するレビュー。GitHub・GCP・Supabase・Vercel の設定は未確認（§6 に確認依頼）。
- 読んだファイル: .claude/rules/security.md、docs/requirements/05_non_functional.md §4・§4.1・§5、docs/design/02_data_model.md、06_security.md、03_data_pipeline.md §5・§6・§8・§12・§15・§16、adr/0003、0005、0006（決定・結果）、0007
- 実行したコマンド: `git ls-files`、`git grep`（鍵のパターン: `properties/<数字>`、`sb_secret_`、`BEGIN PRIVATE KEY`、service_account JSON、JWT 形式）

## 1. 結論

**設計の修正が必要**（高 1 件、中 8 件）。高 H-1 と中 M-1〜M-5 を設計に反映し、H-1 に伴う 05 §4.1 行 11 の備考と ADR 0003 判断 4 の改訂を NFR-39 の手順で行えば、構築に進んでよい。M-6〜M-8 は構築中に反映すればよい。ADR 0003 は条件付き承認、ADR 0005 は承認、公開ビューの列は条件付き承認（§4）。

## 2. 指摘（重要度順）

### H-1（高）記事の値から合算した「除外込み」集計の差分で、除外著者の記事の読まれた回数が復元できる
- 対象: 02 §4 `pub_site_period_freshness`（pageviews、除外込み）、`pub_category_period` の親カテゴリ行（除外込み、「distinct で数える」）、ADR 0003 判断 4、05 §4.1 行 11 備考。FR-36、NFR-43、NFR-52。
- 問題: 可視記事の所属（`pub_post_category`、`pub_category.parent_id`、`pub_post.published_on` → 鮮度）と期間合計（`pub_article_period.pageviews`、伏せなし）がすべて公開されるため、親行の値 − 可視記事の和 = 除外著者の記事の和 になる。除外著者の記事がその親（または鮮度の区分。`new` は月 25 本程度）に 1 本なら正確な値が出る。ADR 0003 判断 4 の「複数の子に属する記事を重複して数えるため切り出せない」は、攻撃者が可視記事の所属を全部知っている以上成立しない（distinct でも重複込みでも同じ計算を再現できる）。要件再確認 N-3 でこの理由を受け入れた私の判断を撤回する。
- 影響: FR-36 が隠すはずの数値が BI のデータだけから復元される。NFR-22 の M-1 が許容したのは「誰が除外されたかの推測」までで、数値の復元は含まない。
- 対策: 「記事の値から合算する集計はすべて除外後」に統一する（親カテゴリ行、鮮度別、子カテゴリ、タグ、著者）。除外込みのままでよいのは GA4 のサイト全体値（`pub_site_daily*`、`pub_site_period*`、heatmap、確定月の参照元・市）と、公開本数の件数だけ。`pub_site_period` は記事以外のページを含むため差分が成立しない。05 §4.1 行 11 備考・NFR-33 の列挙・ADR 0003 判断 4・FR-40 の注記を NFR-39 の手順で改訂する。
- 根拠: 02 §4 の表の列と除外欄、02 §4 末尾の段落、ADR 0003 判断 4 の理由。

### M-1（中）二次伏せの候補に値 0 のセルが入ると、二次伏せが実質無効になる（D-16 と 03 §6.1 手順 3）
- 対象: 02 §2.3・§9（D-16）、03 §6.1 手順 1・3。NFR-33。
- 問題: 手順 3 は「伏せていないセルのうち最小」を二次伏せにするため、0 のセルがあれば必ず 0 を選ぶ。伏せた 2 セルの和（= 合計 − 表示の和）がそのまま 1〜4 の値になり、逆算を防ぐ目的が果たせない。デバイス（tablet ≈ 0）や記事 × 流入チャネル（5 区分のうち 2〜3 が 0）で頻発する。
- 対策: 0 は伏せない既定（`MASK_ZERO = false`）は許容する（0 は個人に結び付かず、「5 回未満」の表示は 1〜4 に対して真）。手順 3 の候補を「伏せていない、値が T 以上のセルのうち最小」に変える。該当がなければ追加しない（その場合は合計自体が T 未満で、記事では合計の `landing_sessions` が伏せられ、サイト全体の日別では現実に起きない）。
- NFR-33 への文言案: 「GA4 が行を返さない区分は 0 として格納し、伏せ値の対象にしない。二次伏せで追加して伏せるセルは、伏せていないセルのうち値が T 以上で最小のものとする。」

### M-2（中）著者 × 内訳軸 と 記事 × 内訳軸 の階層差分（03 §6.1 の抜け）
- 対象: 02 §3.3 `author_period_breakdown`（記事の生値の合算）、`article_period_breakdown`、03 §5.4 G13・G14。NFR-33。
- 問題: 著者のセル（表示、T 以上）− その著者の可視記事の同じ bucket の表示値の和 = 伏せた記事セルの和。伏せた記事が 1 本なら正確に復元できる。二次伏せは 1 つの排他的区分の中だけで働き、この階層は見ていない。著者 1 人あたり十数本なので頻発する。
- 対策: 著者セルを出すのは、同じ bucket で伏せた記事セルが 0 本または 2 本以上のときだけとし、1 本なら著者セルも伏せる（`_mask = secondary`）。`mask.ts` の単体テストに加える。入れ子の区分（SNS ⊂ 流入チャネル social、初めて / また来た ⊂ 読んだ人の数、地元 3 区分 ⊂ 訪問回数）は区分内の二次伏せで足りる（問題なし）。

### M-3（中）heartbeat ジョブの `contents: write`（03 §12、06 §9）
- 問題: 日次ワークフロー内のジョブに `contents: write` がある。GITHUB_TOKEN はワークフローファイルを変更できないが、`packages/` は変更できる。このジョブで動くサードパーティ Action や依存が侵害されると main にコードを push でき、翌日のバッチが service role と WIF の下でそのコードを実行する（データの改ざん、秘密の持ち出し）。main は直接 push 可なので止まらない。
- 対策: 別ワークフロー（例 `heartbeat.yml`、月 1 回の schedule、ワークフロー全体で `permissions: contents: write` のみ）に分け、中身を「`actions/checkout`（GitHub 製、`sparse-checkout: ops/`、`fetch-depth: 1`）→ `git` CLI で固定ファイルに基準日を書き固定メッセージでコミット・push」だけにする。`pnpm install`、プロジェクトコード、サードパーティ Action を置かない。日次ワークフローは `contents: read` と、バッチジョブの `id-token: write` だけにする。代替との比較: Dependabot 任せは 60 日無更新がありうる、手動は人に依存する。設計の 2 段構え（止めない + 気づく）は妥当。

### M-4（中）05 §4.1 にない組み合わせ: シェア数（`site_period.share_count`、`author_period_share`）
- 対象: 02 §3.3、§4 `pub_site_period.share_count`、03 §5.4 G18。NFR-33「表にない組み合わせは格納しない」。
- 問題: M-41 / FR-61 は要件にあるが、§4.1 の許可リストに「全体 × 期間 シェア数」「著者 × 期間 シェア数」の行がない。
- 対策: 初回に含めるなら NFR-39 の手順で行を追加する（伏せ値適用、著者別は二次伏せの対象外の単独値）。含めないなら表・列・G18 を作らない。

### M-5（中）`pub_posting_period.author_count`（除外込み）
- 問題: 全体の著者数と `pub_author` の件数の差が除外著者の人数になる。NFR-43「除外の有無を示す列を置かない」に実質的に当たり、BI のデータだけで除外の発生が分かる。
- 対策: 列を削る（FR-51 の主表示は本数で足りる）か、除外後の値にする。`post_count` は WordPress で公開済みの情報なので除外込みでよい。

### M-6（中）Vercel の過去デプロイが移動窓の履歴と除外前のページを残しうる（確認依頼を伴う）
- 対象: ADR 0003 判断 3、02 §2.2（履歴を持たない）、NFR-11（除外後のキャッシュ再生成）、06 §2.1。
- 問題: Supabase 側で移動窓の履歴を持たない設計は妥当だが、毎日のビルドが固有 URL を持つデプロイとして Vercel に残り、その URL が誰でも開けるなら、外部から移動窓の全履歴と除外前の個別ページが読める。
- 対策: Deployment Protection を本番ドメイン以外のすべての URL に効かせる（Vercel の「Standard Protection」相当）、保持するデプロイ数を最小にし、除外変更後は旧デプロイを削除する手順を docs/operations/ に書く。Hobby で可能かは確認依頼（§6）。

### M-7（中）内部表を API に公開しないスキーマへ移す（多層防御。ADR 0007 (3) の補強）
- 対象: 02 §1「スキーマはすべて public」、§6。NFR-43。
- 問題: 守りが grant の 1 層だけ。誤った 1 文（`grant select on all tables in schema public to anon`、既定権限のリセット、Supabase のテンプレート適用）で `excluded_author` を含む内部表が PostgREST から読める。
- 対策: 内部表を `internal` スキーマ（Exposed schemas に含めない、anon / authenticated に usage なし）に置き、`pub_*` だけを public に置く。CI の検査に「anon / authenticated / PUBLIC が public 以外のスキーマに usage を持たない」「`pub_*` の列名に `_mask` がなく `excluded_author` の列を含まない」「`pub_*` の列集合が 02 §5 の対応表と一致する（スナップショット）」を加える。

### M-8（中）未処理例外の既定出力（03 §14・§15）
- 問題: Node の未処理例外はメッセージとスタックを stderr に出す。supabase-js のエラーはプロジェクト URL と表名、GA4 のエラーは `properties/<ID>` を含みうる。Secrets の自動マスクは値の完全一致にしか効かない。
- 対策: エントリで全例外を捕まえて `error_kind` に分類し、メッセージを出さずに終了する。`process.on('uncaughtException')` と `'unhandledRejection'` も同じ扱い。テストで「例外時のログに URL と 6 桁以上の数字列が出ない」を確認する。

### 低（衛生）

| ID | 対象 | 問題と対策 |
| --- | --- | --- |
| L-1 | 02 §3.3、ADR 0003 判断 2 付随 | 曜日 × 時間帯の二次伏せ除外の理由「伏せセルが 1 つになることは実質ない」は 90 日窓・月では成立しない（深夜の 1 セルだけが 1〜4 になりうる。合計は `pub_site_period.pageviews` と同じ指標で正確）。復元される値はサイト全体の時間帯 PV で識別性がないため許容できるが、理由をそう書き直す。または同じアルゴリズムを適用する（コストは小さい） |
| L-2 | 03 §5 本文、§5.1 D-15、06 §4 | 「`customEvent:*` は使わない」「18 種に限る」と、診断で 1 回 `customEvent:page_type` を問い合わせる記述が矛盾。許容条件は「格納・公開せず件数だけ」。推奨はバッチに入れず、運用担当が GA4 の UI または手元で 1 回確認する。入れるなら G19 として §5.4 に診断用と明記する |
| L-3 | 02 §4 `pub_author_period.long_post_count`、`long_pageviews` | 著者 × 鮮度 は §4.1 に明示がない。可視記事の公開値から導けるので露出は増えないが、著者 × カテゴリ と同じく派生値として §4.1 と 02 §5 に書く |
| L-4 | 02 §6 | 関数の EXECUTE は Postgres 既定で PUBLIC に付き、PostgREST は rpc として公開する。`alter default privileges ... revoke execute on functions from public` を加え、CI 検査の grantee に PUBLIC を含める |
| L-5 | 06 §2.3 | 環境変数の名前の検査だけでは、`apps/web/src/data/` がクライアントコンポーネントから import されたときの混入を防げない。ビルド後の `.next/static` に `SUPABASE_URL` の値と anon キーの先頭 20 文字が含まれないことを CI で検査する |
| L-6 | 02 §3.6 `batch_run.counts` | 固定キー・数値のみの zod スキーマで書き、DB にも immutable 関数による check 制約（全値が number）を置く |
| L-7 | ADR 0005、03 §8 | public の Actions 実行一覧に `workflow_dispatch` の入力 `mode = publish_only` が見え、除外変更のタイミングの信号になる。M-1 の範囲内だが、`publish_only` を設定変更後の再ビルドにも使い一意の信号にしない。`batch_run` に行を書かない |
| L-8 | 03 §8 | Deploy Hook は `curl -fsS -X POST "$URL" -o /dev/null` で呼び、応答本文と URL を出力しない。漏えい時の影響（1 日 100 デプロイの消費で日次ビルドが失敗）は 06 §2.4 のとおり |
| L-9 | ADR 0005 運用スクリプト | 運用担当のローカル `.env` の service role キーは人が持つ鍵。ローテーション手順と退任時の手順（docs/operations/）の対象に含める |
| L-10 | 06 §2.2 | WIF の属性条件に `assertion.repository_id`（または `repository_owner_id`）を加え、リポジトリ名の変更・移管に備える。GCP 側 → §6 |

## 3. 「特に見てほしいこと」への対応

| # | 判定 |
| --- | --- |
| 1 | H-1、M-4、M-5、L-3。`pub_article_daily` の生値と `pub_article_cumulative`、`pub_author_period.pageviews` は §4.1 行 7・11 の範囲内で問題なし |
| 2 | H-1、M-5、L-7。`not exists`、`dynamicParams = false`、子カテゴリ・タグの除外後、`excluded_author` の grant なし、除外列なし、は問題なし |
| 3 | 承認。確認方法は 02 §6 の grant 検査に M-7 の 3 項目と L-4 を加えれば十分。代替案の比較は妥当。所有者権限のビューは base 表の RLS を通らないので、実効的な守りは grant であることを 06 §2.3 に明記する |
| 4 | M-1。0 を伏せないことは許容。NFR-33 の文言案は M-1 に記した |
| 5 | M-1、M-2、L-1。「2 セル以上なら何もしない」で和が分かる点は要件（N-1、N-2）で許容済み。和が 2 または 8 のときは一意になるが、粗い区分の 1〜4 で N-2 の線引きの範囲内。全体 × 日 × 流入チャネルは日単位の格納で窓がなく、日次差分の経路はない |
| 6 | Supabase 側は約束を守れている。外部の保存は防げず、M-6 の Vercel の過去デプロイだけが設計で塞げる経路 |
| 7 | L-2。格納・公開しない診断用の 1 回なら NFR-31・32 には反しないが、文書の矛盾を解く |
| 8 | M-3 |
| 9 | 配置は規則どおり（§5）。L-5、L-8、L-9、§6 の fork PR の確認 |
| 10 | M-8、L-6。ロガーの関数限定（03 §15）は妥当 |

## 4. NFR-39 の対象の判定

- ADR 0003（公開データの線引き）: **条件付き承認**。判断 1・3 は承認。判断 2 は M-1（二次伏せの候補）と L-1（曜日 × 時間帯の理由）を追記。判断 4 は H-1 のとおり「記事から合算する集計はすべて除外後、除外込みは GA4 のサイト全体値と公開本数だけ」に書き換えること。
- ADR 0005（除外リストの置き場所）: **承認**。案 A と実装方式は妥当。付帯: M-5、L-7、L-9。
- 公開ビューの列（02 §4・§5）: **条件付き承認**。H-1、M-4、M-5、L-3 の反映後。他の列は 05 §4.1 と NFR-30〜38 の範囲内。
- ADR 0007（参考、NFR-39 の対象外）: 承認。M-7 を推奨。

## 5. 問題なしと確認した項目

- `git ls-files`: `.env`、`credentials/` の追跡なし。`.env.example` と `.gitignore` あり。`git grep`: 鍵のパターンに一致する実データなし（一致は監査手順の説明文のみ）。
- 公開ビューに `_mask` 列と `excluded_author` の列がない。内部表に生の内訳セルを残さない（02 §1）。識別性の高い次元は確定月・30 日時点のみ、T 未満の行は格納しない。
- NFR-32: G1〜G18 に `pageReferrer`、`pageLocation`、ユーザー系、検索語がない。G9 の市は移動窓では 3 区分に畳んで捨てる。NFR-35: 著者の列は slug・表示名・URL のみ、ユーザー ID・アバターなし。
- 秘密の置き場所（06 §3、03 §16）: service role は Actions Secrets のみ、anon キーは Vercel のみで `NEXT_PUBLIC_` なし、Deploy Hook は Secrets。`id-token: write` はバッチジョブだけ。`pull_request_target` なし。schedule は main。
- 応答ヘッダ（06 §6）、入力検証（§7）、リンク先の固定、エラー画面の固定文。失敗通知の文面（§8）。

## 6. 依頼者に確認してもらう項目

- Vercel（Hobby）: (a) Deployment Protection で本番ドメイン以外のすべてのデプロイ URL を保護できるか、過去デプロイの保持と削除（M-6）。(b) fork からの PR でプレビューが作られるか、Preview の環境変数が渡るか（06 §2.4 の代替で足りるか）。
- GCP: WIF の属性条件が `repository == 'takatsu-connect/access-analyzer' && ref == 'refs/heads/main'` であること、SA が GA4 閲覧者のみで GCP ロールを持たないこと、「サービス アカウント トークン作成者」の削除、L-10 の追加。
- Supabase: Exposed schemas が `public` のみ（M-7 を採るなら `internal` を含めない）、`graphql_public` の無効化、アドバイザの「security definer view」警告の受け入れを記録する場所。
- GitHub: 親から受けた設定（SHA 固定必須、許可 Action、fork PR 承認制、main の force push・削除禁止）に加え、secret scanning と push protection、GITHUB_TOKEN の既定権限 read、Dependabot alerts / security updates の有効化。今回 `gh api` は使っていない。
- 要件: H-1 に伴う 05 §4.1 行 11 備考と NFR-33 の列挙の改訂、M-4（シェア数を初回に含めるか）、M-1 の NFR-33 文言を requirements-analyst に渡す。

## 7. 未確認

- 03_data_sources.md §2.4（取得する次元の一覧）と 06 §4「18 種」の整合、00_architecture.md、01_tech_stack.md、initial_setup.md の内容（指示により未読。`git grep` でプロパティ ID の数字列が追跡ファイルにないことは確認）。
- git 履歴の全文検索（`git log -p -S`）は今回未実行。前回監査（2026-11-03-initial）以降のコミットは文書のみ。
- 05_screens.md、07_test_plan.md（未作成）に依存する項目: 著者の数値並べ替えの禁止、ビューの列のスナップショット検査、除外の結合テスト。
