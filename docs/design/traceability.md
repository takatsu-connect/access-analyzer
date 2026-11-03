# トレーサビリティ（要件 ID → 設計要素）

- 状態: 草案（1 回目。02・03・06・ADR の範囲を埋めた。04_api.md、05_screens.md、07_test_plan.md の列は 2 回目で埋める）
- 更新日: 2026-11-03

## 1. 読み方

- 行は要件 ID。列は「データモデル（02）」「パイプライン（03）」「セキュリティ・構成（00、06、ADR）」「画面・API・テスト（2 回目）」。
- 「―」はその設計文書に現れないことを意味する。すべての列が「―」の要件は §7 に挙げ、理由を書く。
- 廃止・対象外の ID（M-04、M-05、M-07、M-08、M-42、M-43、FR-35、FR-62、DS-07〜DS-09）は「作らない」ことの確認として §7 に載せる。

## 2. 指標（M-xx）

| ID | 02 データモデル | 03 パイプライン | 00 / 06 / ADR | 2 回目 |
| --- | --- | --- | --- | --- |
| M-01 読まれた回数 | site_daily.pageviews、article_daily、article_period.pageviews、pub_author_period / pub_category_period / pub_tag_period の pageviews | G1、G4、§6.2 | ADR 0003 判断 1 | 05 |
| M-02 訪問回数 | site_daily.sessions、site_daily_channel、site_daily_device | G1〜G3 | ― | 05 |
| M-03 読んだ人の数 | site_period.active_users（期間単位） | G5、§5.3（D-06） | ― | 05。日別は Q-35 |
| M-06 読まれていた時間 | site_period.engagement_seconds、article_period.engagement_seconds | G5、G11 | ― | 05（分母 20 未満は出さない） |
| M-09 最後まで読まれた割合 | article_period.scroll_count | G12 | ― | 05 |
| M-10 流入チャネル | site_daily_channel、article_period_breakdown(channel)、author_period_breakdown(channel) | G2、G13、§5.2 のチャネル対応 | ADR 0003 判断 2・3 | 05 |
| M-11 SNS 種別 | site_period_breakdown(sns)、article_period_breakdown(sns)、author_period_breakdown(sns)、sns_source_unmapped | G7、G14、§5.2（D-02） | ADR 0003 判断 2・3 | 05 |
| M-12 参照元ドメイン | site_month_referrer（確定月、上位 10）、article_referrer_30d（上位 3） | G16、G17、§3 | ADR 0003 判断 3 | 05 |
| M-13 デバイス | site_daily_device、article_period_breakdown(device) | G3、G15 | ADR 0003 判断 2 | 05 |
| M-14 地域 | site_period_breakdown(local)、site_month_city（確定月、上位 10） | G9 | ADR 0003 判断 3、06 §4（市まで） | 05 |
| M-15 初めて / また来た | site_period_breakdown(new_returning) | G6 | ADR 0003 判断 2 | 05 |
| M-16 曜日 × 時間帯 | site_period_heatmap | G8 | ADR 0003 判断 2（二次伏せなし） | 05 |
| M-17 ランディングページ | article_period.landing_sessions、article_period_breakdown | G10、G13〜G15 | ― | 05 |
| M-18 累積 | pub_article_cumulative（窓関数）、article_summary.pv_total | §6.2 | ADR 0003 判断 1 | 05 |
| M-19 分布 | benchmark_curve | §6.2（母集団 30、12 か月 → 全期間） | ― | 05 |
| M-20 7 日 / 30 日 PV | article_summary.pv_7d、pv_30d、band_7d、band_30d | §6.2 | ― | 05 |
| M-21 鮮度区分 | article_summary.freshness、age_days | §6.2 | ― | 05 |
| M-22 最近読まれている / 久しぶり | article_summary.is_recent_hot、is_revival | §6.2 | ― | 05（件数上限は BI） |
| M-23 到達のお知らせ | article_milestone、article_summary.is_evergreen_365 | §6.2 | ― | 05 |
| M-24 自分の過去との比較 | author_summary.own_median_30d、eligible_count | §6.2 | ― | 05 |
| M-25 過去の記事が今も | pub_author_period.long_post_count / long_pageviews、pub_site_period_freshness | （ビューで計算） | ― | 05 |
| M-26 日別公開本数 | wp_post.published_on（BI が日別に数える） | §4 | ― | 05 |
| M-27 「普通の記事」の帯 | benchmark_curve(all, 30) | §6.2 | ― | 05 |
| M-30 公開記事数 | pub_posting_monthly、pub_posting_period、pub_author_period.post_count | §4 | ― | 05 |
| M-31 著者別公開本数 | pub_author_period.post_count（名前順は BI） | §4 | 06 §4（並べ替えなし） | 05 |
| M-32 カテゴリ別 | pub_category_period（pageviews、post_count_*、median_30d_pv）、wp_category.path | §4 | ADR 0003 判断 4 | 05 |
| M-33 タグ別 | pub_tag_period | §4 | ADR 0003 判断 4 | 05 |
| M-34 月別 × カテゴリ | pub_category_period（period.kind = month） | §3 | ― | 05 |
| M-40 いいね | ― | ― | ― | 取得不可（Q-10 の 1）。§7 |
| M-41 シェア | site_period.share_count、author_period_share（優先度 低） | G18、§17（D-09: 合計のみ） | ― | 05（含めるかは構築時） |
| M-50 検索 | ― | ― | ― | 初回スコープ外（Q-09）。§7 |

## 3. 機能要件（FR-xx）

| ID | 02 データモデル | 03 パイプライン | 00 / 06 / ADR | 2 回目 |
| --- | --- | --- | --- | --- |
| FR-01 期間指定と前期間比 | period（移動窓 6、月）、pub_period | §3 | ADR 0006（期間はクライアント側） | 04、05 |
| FR-02 基準日と更新時刻 | pub_meta、pub_batch_run | §8、§12、§14 | ADR 0006 | 05 |
| FR-03 フィルタ | pub_category、pub_author、pub_post_category | ― | 06 §7（許可リスト） | 05 |
| FR-04 リンク | wp_post.post_url、wp_author.author_url（配下検証） | §4 | 06 §7 | 05 |
| FR-05 CSV | （公開ビューの値のみ） | ― | 01 §5（クライアント生成） | 05（低） |
| FR-06 URL 共有、除外時の応答 | pub_post / pub_author（除外） | ― | ADR 0005、ADR 0006、06 §5・§7 | 04、05 |
| FR-10 KPI カード | pub_site_period、pub_posting_period、pub_site_period_freshness | G1、G5 | ― | 05 |
| FR-11 日別推移 | pub_site_daily、pub_site_daily_channel、pub_site_daily_device、wp_post.published_on | G1〜G4 | ― | 05。ユーザー数の日別は Q-35 |
| FR-12 ヒートマップ | pub_site_period_heatmap | G8、§13（D-12） | ― | 05 |
| FR-13 流入チャネル構成 | pub_site_daily_channel、pub_site_period_breakdown(sns)、pub_site_month_referrer | G2、G7、G16 | ADR 0003 判断 3 | 05 |
| FR-14 デバイス構成 | pub_site_daily_device | G3 | ― | 05 |
| FR-15 地域 | pub_site_period_breakdown(local)、pub_site_month_city | G9 | ADR 0003 判断 3 | 05 |
| FR-16 初めて / また来た | pub_site_period_breakdown(new_returning) | G6 | ― | 05 |
| FR-17 普通の記事の帯 | pub_benchmark_curve(all, 30) | §6.2 | ― | 05 |
| FR-20 よく読まれた記事 | pub_post（is_ad、除外）、pub_article_period.pageviews、pub_article_summary.freshness | ― | 06 §4 | 05 |
| FR-21 新着の立ち上がり | pub_article_summary（pv_7d、pv_30d、band_*、age_days） | §6.2 | ― | 05 |
| FR-22 長く読まれている記事 | pub_article_summary.freshness、pub_article_period | ― | ― | 05 |
| FR-23 記事詳細 | pub_post、pub_article_daily、pub_article_cumulative、pub_benchmark_curve、pub_article_milestone、pub_author_summary、pub_article_period_breakdown、pub_article_referrer_30d、pub_article_period | G4、G10〜G15、G17 | ADR 0003、ADR 0005（404） | 05 |
| FR-24 検索と絞り込み | pub_post、pub_post_category、pub_article_summary | ― | 06 §7 | 05（並べ替えの制限は BI） |
| FR-25 最近読まれている（全体） | pub_article_summary.is_recent_hot / is_revival、pub_post.is_ad | §6.2 | ― | 05 |
| FR-30 著者の選択 | pub_author（除外、数値なし） | ― | ADR 0005、06 §5 | 05 |
| FR-31 著者サマリ | pub_author_period、pub_author_summary、pub_article_milestone、pub_posting_period | §6.2 | ― | 05 |
| FR-32 著者の記事一覧 | pub_post、pub_article_period、pub_article_summary、pub_article_period_breakdown(channel の最多) | ― | ― | 05 |
| FR-33 著者の流入元・カテゴリ構成 | pub_author_period_breakdown、pub_author_category_period | G13、G14（著者合算 → 伏せ） | ADR 0003 判断 2 | 05 |
| FR-34 著者の最近読まれている | pub_article_summary | §6.2 | ― | 05 |
| FR-36 著者の非表示 | excluded_author、公開ビューの除外、pub_category_period の親 / 子、pub_tag_period | §8（publish_only） | ADR 0005、ADR 0003 判断 4、06 §5 | 05（一般注記）、07 |
| FR-40 カテゴリ別 | pub_category_period、wp_category.path | ― | ADR 0003 判断 4 | 05 |
| FR-41 月別 × カテゴリ | pub_category_period（月） | ― | ― | 05 |
| FR-42 タグ別 | pub_tag_period、pub_post_tag | ― | ADR 0003 判断 4 | 05 |
| FR-50 月別公開本数 | pub_posting_monthly | §4 | ― | 05 |
| FR-51 著者別公開本数 | pub_posting_period、pub_author_period.post_count | §4 | 06 §4 | 05 |
| FR-52 どんな記事が多かった | pub_category_period.post_count_published | §4 | ― | 05 |
| FR-53 先行公開 | WordPress 由来の表・ビューは GA4 なしで埋まる | §1（wp_fetch は ga4 より前） | ― | 05 |
| FR-60 いいね | ― | ― | ― | 取得不可。§7 |
| FR-61 シェア | site_period.share_count、author_period_share | G18 | ― | 05（低） |
| FR-63 問い合わせ送信数を出さない | 表なし | G1〜G18 に form 系なし | 06 §4 | 07 |
| FR-70 日次バッチ | batch_run | §1、§2 | ADR 0001 | 07 |
| FR-71 直近 7 日の再取得 | ― | §9、§6.3（D-08） | ― | 07 |
| FR-72 記事メタデータと削除 | wp_* の cascade、content.protected の除外 | §4 | ― | 07 |
| FR-73 伏せ処理 | `_mask` 列、§2.3 | §6.1、§16（MASK_THRESHOLD） | ADR 0003 | 07 |
| FR-74 失敗の通知 | batch_run.failed_step / error_kind | §14 | 06 §8 | 07。通知先は Q-12 |
| FR-75 初回バックフィル | ― | §10、§16（BACKFILL_START） | ― | 07 |
| FR-76 実行記録 | batch_run、pub_meta、pub_batch_run | §1、§14 | 06 §8 | 05、07 |

## 4. 非機能要件（NFR-xx）

| ID | 02 データモデル | 03 パイプライン | 00 / 06 / ADR | 2 回目 |
| --- | --- | --- | --- | --- |
| NFR-01 日 1 回 | ― | §2 | ADR 0001 | ― |
| NFR-02 翌日 T 時まで | ― | §2（17:00 / 18:00 JST）、§3 | ― | ― |
| NFR-03 遅延データ | ― | §9、§6.3 | ― | 07 |
| NFR-04 リアルタイムなし | 表なし | 取得なし | 06 §4 | ― |
| NFR-10 初期表示 3 秒 | ― | ― | ADR 0006（静的） | 05、07 |
| NFR-11 キャッシュ、再生成 | ― | §8 | ADR 0006、ADR 0005 | ― |
| NFR-12 同時 10 人 | ― | ― | ADR 0006（CDN） | 07 |
| NFR-20 ログインなし | ― | ― | 06 §2.1 | 05 |
| NFR-21 noindex | ― | ― | 06 §2.1、§6 | 05、07 |
| NFR-22 管理機能なし、設定の置き場所 | excluded_author | §16 | 06 §2.3、ADR 0005 | ― |
| NFR-30 集計値のみ | 全表 | ― | 06 §4 | ― |
| NFR-31 次元の一覧 | 02 §4 のビュー列 | §5.4 | 06 §4 | 07 |
| NFR-32 取らないもの | 表なし | §5（取得しない次元） | 06 §4 | 07 |
| NFR-33 伏せ値、§4.1 | §2.3、§3、§5 対応表 | §6.1、§6.3 | ADR 0003 | 07 |
| NFR-34 公開記事だけ | wp_post（protected 除外、cascade） | §4 | ― | 07 |
| NFR-35 著者は表示名と URL | wp_author（ID なし） | §4（ID はメモリのみ） | 06 §4 | 05、07 |
| NFR-36 順位表なし | ― | ― | 06 §4 | 05、07 |
| NFR-37 市まで | site_month_city、local 3 区分 | G9 | 06 §4 | ― |
| NFR-38 参照元はドメインまで | source_domain | G7、G14、G16、G17 | 06 §4 | ― |
| NFR-39 変更手順 | §8 | §13 | ADR 0003 結果 | ― |
| NFR-40 秘密の経路 | excluded_author（経路） | §16 | 06 §3 | ― |
| NFR-41 WIF | ― | §5 | ADR 0002、06 §2.2 | ― |
| NFR-42 Supabase はサーバー側 | ― | ― | 06 §2.3、ADR 0006 | 07（NEXT_PUBLIC 検査） |
| NFR-43 RLS、anon は pub_ のみ、除外 | §6、§4 | ― | 06 §2.3、ADR 0005 | 07 |
| NFR-44 ログ・通知の規律 | batch_run の列 | §15、§14 | 06 §8 | 07 |
| NFR-45 Actions の規律 | ― | §2、§12 | 06 §9 | ― |
| NFR-50 全期間、開始日 | 全表（削除は記事削除のみ） | §10、§16 | ― | ― |
| NFR-51 GA4 の保持に依存しない | 全表 | ― | 01 §6 | ― |
| NFR-52 削除記事、除外著者の集計維持 | cascade、excluded_author はビューのみ | §4 | ADR 0005 | 07 |
| NFR-60 無料枠 | §7（容量） | §11 | ADR 0001、01 §6 | ― |
| NFR-61 GA4 割当 | ― | §11（D-01） | ADR 0007 | 07 |
| NFR-70 無人運用 | batch_run | §14 | ADR 0001 | ― |
| NFR-71 60 日停止 | ― | §12（D-07） | ― | ― |
| NFR-72 対象サイトへの配慮 | ― | §4（間隔、差分） | 06 §11 | 07 |
| NFR-73 マイグレーション、設定の履歴、台帳 | §8 | §16 | ADR 0005（台帳） | ― |
| NFR-80 ブラウザ | ― | ― | ― | 05、07 |
| NFR-81 スマホ | ― | ― | ― | 05、07 |
| NFR-82 JST | §2.1 | §3 | ― | 05 |
| NFR-90 失敗時も前回で表示 | pub_meta.is_stale | §14 | ADR 0006 | 05 |
| NFR-91 入力検証、ヘッダ、エラー、リンク先 | ― | ― | 06 §6、§7 | 05、07 |
| NFR-94〜NFR-99 表示と言葉 | （pub_* に注記の材料: mask_threshold、population_size など） | ― | 06 §4（比較の相手） | 05 |

## 5. データソース（DS-xx）

| ID | 設計 |
| --- | --- |
| DS-01 GA4 Data API | 03 §5（G1〜G18）、ADR 0002 |
| DS-02 WP REST API | 03 §4、02 §3.1 |
| DS-03 サーバーログ | 使わない。設計なし |
| DS-04 Search Console | 初回スコープ外。設計なし |
| DS-05 wp-ulike | 取得不可。設計なし |
| DS-06 add-to-any | 03 G18（eventName = AddToAnyShare、合計のみ。D-09） |
| DS-07〜DS-09 | 廃止・対象外。設計なし |

## 6. 設計で確認する事項（D-xx）

| ID | 結論 | 場所 |
| --- | --- | --- |
| D-01 割当 | 通常日 約 450 トークン、バックフィル 約 5,000。収まる | 03 §11 |
| D-02 SNS 正規化 | 規則表と未対応参照元の表 | 03 §5.2、02 §3.6 |
| D-03 差分取得 | modified_after（要 1 回確認）、per_page 100、ID 一覧で削除検出 | 03 §4 |
| D-05 pagePath 正規化 | `^/(\d+)/$`。`/<ID>/<何か>/` の実測は残 | 03 §5.1 |
| D-06 ユーザー数 | 期間単位、4 dateRanges ずつ。日別は格納しない（Q-35） | 03 §5.3 |
| D-07 60 日停止 | heartbeat の条件付きコミット + クライアント側の停滞表示 | 03 §12 |
| D-08 遅延と伏せ値 | 毎回まるごと再計算、状態を持たない | 03 §6.3 |
| D-09 シェアのサービス別 | 取れない（カスタム次元未登録）。合計のみ | 03 §17 |
| D-10 除外リスト | Supabase 内部表、公開ビューで除外 | ADR 0005 |
| D-12 カテゴリ別ヒートマップ | 可能だが初回は見送り。親カテゴリ 4 区分に限り NFR-39 の手順 | 03 §13 |
| D-14 ADR の一覧 | ADR 0003 に 4 判断 | adr/0003 |
| D-15 page_type | 使わない。regex が正。バックフィル時に 1 回診断 | 03 §5.1 |
| D-16（新規）0 の伏せ扱い | 既定は伏せない。security-auditor の確認待ち | 02 §2.3・§9 |

## 7. 設計に現れない要件・2 回目に回す要件

| ID | 理由 |
| --- | --- |
| FR-03、FR-05、FR-24 の並べ替え制限、NFR-36 の画面上の担保、NFR-80、NFR-81、NFR-94〜NFR-99 | 画面の設計（05_screens.md、2 回目）で扱う。データ層では材料（ビュー）を用意済み |
| FR-04 のリンク先固定、NFR-91 のクライアント側検証の詳細 | 06 §7 に方針。実装の形は 05_screens.md と 07_test_plan.md |
| NFR-10、NFR-12 の確認 | 07_test_plan.md |
| M-40 / FR-60 / DS-05 | 取得不可（Q-10 の 1）。サイト側の変更が前提。設計しない |
| M-50 / DS-04 | 初回スコープ外（Q-09）。設計しない |
| M-04、M-05、M-07、M-08、M-42、FR-35、FR-62、DS-07 | 廃止。設計しない。取得しない指標（engagedSessions 等）は 03 §5 のとおり問い合わせに含まれない |
| M-43、FR-63、DS-08、DS-09 | 対象外。「作らない」ことを 06 §4、03 §5 で確認 |
| M-03 の日別、FR-11 のユーザー数切り替え | 05 §4.1 の表に「全体 × 日: 読んだ人の数」がないため未設計。Q-35 |
| U-xx（01_users.md） | 今回の読む範囲外。05_screens.md で利用者 → 画面の対応を書く |
