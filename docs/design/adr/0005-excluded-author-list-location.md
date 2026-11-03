# ADR 0005: 除外リスト（非表示を申し出た著者）の置き場所と実装方式

- 状態: 承認（security-auditor の設計レビュー 2026-11-03、audits/2026-11-03-design-review.md §4。付帯の M-5・L-7・L-9 を反映済み）
- 更新日: 2026-11-03
- 関係: FR-36、FR-06、FR-23、FR-30、NFR-11、NFR-22、NFR-40、NFR-43、NFR-44、NFR-52、NFR-73、D-10、Q-30、02_data_model.md §3.6・§4、06_security.md §5
- 変更履歴: 2026-11-03: 設計レビュー（audits/2026-11-03-design-review.md）の H-1・M-5・M-7・L-7・L-9 を反映

## 文脈

- ライター本人が自分の数値の非表示を求めたとき、その著者と記事の個別表示を止める（FR-36）。記事の値から合算する集計（著者、カテゴリの親・子、タグ、鮮度区分）はすべて除外後、GA4 のサイト全体値と公開本数の件数は除外込み（ADR 0003 判断 4、設計レビュー H-1 で改訂）。URL で記事 ID や著者 slug を直接指定しても「存在しない」と同じ応答にする。
- 除外する著者の一覧は public リポジトリに置けない（NFR-22、NFR-40）。候補は「環境変数（GitHub Actions の Secrets）」か「Supabase の非公開テーブル」（D-10）。
- 除外の実装方式は置き場所で決まる: 環境変数なら Actions の書き込み時に個別表示用の表から行を落とす。非公開テーブルなら公開ビューで除外する（再確認 N-7）。
- 変更後はキャッシュ（静的ビルド）を再生成する（NFR-11）。著者名を含む台帳はリポジトリ外（NFR-73）。除外リストの内容はログ・通知・Issue・コミットメッセージに書かない（NFR-44）。

## 選択肢

| 案 | 置き場所 | 除外の実装 | 変更の手順 |
| --- | --- | --- | --- |
| A（採用） | Supabase の内部表 `excluded_author(author_slug, excluded_at)`。RLS 有効、anon の grant なし | 公開ビュー（`pub_post`、`pub_author`、`pub_article_*`、`pub_author_*`、子カテゴリ・タグの合計）が `not exists` で除外。バッチは除外リストを読まない | 運用担当がローカルの運用スクリプト（service role）で行を追加・削除 → `workflow_dispatch` の `publish_only` で再ビルド |
| B | GitHub Actions の Secret `EXCLUDED_AUTHOR_SLUGS`（カンマ区切り） | バッチが書き込み時に、個別表示用の表（記事行・著者行）から除外著者の行を落とす。合計は除外前に計算して別表に持つ | Secret を更新 → 日次バッチを手動実行（全記事の個別表示用の表を作り直す）→ 再ビルド |
| C | Vercel の環境変数 | BI のビルド時に除外して静的生成 | Vercel の環境変数を更新 → 再ビルド。Supabase の公開ビューには除外著者の行が残る |

## 比較

| 観点 | A: Supabase 内部表 | B: Actions Secret | C: Vercel 環境変数 |
| --- | --- | --- | --- |
| 現在の一覧を確認できるか | できる（Supabase の Table Editor、または運用スクリプトの `--list`） | できない（Secrets は読み返せない）。誤設定に気づけない | できる（Vercel の画面。ただし値はマスクされる） |
| 除外が効く場所 | 公開ビュー 1 か所。anon で読める経路すべてに同時に効く | バッチが書く表に効く。バッチの実装漏れ（新しい表を足したとき）が公開に直結する | BI だけ。公開ビューを anon で直接読むと除外著者の行が見える（anon キーが漏れた場合、または Supabase の URL を推測された場合） |
| 変更から反映まで | 行の追加 → 再ビルド（数分）。バッチの再実行は不要 | Secret 更新 → バッチ再実行（期間別表の作り直し。GA4 の問い合わせはなくても数分）→ 再ビルド | 環境変数更新 → 再ビルド |
| ログへの漏えいの経路 | スクリプトはローカルで動く。Actions は除外リストを読まないので、ログに出る経路がない | 環境変数として Actions のプロセスに渡る。`env` の出力や例外メッセージに混ざる経路がある（public のログ） | Vercel のビルドログに混ざる経路がある |
| 「存在しない」と同じ応答 | BI は `pub_post` / `pub_author` にない ID / slug のページを作らない（`dynamicParams = false`）→ 404 | 同じ（個別表示用の表に行がない） | 同じ |
| 集計への影響 | 内部表の生値は残るので、GA4 のサイト全体値と公開本数は自然に除外込み。記事から合算する集計（著者、親・子カテゴリ、タグ、鮮度区分）はビューで除外（H-1） | 合計を除外前に計算して別表に持つ必要があり、表が増える | 公開ビューは除外なし。除外後の子カテゴリ・タグ合計を BI で再計算することになる |
| 秘密の経路（NFR-40） | Supabase の内部表を経路に加える（NFR-40 の文言どおり） | Secrets（既存の経路） | Vercel の環境変数（既存の経路） |
| 解除（申し出の取り消し） | 行を削除 → 再ビルド | Secret 更新 → バッチ再実行 → 再ビルド | 環境変数更新 → 再ビルド |

## 決定

案 A。Supabase の内部表に置き、公開ビューで除外する。

理由: (1) 除外が 1 か所（ビュー）で効き、anon が読めるすべての経路に同時に効く。(2) 現在の一覧を確認できる。(3) バッチが除外リストを読まないので、public な Actions のログに出る経路がない。(4) バッチの再実行なしに数分で反映・解除できる。

## 実装方式

- 表: `internal.excluded_author(author_slug text primary key, excluded_at timestamptz not null default now())`（`internal` スキーマ。設計レビュー M-7）。FK は付けない（著者行が消えても除外を維持）。RLS 有効、anon / authenticated の grant なし。どの公開ビューにもこの表の列を出さない。
- ビュー: 記事行・著者行を出すすべての公開ビューに `where not exists (select 1 from internal.excluded_author e where e.author_slug = <著者 slug>)`。記事の値から合算する集計（`pub_category_period` の親行・子行、`pub_tag_period`、`pub_site_period_freshness`、`pub_author_*`）もすべて除外後。除外込みは GA4 のサイト全体値（`pub_site_daily*`、`pub_site_period*`、`pub_site_month_*`）と公開本数の件数（`pub_posting_monthly`、`pub_posting_period.post_count`）だけ（H-1）。`pub_posting_period` に著者数の列を置かない（全体の著者数 − `pub_author` の件数 で除外著者の人数が分かるため。M-5）。
- BI: `pub_*` だけを読む。`generateStaticParams` は `pub_post.post_id` と `pub_author.author_slug` から作り、`dynamicParams = false`。除外著者の ID / slug は 404（存在しない記事・著者と同じ）。クライアント側の一覧・フィルタも `pub_*` 由来のデータだけなので現れない。
- 運用スクリプト: `pnpm --filter batch run exclude-author -- --slug <slug>` / `--remove --slug <slug>` / `--list`。ローカルの `.env`（gitignore 済み）の `SUPABASE_URL` と `SUPABASE_SERVICE_ROLE_KEY` を使う。引数は slug だけ（表示名を入れない）。実行後に `workflow_dispatch` で `mode = publish_only` を起動して再ビルドし、Vercel の旧デプロイを削除する（NFR-11、06 §2.4）。
- `publish_only` は除外変更の専用ではない（設計レビュー L-7）: 設定値・辞書の変更後の再ビルドやビルド失敗後の再試行にも使い、public の Actions 実行一覧に見える `publish_only` が除外変更のタイミングの一意の信号にならないようにする。`publish_only` は `batch_run` に行を書かない。
- 運用担当のローカル `.env` の service role キーは人が持つ鍵として扱う（設計レビュー L-9）: 定期ローテーションと、運用担当の退任時の即時ローテーション（Supabase で JWT シークレットを更新 → Actions Secrets と残る担当の `.env` を更新）の手順を docs/operations/ の対象に含める（06 §3）。
- バッチ: `excluded_author` を読まない。書かない。`daily` / `backfill` のどの工程でも参照しない（コードレビューで確認）。

## 運用の記録方法

- 台帳（誰を、いつ、誰の申し出で除外・解除したか）はリポジトリ外。置き場所は依頼者が決める（Q-30 と一緒に確認。例: 運営の非公開ドライブ）。運用手順（docs/operations/、デプロイ工程）には台帳の置き場所と更新手順だけを書く（NFR-73）。
- リポジトリ内に残る記録は `excluded_author.excluded_at`（表の中）と、`publish_only` の Actions 実行履歴（著者を特定する情報を含まず、他の用途の `publish_only` と区別できない。L-7）だけ。
- Issue（beads を含む）、コミットメッセージ、文書に著者名・slug を書かない（NFR-44）。申し出の対応の Issue を作る場合は「除外の申し出 1 件に対応」のように件数だけにする。
- 申し出をした人への説明文面（自分の記事が全体の数字に入っていること、著者の集合はサイトで公開されており突き合わせれば推測されうること）は Q-30。

## 結果

- 良い点: 1 か所で確実に効く。確認・解除が容易。ログ漏えいの経路がない。バッチと BI は除外リストの存在を知らなくてよい（BI は「ないものはない」として動く）。
- 引き受ける点: Supabase の内部表を秘密の経路として扱う（NFR-40）。公開ビューが所有者権限で内部表を読む形（ADR 0007）に依存するので、ビューの定義変更時は除外の `not exists` が落ちていないかをテストで確認する（07_test_plan.md: 除外した slug を入れたときに `pub_*` のどの行にも現れないことを結合テストで検査）。運用担当がローカルに service role キーを持つ（`.env`、gitignore 済み。ローテーションと退任時の手順は L-9）。
- D-10 はこの ADR で決定とする。security-auditor の設計レビュー（2026-11-03）で承認。open_questions.md の D-10 の行は requirements-analyst が「確認済み」に更新する。
