# 設計レビュー最終確認（ADR 0003 の条件解消: N-1・N-3）

- 状態: 草案
- 更新日: 2026-11-03
- 範囲: 再確認（audits/2026-11-03-design-review-recheck.md）の残り N-1（全記事の分布の母集団を除外後にする）と N-3（service_role への `internal` の grant）の反映確認、帯の計算をビューに移した追加判断の評価、ADR 0003 の判定。設計文書は編集していない。gh api・外部文書・Bash は使っていない。
- 読んだファイル: audits/2026-11-03-design-review-recheck.md §3（N-1、N-3）、design/adr/0003-public-data-boundary.md 判断 4・判断 4 追記・結果、design/02_data_model.md §3.5・§4（pub_article_summary / pub_author_summary / pub_benchmark_curve の行）・§4.1・§6・§8〜§9（grep）、design/03_data_pipeline.md §6.2、design/07_test_plan.md I-DB-05・I-DB-17・U-07・U-08、requirements/02_metrics.md M-19

## 結論

**承認。構築に進んでよい。** N-1・N-3 はいずれも反映済みで、**ADR 0003 は承認**（条件付き承認を解消）。判断 4 追記に N-1 の対策（母集団を除外後にし、ビューで計算）が理由・代替案つきで記録され、02・03・07・M-19 と整合する。残るのは低 3 件（文言と実装時の注意）で、構築中に対応すればよい。致命的 0、高 0、中 0。

## N-1 の反映状況（反映済み）

- 母集団の定義: 02 §4.1 の条件（`is_ad = false`、`not exists excluded_author`、`age_days ≥ n`、12 か月 → 全期間の拡張、30 本未満で行なし、`cat:<id>` は母集団 30 本以上の子カテゴリだけ）が 03 §6.2、M-19、07 I-DB-17 と一致。`population_size` = 可視記事の件数（02 §4.1、07 I-DB-05）。
- 計算の場所: `internal.benchmark_curve` ビュー（02 §3.5、§4.1、§8 のマイグレーション 0005）。バッチは分布も帯も計算せず、`excluded_author` を読まない（03 §6.2。ADR 0005 と整合）。除外リストの変更は次のビルドで反映され、除外記事が曲線に残る窓がない（02 §4.1 帰結。07 I-DB-17「除外著者を 1 人追加すると次の select で変わる」で検査）。
- 公開面: 列集合は不変で、`excluded_author` 由来の列は出ない（02 §4、§6 検査 3・4）。曲線・帯・`population_size`・`population_window` はすべて公開値（`pub_article_cumulative`、`pub_article_summary`、`pub_post`）だけから再現できる値になり、N-1 の順位ずれの経路は閉じた。子カテゴリ行の有無や 12 か月 → 全期間の切り替えも可視記事の件数だけで決まり、除外の有無を示さない。
- ADR・要件: 判断 4 追記に理由・代替案 (a)(b)(c)・推奨と (c) への切り替え条件（I-DB-17、2 秒）、「結果」で D-14 を確定、M-19 の母集団の定義に除外著者の記事を除くことと理由を明記。07 I-DB-05 に「除外記事を分位の補間位置に置くフィクスチャ」が入っており、N-1 の悪用の筋道そのものを検査する。

## 帯の計算をビューに移した判断の評価（妥当、かつ必要な帰結）

- 妥当。バッチは `excluded_author` を読まないので、バッチが帯を計算すると必然的に除外込みの曲線を使う。攻撃者が公開曲線（除外後）から再計算した帯と公開された帯が食い違えば、除外記事の存在だけでなく、食い違った記事の値が除外込みの p25 / p75 を挟む位置にあること（境界のずれの向きと範囲）まで分かる。曲線を移すなら帯も移すのが一貫しており、任意の追加ではなく必要な帰結である。著者の `band_30d` も `own_median_30d`（可視著者の可視記事の値）と同じ曲線の比較なので、新しい情報を含まない。
- 副次効果: 曲線と帯が同じビューの単一の定義から出るため、SQL と TypeScript の不一致は参照実装との突き合わせ（U-07・U-08、I-DB-17）で検出できる。`internal` に関数を置かず `case` 式で書く方針（06 §2.3、L-4）も保たれている。

## N-3 の反映状況（反映済み）

- 02 §6 に `grant usage on schema internal to service_role`、`alter default privileges for role postgres in schema internal grant select, insert, update, delete on tables / usage, select on sequences to service_role`、既存オブジェクトへの grant を追加（§8 の 0001 に含む）。関数には grant しない。anon / authenticated / PUBLIC への grant なしの条件は維持（§6 検査 1・2。I-DB-01 で service_role の権限も同時に検査）。Supabase の既定権限と `postgres` 以外の所有者の可能性は外部の事実として §9 に残し、ローカルで `has_schema_privilege` と `role_table_grants` を確認する手順と「広い grant で直さない」を明記。再確認 N-3 の指摘どおり。

## 残る問題（すべて低。構築中に対応）

- 低-1（文言、2 か所）03 §6.2 冒頭「すべてバッチ（TypeScript）が `article_daily` と `wp_post` から計算する」が同節の「分布・帯はバッチは計算しない」と矛盾する。「分布と帯を除き」と直す。ADR 0003「結果」最終項「本 ADR は N-1 の反映について security-auditor の最終確認を待つ」を、本報告の参照（承認、2026-11-03）に書き換える。
- 低-2（実装時の注意）02 §6 の grant に `truncate` がない。派生表は「基準日ごとに全置換」（§3.5）なので、バッチが `truncate` を使うと `permission denied` になる（fail-closed で露出はしない）。`delete` を使うか、`service_role` に限って `truncate` を足す。N-3 と同じく広い grant で直さない。
- 低-3（条件付き）性能で (c) マテリアライズドビューに切り替えると、除外リストの変更から `refresh` までの窓（最長 1 日）で N-1 の経路が再び開く。ADR は「(b) と同じ窓」と認識しているが、切り替え時の緩和が書かれていない。切り替えるときは、除外登録と `refresh` を同じ操作で行う手順を docs/operations に書き、I-DB-17 の「次の select で変わる」を refresh 込みの手順に書き換えてから切り替える。

## 未確認

- 07 I-DB-01 の本文（service_role の権限検査の条件）は範囲外で未読。02 §6 からの参照だけ確認した。
- `internal.article_cumulative` / `pub_article_cumulative` の可視記事の絞り込みと、バッチの全置換の方法（`truncate` か `delete` か。03 §5・§7）は範囲外。前者は再確認時に除外後と確認済みで N-1 の「公開値だけから再現できる」の前提、後者のため低-2 は「注意」とした。
