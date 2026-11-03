# セキュリティ監査: 設計レビューの再確認（H-1・M-1〜M-8・L-1〜L-10 の反映、Q-36）

- 状態: 草案
- 更新日: 2026-11-03
- 範囲: audits/2026-11-03-design-review.md の指摘が設計・要件に反映されたかの確認と、NFR-39 の対象（ADR 0003、ADR 0005、公開ビューの列）の再判定。Q-36（ADR 0003 判断 6）の初回判定を含む。コード・リポジトリ設定・外部サービスは対象外（`gh api`、`git grep` は未実行）。
- 読んだファイル: audits/2026-11-03-design-review.md §2・§4、05_non_functional.md §4・§4.1（NFR-33、NFR-43 を含む）、04_functional.md FR-36・FR-40・FR-51（FR-10・FR-41・FR-52 は grep の行で確認）、02_data_model.md §1・§2.3・§3.3・§3.6・§4・§5・§6・§9、03_data_pipeline.md §5.1・§5.4・§6.1・§8・§12・§14、06_security.md §2・§3・§5・§9・§13、adr/0003、adr/0005、07_test_plan.md I-DB-01・05・07・15・16、I-B-11、S-10・13・14、U-27〜U-29

## 1. 結論

**追加の修正が必要（1 件、中）**。前回の指摘 19 件はすべて反映済みで、残る問題はない。ただし ADR 0003「結果」が再レビューに委ねた「全記事の分布（M-19・M-27、`benchmark_curve`）の母集団に除外著者の記事を含める」は、前提の「中央値・四分位からは差分復元の経路がない」が成立しない（§3 N-1）。母集団を除外後に変えて判断 4 に記録すれば ADR 0003 は承認でき、構築に進んでよい。

NFR-39 の対象の判定:
- ADR 0003: **条件付き承認**。前回の条件（判断 2 の M-1・L-1、判断 4 の H-1、M-2）は解消。残る条件は N-1 の 1 件（母集団を除外後にし、判断 4 と 02 §9 に記録）。判断 6（Q-36）は承認（§2 末尾）。
- ADR 0005: **承認**（維持。付帯の M-5・L-7・L-9 は反映済み）。
- 公開ビューの列（02 §4・§5）: **承認**。H-1、M-4、M-5、L-3 の反映を確認。N-1 は `pub_benchmark_curve` の列ではなく母集団の定義（計算）の問題で、列集合は変わらない。

## 2. 前回の指摘の反映状況

| ID | 状態 | 確認した箇所 |
| --- | --- | --- |
| H-1 | 反映済み | 05 §4.1 用語「除外後 / 除外込み」・行 11・末尾の列挙、NFR-33、FR-36・FR-40・FR-41・FR-10・FR-52、ADR 0003 判断 4、02 §1・§4（`pub_site_period_freshness`、`pub_category_period` 親行）・§4 末尾・§5、03 §6.1 末尾、06 §5、ADR 0005、07 I-DB-05 |
| M-1 | 反映済み | NFR-33、05 §4.1 用語「二次伏せ」、02 §2.3・§9（D-16 確定、`MASK_ZERO` を置かない）、03 §6.1 手順 1〜3、ADR 0003 判断 2 追記 1、07 I-DB-07 |
| M-2 | 反映済み | NFR-33、05 §4.1 行 12、02 §2.3・§3.3 `author_period_breakdown`、03 §6.1 手順 5（手順 3 の再判定を含む）、ADR 0003 追記 2、07 U-27・I-DB-07 |
| M-3 | 反映済み | 03 §12（`heartbeat.yml` 分離、`contents: write` のみ、checkout + git CLI だけ）、06 §2.2・§9、07 S-10 |
| M-4 | 反映済み | 05 §4.1 末尾（初回対象外、行なし）、FR-61、02 §1・§3.3・§4・§5、03 §5.4 G18、07 I-DB-16 |
| M-5 | 反映済み | NFR-43、FR-51、02 §4 `pub_posting_period`、ADR 0003 判断 4、ADR 0005、07 I-DB-05・I-DB-16。文言の残りは N-2 |
| M-6 | 反映済み（依頼者確認が残る） | 06 §2.1・§2.4・§13。Hobby での Standard Protection は確認依頼のまま（親の判断どおり） |
| M-7 | 反映済み | 02 §1・§6（`internal` スキーマ、既定権限の取り消し、検査 4 項目）、06 §2.3、ADR 0005、07 I-DB-01・I-DB-15・I-DB-16 |
| M-8 | 反映済み | 03 §14（try / catch、`uncaughtException`、`unhandledRejection`）、06 §9、07 U-29・I-B-11 |
| L-1〜L-10 | すべて反映済み | L-1: 02 §3.3・03 §6.1 手順 4・ADR 追記 3。L-2: 03 §5.1（`customEvent:*` 不使用、診断は UI）。L-3: 05 §4.1 行 13・02 §4。L-4: 02 §6・I-DB-01。L-5: 06 §2.3・S-14。L-6: 02 §3.6・U-28・I-DB-15。L-7: ADR 0005・03 §8・06 §5。L-8: 03 §8・06 §2.4。L-9: ADR 0005・06 §3。L-10: 06 §2.2・§13（GCP 側は確認依頼） |

Q-36（ADR 0003 判断 6、05 §4.1 全体 × 期間 の行、02 §3.3 `site_period_breakdown` の axis `channel` / `device_pv` / `device_sessions`、03 §5.4 G19・G20、07 I-DB-07）: **承認**。サイト全体 × 移動窓 × 粗い排他的区分で、判断 3 が記事単位でも許容した性質（日次差分や日別伏せ値との差で復元される値は「全体である日 referral から 1〜4 回」程度）に収まり、新しい次元も識別性の高い次元も増えない。二次伏せの適用先に入っていることを確認した。

## 3. 新たに見つけた問題

### N-1（中）`benchmark_curve` の母集団に除外著者の記事を含めると、四分位から除外記事の帯（場合により値）が分かる
- 対象: 02 §9、ADR 0003「結果」最終項、`pub_benchmark_curve`（scope、n、p25、p50、p75、population_size、population_window）。FR-36、FR-21、FR-23、NFR-36。
- 問題: 攻撃者は母集団の可視記事の値をすべて知っている（`pub_article_cumulative` の n = 1〜90、`pub_article_summary.pv_7d / pv_30d`、`pub_post.published_on` と `population_window`）。除外記事が k 本のとき、n 個の順序統計量である四分位は「可視値だけで計算した四分位」から k 本の位置のぶんだけ順位がずれるので、各四分位の下に除外記事が何本あるかが分かる。k = 1 なら除外記事の帯（上位 25% / 中央 50% / 下位 25%）が確定し、除外記事が四分位の順位そのもの（`percentile_cont` の補間に使う 2 値のどちらか）に来るときは値が正確に出る（例: 可視 9 値 10〜90、p50 = (x + 50) / 2 → x）。k が著者 1 人分（十数本）なら、その著者の記事の帯の分布（「15 本中 12 本が下位 25%」）が分かる。帯は FR-21・FR-23 の主な表示であり、FR-36 が隠す対象そのもの。n = 1〜90 の各点で順位が変わるため、どこかの n で正確に出る機会も重なる。
- 限界: 中央値付近は可視値が密で、丸めがあると順位のずれが見えないことがある。値が正確に出るのは「典型的な値」に限られる。この 2 点で H-1 より一段弱く「中」とした。
- 対策: 母集団を除外後にする（H-1 で採った「記事の値から導く集計はすべて除外後」の規則に揃える。ビューではなくバッチが計算するので、バッチが `excluded_author` を読まない方針（ADR 0005）との折り合いが要る: 選択肢は (a) `benchmark_curve` を公開ビュー側で可視記事から計算する、(b) バッチが除外リストを slug の集合としてだけ読み、ログ・`batch_run` に出さない。(a) が ADR 0005 の方針を崩さない）。`population_size` は可視記事の件数と一致させる。02 §9 を確定に移し、ADR 0003 判断 4 に「分布の母集団も除外後」を追記、07 I-DB-05 に「`population_size` = 可視記事の件数」を加える。母集団が減ることによる「まだ比較できません」の増加は著者 1〜2 人分で小さい。

### N-2（低）NFR-43 の文言が `post_count`（除外込み）にも字義上当たる
- NFR-43「公開ビューの件数との差で除外の発生が分かる値も置かない」は、`pub_posting_period.post_count`（除外込み）− 期間内の `pub_post` の件数 でも除外の発生が分かるため、字義上は H-1・M-5 で許容した `post_count` と矛盾する。意図（除外された人数が分かる著者数を置かない）に合わせて「著者数のように除外された人数が分かる値」と限定するか、`post_count` を例外として明記する。要件の文言修正のみ（requirements-analyst）。

### N-3（低、実装時の注意）02 §6 に service_role への `internal` スキーマの grant がない
- `create schema internal` で作った新スキーマには Supabase の既定権限が付かないため、`service_role` に `usage` と表・シーケンス・関数の権限を明示しないとバッチが書けない（fail-closed なので露出はしない）。危険なのは実装者が `permission denied` を広い grant（`to public` など）で直すこと。`grant usage on schema internal to service_role` と `alter default privileges for role postgres in schema internal grant ... to service_role` を §6 に書き、I-DB-01 の grantee 条件（anon / authenticated / PUBLIC に grant なし）はそのまま保つ。Supabase の既定権限の正確な内容は外部の事実で未確認。

## 4. 問題なしと確認した項目

- 除外後の統一により、記事から合算する集計の差分（親カテゴリ、鮮度区分、著者、タグ）による除外記事の値の復元経路は閉じた。残る除外込みは GA4 のサイト全体値（記事以外のページを含むため差分が成立しない）と公開本数の件数（除外の発生の推測まで。NFR-22 M-1 の許容範囲）。
- 03 §6.1 手順 3 の候補条件と手順 5 の再判定、I-DB-07 の「他は 0 なら null 1 つでよい」は M-1・M-2 の意図どおり。
- `daily.yml` は `contents: read` + バッチジョブの `id-token: write` のみ、`heartbeat.yml` に Secrets・サードパーティ Action・`pnpm` なし、S-10 で機械検査。`pull_request_target` なし、schedule は main のみ。
- 公開ビューに `_mask`・`excluded_at`・`author_count`・`share_count` がなく、I-DB-16 のスナップショットで固定。`internal` の usage なし（I-DB-15）、関数 EXECUTE の PUBLIC 取り消し（L-4）。

## 5. 依頼者に確認してもらう項目（前回 §6 から変更なし）

Vercel（Hobby での Standard Protection、過去デプロイの削除、fork PR のプレビュー）、GCP（WIF 属性条件に `repository_id`、SA の権限）、Supabase（Exposed schemas が `public` のみ、`graphql_public` の無効化）、GitHub（secret scanning、push protection、GITHUB_TOKEN 既定 read、Dependabot）。

## 6. 未確認

- 06 §4 の問い合わせ種類数（前回「18 種」）が 03 §5.4 の「19 種（G19・G20 追加、G18 除外）」と揃っているか（§4 は今回の範囲外）。
- 02 §3.5 `benchmark_curve` の計算定義（`percentile_cont` か否か、population_window の定義）は未読。N-1 の帯の推定は四分位の計算方法に依存しない。
- 05_screens.md（analytics-advisor が並行レビュー中）、initial_setup.md、00・01 の設計文書、git 履歴の全文検索。
