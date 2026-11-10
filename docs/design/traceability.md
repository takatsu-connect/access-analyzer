# トレーサビリティ（要件 ID → 設計要素）

- 状態: 確定（2026-11-04。依頼者の確認済み。実装時の確認項目は ADR 0009 にある）
- 更新日: 2026-11-10
- 変更履歴:
  - 2026-11-03: 設計レビュー（audits/2026-11-03-design-review.md）の H-1・M-1〜M-8・L-1〜L-10 と Q-36 を反映
  - 2026-11-03: ADR 0004（Python バッチ）、ADR 0009（`batch_writer`）、ADR 0005（SQL エディタ）の改訂を反映（FR-36、NFR-40、NFR-43、NFR-44、NFR-45、D-10 の行）
  - 2026-11-03: 書き込み経路の監査（以下「経路監査」。docs/security/audits/2026-11-03-write-path-review.md）の W-1〜W-9 と L-1〜L-7 を反映（FR-36、NFR-11、NFR-40、NFR-43、NFR-44、NFR-45 の行）
  - 2026-11-04: 著者の除外（FR-36）を初回対象外に（依頼者の決定、ADR 0005 保留）。FR-36、D-10 の行を「初回対象外」に。関連する行から除外の参照を外した
  - 2026-11-04: tech-writer の整合確認。FR-04 に S-16 を追加。FR-74 に Q-12 の確定、§7 の FR-61 に初回対象外を反映
  - 2026-11-07: 05 §2.9（見た目の共通の決まり）の新設と 07 E-13 の幅の追加に合わせて NFR-81 の行を更新
  - 2026-11-10: FR-26（イベント記事の一覧）を追加し、FR-21・FR-23・FR-41 に記事の種類と親子の表示を足した

## 1. 読み方

- 行は要件 ID。列は「データモデル（02）」「パイプライン（03）」「セキュリティ・構成（00、06、ADR）」「契約・画面・テスト（04、05、07、ADR 0008）」。
- 「―」はその設計文書に現れないことを意味する。すべての列が「―」の要件は §7 に挙げ、理由を書く。
- 廃止・対象外の ID（M-04、M-05、M-07、M-08、M-42、M-43、FR-35、FR-62、DS-07〜DS-09）は「作らない」ことの確認として §7 に載せる。
- 画面の ID（S-01〜S-09）は 05 §1、テストの ID（U- / I-DB- / I-B- / E- / S- / A-）は 07 §3〜§8。

## 2. 指標（M-xx）

| ID | 02 データモデル | 03 パイプライン | 00 / 06 / ADR | 04 / 05 / 07 |
| --- | --- | --- | --- | --- |
| M-01 読まれた回数 | site_daily.pageviews、article_daily、article_period.pageviews、pub_author_period / pub_category_period / pub_tag_period の pageviews | G1、G4、§6.2 | ADR 0003 判断 1 | 04 §3 全ページ。05 S-01 KPI、S-02、S-03、S-05、S-06、S-07。07 A-01、A-04 |
| M-02 訪問回数 | site_daily.sessions、site_daily_channel、site_daily_device | G1〜G3 | ― | 04 §3.2 daily / sitePeriod。05 S-01（もっと見る、日別推移の切り替え、構成比の分母）。07 A-01、E-19 |
| M-03 読んだ人の数 | site_period.active_users（期間単位） | G5、§5.3（D-06） | ― | 04 §3.2 sitePeriod.activeUsers。05 S-01 KPI のみ（日別には出さない。Q-35 確定）。07 E-19、A-01 |
| M-06 読まれていた時間 | site_period.engagement_seconds、article_period.engagement_seconds | G5、G11 | ― | 04 §3.2 / §3.4。05 S-01 もっと見る、S-03 目安（分母 20 未満は出さない）。07 U-14、A-01 |
| M-09 最後まで読まれた割合 | article_period.scroll_count | G12 | ― | 04 §3.4 period.scrollCount。05 S-03 目安「10 人中 ◯人」。07 U-16、U-22 |
| M-10 流入チャネル | site_daily_channel、site_period_breakdown(channel)（Q-36 確定）、article_period_breakdown(channel)、author_period_breakdown(channel) | G2、G19、G13、§5.2 のチャネル対応 | ADR 0003 判断 2・3・6 | 04 §3.2 breakdown.channel（期間値）、§3.4 / §3.5 breakdown.channel、topChannelByPeriod。05 S-01、S-03、S-05 の HBar × 5、S-05 記事一覧「流入の主な経路」。07 U-03、I-DB-07 |
| M-11 SNS 種別 | site_period_breakdown(sns)、article_period_breakdown(sns)、author_period_breakdown(sns)、sns_source_unmapped | G7、G14、§5.2（D-02） | ADR 0003 判断 2・3 | 04 §3.2 / §3.4 / §3.5 breakdown.sns。05 S-01、S-03、S-05 の「SNS の種類」。07 U-02、U-05、I-DB-07 |
| M-12 参照元ドメイン | site_month_referrer（確定月、上位 10）、article_referrer_30d（上位 3） | G16、G17、§3 | ADR 0003 判断 3 | 04 §3.2 monthReferrer、§3.4 referrer30d。05 S-01「リンク元のサイト（2026 年 9 月）」の形（集計した月を見出しに入れる）、S-03「リンク元のサイト」（公開から 30 日間の集計）。07 I-DB-10、E-20 |
| M-13 デバイス | site_daily_device、site_period_breakdown(device_pv、device_sessions)（Q-36 確定）、article_period_breakdown(device) | G3、G20、G15 | ADR 0003 判断 2・6 | 04 §3.2 breakdown.device（期間値）、§3.4 breakdown.device。05 S-01、S-03「どんな端末で読まれたか」。07 U-05、I-DB-07 |
| M-14 地域 | site_period_breakdown(local)、site_month_city（確定月、上位 10） | G9 | ADR 0003 判断 3、06 §4（市まで） | 04 §3.2 breakdown.local、monthCity。05 S-01「おおよその地域」。07 I-DB-09、I-DB-10、E-20 |
| M-15 初めて / また来た | site_period_breakdown(new_returning) | G6 | ADR 0003 判断 2 | 04 §3.2 breakdown.newReturning。05 S-01。07 U-05 |
| M-16 曜日 × 時間帯 | site_period_heatmap | G8 | ADR 0003 判断 2 追記 3（168 セルにも二次伏せを適用。L-1） | 04 §3.2 heatmap（168 要素）。05 S-01 Heatmap、§2.6 の 6 区分。07 U-17、E-13 |
| M-17 ランディングページ | article_period.landing_sessions、article_period_breakdown | G10、G13〜G15 | ― | 04 §3.4 period.landingSessions、breakdown。05 S-03「この記事から読み始めた訪問の内訳です」。07 A-01 |
| M-18 累積 | pub_article_cumulative（窓関数）、article_summary.pv_total | §6.2 | ADR 0003 判断 1 | 04 §3.4 cumulative。05 S-03 Curve。07 U-06、A-03 |
| M-19 分布 | benchmark_curve | §6.2（母集団 30、12 か月 → 全期間） | ― | 04 §3.2 benchmark30、§3.3 / §3.4 / §3.5 benchmark。05 §2.4 BandDot、S-02b、S-03、S-05。07 U-07、U-08 |
| M-20 7 日 / 30 日 PV | article_summary.pv_7d、pv_30d。帯 band_7d、band_30d は pub_article_summary（ビュー）が公開記事の分布から計算（02 §4.1、N-1） | §6.2 | ― | 04 §3.3 PostRow.pv7 / pv30 / band30（band7 は埋め込まない）。05 S-02b、S-02e、S-05 の列。07 U-06、U-08、I-DB-17 |
| M-21 鮮度区分 | article_summary.freshness、age_days | §6.2 | ― | 04 PostRow.freshness。05 S-02a「新着」バッジ、S-02c、S-03 属性。07 U-09 |
| M-22 最近読まれている / 久しぶり | article_summary.is_recent_hot、is_revival | §6.2 | ― | 04 §3.3 S-02d（10 件は BI で切る）、§3.5 posts。05 S-02d、S-05「最近 / 久しぶり」（各 5 件）。07 U-10、E-08 |
| M-23 到達のお知らせ | article_milestone、article_summary.is_evergreen_365 | §6.2 | ― | 04 §3.4 milestones、isEvergreen365、§3.5 milestones。05 S-03、S-05 (d)。07 U-11 |
| M-24 自分の過去との比較 | author_summary.own_median_30d、eligible_count | §6.2 | ― | 04 §3.4 ownMedian30d、§3.5 summary。05 S-03、S-05 (e)。07 U-12 |
| M-25 過去の記事が今も | pub_author_period.long_post_count / long_pageviews（著者 × 鮮度区分、L-3）、pub_site_period_freshness | （ビューで計算） | ADR 0003 判断 4 | 04 §3.2 freshness、§3.5 period.long*。05 S-01 もっと見る、S-05 (c)。07 I-DB-05、A-03 |
| M-26 日別公開本数 | wp_post.published_on（BI が日別に数える） | §4 | ― | 04 §3.2 publishedPerDay。05 S-01 LineChart の公開日の点。07 E-19、A-02 |
| M-27 「普通の記事」の帯 | benchmark_curve(all, 30) | §6.2 | ― | 04 §3.2 benchmark30。05 S-01 FR-17 の 1 行。07 U-07 |
| M-30 公開記事数 | pub_posting_monthly、pub_posting_period、pub_author_period.post_count | §4 | ― | 04 §3.2 posting、§3.7。05 S-01 KPI、S-08。07 A-02 |
| M-31 著者別公開本数 | pub_author_period.post_count（名前順は BI） | §4 | 06 §4（並べ替えなし） | 04 §3.7 authorCounts（名前順固定）。05 S-08「ライターごとの公開本数（名前の順）」。07 E-08、A-02 |
| M-32 カテゴリ別 | pub_category_period（pageviews、post_count_*、median_30d_pv）、wp_category.path | §4 | ADR 0003 判断 4 | 04 §3.6 CategoryData、§3.5 categoryMix。05 S-06、S-05 カテゴリ構成、S-08 どんな記事が多かった。07 I-DB-05、A-02 |
| M-33 タグ別 | pub_tag_period | §4 | ADR 0003 判断 4 | 04 §3.6 TagIndexData / TagPageData。05 S-07、S-07b（名前順。Q-37）。07 I-DB-06 |
| M-34 月別 × カテゴリ | pub_category_period（period.kind = month） | §3 | ― | 04 §3.6 SeasonalData。05 S-06b Heatmap。07 E-20、A-03 |
| M-40 いいね | ― | ― | ― | ― 取得不可（Q-10 の 1）。§7 |
| M-41 シェア | 初回対象外（設計レビュー M-4）。表・列なし | G18 は作らない、§17（D-09 確定: 合計のみ） | 06 §4 | 04 §3.8（型なし）。05 S-09（作らない）。07 U-22（AddToAnyShare なし）、I-DB-16（share_count 列なし） |
| M-50 検索 | ― | ― | ― | ― 初回スコープ外（Q-09）。§7 |

## 3. 機能要件（FR-xx）

| ID | 02 データモデル | 03 パイプライン | 00 / 06 / ADR | 04 / 05 / 07 |
| --- | --- | --- | --- | --- |
| FR-01 期間指定と前期間比 | period（移動窓 6、月）、pub_period | §3 | ADR 0006（期間はクライアント側） | 04 §3.1 Period.prevId / yoyId、§5 compare、§8 `p`。05 §2.5 PeriodPicker、§2.2。07 U-13、U-14、E-06、E-10 |
| FR-02 基準日と更新時刻 | pub_meta、pub_batch_run | §8、§12、§14 | ADR 0006 | 04 §3.1 meta。05 §2.7 DataStatus、§2.4 未確定 3 日。07 U-25、E-18、E-19 |
| FR-03 フィルタ | pub_category、pub_author、pub_post_category | ― | 06 §7（許可リスト） | 04 §8 parseQuery。05 S-02e。07 U-18、E-06 |
| FR-04 リンク | wp_post.post_url、wp_author.author_url（配下検証） | §4 | 06 §7、ADR 0004 | 04 §7（slug は href のみ）。05 §2.7、§4。07 U-26、E-16、S-16 |
| FR-05 CSV | （公開ビューの値のみ） | ― | 01 §5（クライアント生成） | 05 §12（未実装。Q-19 で要なら表と同じ列・値）。07 §9（Q-19 後） |
| FR-06 URL 共有、存在しないページの応答 | pub_post / pub_author | ― | ADR 0006、06 §7 | 04 §8（書き戻し）、§5 listArticleIds / listAuthorSlugs。05 §2.5、§10（404）。07 E-03、E-06 |
| FR-10 KPI カード | pub_site_period、pub_posting_period、pub_site_period_freshness（主カードと一致しない注記） | G1、G5 | ADR 0003 判断 4 | 04 §3.2。05 S-01 KPI 3 枚 + もっと見る。07 E-05、A-01 |
| FR-11 日別推移 | pub_site_daily、wp_post.published_on | G1〜G4 | ― | 04 §3.2 daily、publishedPerDay、§8 `line`。05 S-01 LineChart（切り替えは 2 つ。Q-35 確定）。07 E-19 |
| FR-12 ヒートマップ | pub_site_period_heatmap | G8、§13（D-12） | ― | 04 §3.2 heatmap、§8 `heat`。05 S-01 Heatmap、§2.6。07 U-17、E-13 |
| FR-13 流入チャネル構成 | pub_site_period_breakdown(channel、sns)、pub_site_month_referrer | G19、G7、G16 | ADR 0003 判断 3・6 | 04 §3.2 breakdown.channel（期間値、Q-36 確定）/ sns、monthReferrer。05 S-01「読者はどこから来たか」。07 I-DB-07、E-20 |
| FR-14 デバイス構成 | pub_site_period_breakdown(device_pv、device_sessions) | G20 | ADR 0003 判断 6 | 04 §3.2 breakdown.device（期間値、Q-36 確定）。05 S-01「どんな端末で読まれたか」（横棒）。07 I-DB-07 |
| FR-15 地域 | pub_site_period_breakdown(local)、pub_site_month_city | G9 | ADR 0003 判断 3 | 04 §3.2 breakdown.local、monthCity。05 S-01「おおよその地域」。07 E-20、E-11 |
| FR-16 初めて / また来た | pub_site_period_breakdown(new_returning) | G6 | ― | 04 §3.2 breakdown.newReturning。05 S-01。07 U-05 |
| FR-17 普通の記事の帯 | pub_benchmark_curve(all, 30) | §6.2 | ― | 04 §3.2 benchmark30。05 S-01 KPI 直下の 1 行。07 U-07、A-03 |
| FR-20 よく読まれた記事 | pub_post（is_ad）、pub_article_period.pageviews、pub_article_summary.freshness | ― | 06 §4 | 04 §3.3 S-02a（topIndex、順位なし）。05 S-02a（4 列、新着、注記）。07 E-08、A-04 |
| FR-21 新着の立ち上がり | pub_article_summary（pv_7d、pv_30d、band_*、age_days） | §6.2 | ― | 04 §3.3 S-02b、benchmark。05 S-02b（公開日順、帯の文言、濃淡）。07 U-08、E-07、E-11 |
| FR-22 長く読まれている記事 | pub_article_summary.freshness、pub_article_period | ― | ― | 04 §3.3 S-02c。05 S-02c。07 E-08 |
| FR-23 記事詳細 | pub_post、pub_article_daily、pub_article_cumulative、pub_benchmark_curve、pub_article_milestone、pub_author_summary、pub_article_period_breakdown、pub_article_referrer_30d、pub_article_period | G4、G10〜G15、G17 | ADR 0003、ADR 0006（404） | 04 §3.4 ArticleDetailData（約 11 KB）。05 S-03（(1)〜(8)）。07 E-03、E-20、A-03、A-04 |
| FR-24 検索と絞り込み | pub_post、pub_post_category、pub_article_summary | ― | 06 §7 | 04 §3.3 S-02e、§8 `cat` / `author` / `ym` / `q` / `sort`。05 S-02e（並べ替えの許可）。07 U-18、E-07 |
| FR-25 最近読まれている（全体） | pub_article_summary.is_recent_hot / is_revival、pub_post.is_ad | §6.2 | ― | 04 §3.3 S-02d（10 件）。05 S-02d。07 U-10、E-08 |
| FR-26 イベント記事の一覧 | pub_category、pub_post_category（記事の種類）、pub_benchmark_curve（scope = kind:article / kind:event）、pub_article_summary.band_7d / band_30d（主な種類の曲線） | §6.2 | ― | 02 §4.1（0007）。04 §3.3（section、filterCategoryIds）、§8（s10a〜s10e）。05 §1、§4.6 画面 S-10a〜S-10e。`apps/web/src/lib/derive/sections.ts`。07 I-DB-05（test_benchmark_by_kind.py）、E2E events.spec.ts |
| FR-30 著者の選択 | pub_author（数値なし） | ― | 06 §4 | 04 §3.5 AuthorIndexData。05 S-04（名前だけ、slug は href）。07 E-03、E-15 |
| FR-31 著者サマリ | pub_author_period、pub_author_summary、pub_article_milestone、pub_benchmark_curve | §6.2 | ― | 04 §3.5 period、summary、milestones、benchmark（siteMedianPostCount は 2026-11-03 に削除）。05 S-05「この期間のまとめ」(a)〜(d)（(b) に旧 (e) を統合）。07 A-03、E-11、E-22 |
| FR-32 著者の記事一覧 | pub_post、pub_article_period、pub_article_summary、pub_article_period_breakdown(channel の最多) | ― | ― | 04 §3.5 posts、pvByPeriod、topChannelByPeriod。05 S-05「記事の一覧」（スマホ 4 列）。07 E-07、E-13 |
| FR-33 著者の流入元・カテゴリ構成 | pub_author_period_breakdown、pub_author_category_period | G13、G14（著者合算 → 伏せ） | ADR 0003 判断 2 | 04 §3.5 breakdown、siteBreakdown、categoryMix。05 S-05「読者はどこから来たか（全体と並べて）」「どんなカテゴリを書いたか」。07 I-DB-07、A-03 |
| FR-34 著者の最近読まれている | pub_article_summary | §6.2 | ― | 04 §3.5 posts.isRecentHot / isRevival。05 S-05（各 5 件）。07 U-10 |
| FR-36 著者の非表示 | 初回対象外（2026-11-04、依頼者の決定）。除外の表とビューの条件を作らない | ― | ADR 0005（保留）、ADR 0003 判断 4（追加するときに適用）、06 §5 | 画面の処理と説明文なし。テストなし（07 I-DB-04、I-B-10 は欠番）。追加する場合は NFR-39 の手順 |
| FR-40 カテゴリ別 | pub_category_period、wp_category.path | ― | ADR 0003 判断 4 | 04 §3.6 CategoryData。05 S-06（軸ごと、注記）。07 I-DB-05 |
| FR-41 月別 × カテゴリ | pub_category_period（月） | ― | ― | 04 §3.6 SeasonalData、§8 `axis`。05 S-06b（子カテゴリは親ごとにまとめる。2026-11-10）。07 E-20、E2E events.spec.ts |
| FR-42 タグ別 | pub_tag_period、pub_post_tag | ― | ADR 0003 判断 4 | 04 §3.6 TagIndexData / TagPageData。05 S-07、S-07b。07 I-DB-06、E-08 |
| FR-50 月別公開本数 | pub_posting_monthly | §4 | ― | 04 §3.7 monthly。05 S-08。07 A-02 |
| FR-51 著者別公開本数 | pub_posting_period.post_count（author_count は置かない。設計レビュー M-5）、pub_author_period.post_count | §4 | 06 §4 | 04 §3.7 posting（postCount のみ）、authorCounts。05 S-08（主表示は本数のみ。名前順、番号なし。Q-26）。07 E-08、I-DB-05 |
| FR-52 どんな記事が多かった | pub_category_period.post_count_published | §4 | ― | 04 §3.7 categoryMix。05 S-08。07 A-02 |
| FR-53 先行公開 | WordPress 由来の表・ビューは GA4 なしで埋まる | §1（wp_fetch は ga4 より前） | ― | 05 S-08（GA4 なしで成立）。07 §9 FR-53（GA4 モック空） |
| FR-60 いいね | ― | ― | ― | ― 取得不可。§7 |
| FR-61 シェア | 初回対象外（設計レビュー M-4。NFR-39 で 05 §4.1 に行を追加してから実装） | G18 は作らない | 06 §4 | 04 §3.8（初回対象外）。05 S-09（作らない）。07 U-22、I-DB-16 |
| FR-63 問い合わせ送信数を出さない | 表なし | G1〜G17、G19、G20 に form 系なし | 06 §4 | 05 §12（表示なし）。07 U-23、S-06、I-DB-09 |
| FR-70 日次バッチ | batch_run | §1、§2 | ADR 0001 | 07 I-B-01、S-10、A-07 |
| FR-71 直近 7 日の再取得 | ― | §9、§6.3（D-08） | ― | 07 I-B-02 |
| FR-72 記事メタデータと削除 | wp_* の cascade、content.protected の除外 | §4 | ― | 07 I-B-03、I-B-06、U-23 |
| FR-73 伏せ処理 | `_mask` 列、§2.3 | §6.1、§16（MASK_THRESHOLD） | ADR 0003 判断 2・5 | 04 §3（null = 伏せ値）、§7（`_mask` なし）。05 §2.3「—」+「伏せ値」。07 U-04、U-05、I-DB-03、I-DB-07、I-DB-08、E-09 |
| FR-74 失敗の通知 | batch_run.failed_step / error_kind | §14 | 06 §8 | 07 I-B-04、A-08。通知先は GitHub のメール（Q-12 確定） |
| FR-75 初回バックフィル | ― | §10、§16（BACKFILL_START） | ― | 07 I-B-08 |
| FR-76 実行記録 | batch_run、pub_meta、pub_batch_run | §1、§14 | 06 §8 | 04 §3.1 meta。05 §2.7 DataStatus（pub_batch_run は画面に出さない）。07 I-B-01、I-B-05、E-18 |

## 4. 非機能要件（NFR-xx）

| ID | 02 データモデル | 03 パイプライン | 00 / 06 / ADR | 04 / 05 / 07 |
| --- | --- | --- | --- | --- |
| NFR-01 日 1 回 | ― | §2 | ADR 0001 | 07 S-10 |
| NFR-02 翌日 T 時まで | ― | §2（17:00 / 18:00 JST）、§3 | ― | 07 A-07 |
| NFR-03 遅延データ | ― | §9、§6.3 | ― | 07 I-B-02 |
| NFR-04 リアルタイムなし | 表なし | 取得なし | 06 §4 | 07 S-06、U-22 |
| NFR-10 初期表示 3 秒 | ― | ― | ADR 0006（静的） | 04 §6（JSON 60 KB 以下）。05 §12、ADR 0008（HTML に描いた状態）。07 E-17、A-05 |
| NFR-11 キャッシュ、再生成 | ― | §8 | ADR 0006 | 04 §1（実行時のリクエストなし）。07 I-B-09、A-08 |
| NFR-12 同時 10 人 | ― | ― | ADR 0006（CDN） | 07 E-17、A-05 |
| NFR-20 ログインなし | ― | ― | 06 §2.1 | 05 §1（ナビに設定・ログインなし）。07 E-05、S-02 |
| NFR-21 noindex | ― | ― | 06 §2.1、§6 | 05 §2.7（meta robots、robots.txt、404 も）。07 E-01、E-02 |
| NFR-22 管理機能なし、設定の置き場所 | ― | §16 | 06 §2.3 | 05 §1（管理 UI なし）。07 S-06（RANKING）、I-DB-01、A-09 |
| NFR-30 集計値のみ | 全表 | ― | 06 §4 | 07 I-DB-09 |
| NFR-31 次元の一覧 | 02 §4 のビュー列 | §5.4 | 06 §4 | 04 §2（読む列の列挙）。07 I-DB-09 |
| NFR-32 取らないもの | 表なし | §5（取得しない次元） | 06 §4 | 07 U-22、U-23、S-06 |
| NFR-33 伏せ値、§4.1 | §2.3、§3、§5 対応表 | §6.1、§6.3 | ADR 0003 | 04 §3（null の意味は伏せ値のみ）。05 §2.3。07 U-04、U-05、I-DB-03、I-DB-07〜10、E-09、E-10 |
| NFR-34 公開記事だけ | wp_post（protected 除外、cascade） | §4 | ― | 07 U-23、I-B-03 |
| NFR-35 著者は表示名と URL | wp_author（ID なし） | §4（ID はメモリのみ） | 06 §4 | 04 §7（slug は href のみ）。05 S-04、§2.7。07 I-DB-12、E-15 |
| NFR-36 順位表なし | ― | ― | 06 §4 | 04 §7（順位を埋め込まない、topIndex に番号を付けない）。05 §2.2、§2.5、S-08 名前順。07 E-07、E-08、E-15、S-05 |
| NFR-37 市まで | site_month_city、local 3 区分 | G9 | 06 §4 | 07 U-22、I-DB-09 |
| NFR-38 参照元はドメインまで | source_domain | G7、G14、G16、G17 | 06 §4 | 07 U-22、S-06 |
| NFR-39 変更手順 | §8 | §13 | ADR 0003 結果 | 07 A-09（手順の確認）、I-DB-16（列のスナップショット）。Q-36 は ADR 0003 判断 6 で確定 |
| NFR-40 秘密の経路 | `batch_writer` のパスワードはマイグレーションと seed に書かない（§6、§8。W-4） | §16（SUPABASE_BATCH_DB_URL。Environment の Secret。W-3） | 06 §3（TLS の基準、漏えい時の対処。W-1、W-2）、§9、ADR 0009 | 04 §2（SUPABASE_URL / SUPABASE_ANON_KEY はビルド環境変数）。07 U-30、S-09、S-10、S-15、I-DB-18、A-09、A-11 |
| NFR-41 WIF | ― | §5 | ADR 0002、06 §2.2 | 07 A-09（鍵一覧） |
| NFR-42 Supabase はサーバー側 | ― | ― | 06 §2.3、ADR 0006 | 04 §1、§2（NEXT_PUBLIC_ なし）。07 S-01、E-04 |
| NFR-43 RLS、anon は pub_ のみ（除外は初回対象外） | §1・§3（internal スキーマ。M-7）、§6（`batch_writer` の grant とポリシー、`supabase/checks/batch_writer_privileges.sql`。W-8）、§4 | §7 | 06 §2.3、ADR 0009 | 04 §1（from('pub_') の lint）。07 I-DB-01、I-DB-02、I-DB-15、I-DB-16、I-DB-18、S-02、S-17、A-11 |
| NFR-44 ログ・通知の規律 | batch_run の列 | §15、§14（psycopg と pydantic の例外、fd 2 と遅延 import。W-7） | 06 §8、ADR 0004、ADR 0009 | 07 U-29、I-B-04、I-B-05、I-B-11、S-07、S-18 |
| NFR-45 Actions の規律 | ― | §2、§12（heartbeat.yml の分離。M-3）、§14（未処理例外。M-8）、§16（Environment の Secret。W-3） | 06 §9、§10（週 1 の監査、cooldown。W-9）、ADR 0004、ADR 0009 | 07 S-08、S-10、I-B-11、A-11 |
| NFR-50 全期間、開始日 | 全表（削除は記事削除のみ） | §10、§16 | ― | 07 I-B-08、S-06 |
| NFR-51 GA4 の保持に依存しない | 全表 | ― | 01 §6 | 07 S-06 |
| NFR-52 削除記事（除外著者の集計維持は初回対象外） | cascade | §4 | ― | 07 I-B-03、I-DB-13 |
| NFR-60 無料枠 | §7（容量） | §11 | ADR 0001、01 §6 | 07 A-10 |
| NFR-61 GA4 割当 | ― | §11（D-01） | ADR 0007 | 07 I-B-07 |
| NFR-70 無人運用 | batch_run | §14 | ADR 0001 | 07 A-08 |
| NFR-71 60 日停止 | ― | §12（D-07） | ― | 05 §2.7 DataStatus（今日 − 基準日 ≥ 3 日）。07 U-25、A-08 |
| NFR-72 対象サイトへの配慮 | ― | §4（間隔、差分） | 06 §11 | 07 §1（テストから触れない）、I-B-06、A-09 |
| NFR-73 マイグレーション、設定の履歴（台帳は初回対象外） | §8 | §16 | ― | 07 I-DB-14、A-08 |
| NFR-80 ブラウザ | ― | ― | ― | 05 §2.6。07 E-21、A-06 |
| NFR-81 スマホ | ― | ― | ― | 05 §2.6（360px、4 列、6 区分、記事の表の 2 段の値）、§2.9（見た目の共通の決まり: 見出しの大きさ、押せる部品の高さ、狭い画面のヘッダ）、ADR 0008。07 E-13（360px に加えて 800px、1,024px） |
| NFR-82 JST | §2.1 | §3 | ― | 04 §3.1（保存形式）。05 §2.1（表示形式）。07 U-13、A-04 |
| NFR-90 失敗時も前回で表示 | pub_meta.is_stale | §14 | ADR 0006 | 05 §2.7 DataStatus。07 U-25、E-18、I-B-04 |
| NFR-91 入力検証、ヘッダ、エラー、リンク先 | ― | ― | 06 §6、§7 | 04 §8（許可リスト）。05 §10（404 固定文）、§2.7（リンク再検証）。06 §6（style-src 'self'、script-src は ADR 0010 で確定）。07 E-01、E-03、E-06、E-16、S-11 |
| NFR-94 1 画面 1 問い | ― | ― | ― | 05 §1（h1 の問い）、§2.2。07 E-05、A-04 |
| NFR-95 比較の相手 | ― | ― | 06 §4（比較の相手） | 04 §3.1 prevId / yoyId、§5 compare。05 §2.2。07 A-04 |
| NFR-96 分母 20、伏せ値「—」 | （pub_* に mask_threshold） | ― | ADR 0003 判断 5 | 04 §5 compare / share、§3（null）。05 §2.3。07 U-14、U-15、E-09、E-10 |
| NFR-97 色、中立の文言 | ― | ― | ― | 05 §2.1 禁止語、§2.4 色、ADR 0008（1 色の濃淡）。07 U-19、E-11、E-12、S-05 |
| NFR-98 既定の期間と並び | ― | ― | ― | 04 §8 `p` / `sort`。05 §2.5。07 U-18、E-07 |
| NFR-99 スマホの列、説明文、言葉 | （pub_* に注記の材料: mask_threshold、population_size） | ― | ― | 04 §3.1（辞書は ui-text.ts）。05 §2.1、§2.6、§2.7 CommonNotes。07 U-19、E-13、E-14、A-04 |

## 5. データソース（DS-xx）

| ID | 設計 |
| --- | --- |
| DS-01 GA4 Data API | 03 §5（G1〜G17、G19、G20。G18 は初回対象外）、ADR 0002。07 I-B（モック）、A-01（照合） |
| DS-02 WP REST API | 03 §4、02 §3.1。07 I-B（モック）、A-02（照合） |
| DS-03 サーバーログ | 使わない。設計なし |
| DS-04 Search Console | 初回スコープ外。設計なし |
| DS-05 wp-ulike | 取得不可。設計なし |
| DS-06 add-to-any | 初回対象外（設計レビュー M-4）。03 G18 は作らない（D-09 確定: 実装時も合計のみ）。04 §3.8、05 S-09 は作らない |
| DS-07〜DS-09 | 廃止・対象外。設計なし |

## 6. 設計で確認する事項（D-xx）と設計工程で出た質問（Q-xx）

| ID | 結論 | 場所 |
| --- | --- | --- |
| D-01 割当 | 通常日 約 450 トークン、バックフィル 約 5,000。収まる | 03 §11。07 I-B-07 で実測 |
| D-02 SNS 正規化 | 規則表と未対応参照元の表 | 03 §5.2、02 §3.6。07 U-02 |
| D-03 差分取得 | modified_after（要 1 回確認）、per_page 100、ID 一覧で削除検出 | 03 §4。07 I-B-06 |
| D-05 pagePath 正規化 | `^/(\d+)/$`。`/<ID>/<何か>/` の実測は残 | 03 §5.1。07 U-01 |
| D-06 ユーザー数 | 期間単位、4 dateRanges ずつ。日別は格納しない（Q-35 確定） | 03 §5.3 |
| D-07 60 日停止 | 別ワークフロー heartbeat.yml（月 1 回、contents: write のみ、checkout と git だけ。M-3）の条件付きコミット + クライアント側の停滞表示 | 03 §12。06 §9。05 §2.7。07 U-25、S-10 |
| D-08 遅延と伏せ値 | 毎回まるごと再計算、状態を持たない | 03 §6.3。07 I-B-02 |
| D-09 シェアのサービス別 | 取れない（カスタム次元未登録）。合計のみ。確定 | 03 §17 |
| D-10 除外リスト | 初回対象外（2026-11-04、依頼者の決定）。除外の仕組みを作らない | ADR 0005（保留） |
| D-12 カテゴリ別ヒートマップ | 可能だが初回は見送り。親カテゴリ 4 区分に限り NFR-39 の手順 | 03 §13 |
| D-14 ADR の一覧 | ADR 0003 に 5 判断（判断 5 は Q-33） | adr/0003 |
| D-15 page_type | 使わない。regex が正。バックフィル時に 1 回診断 | 03 §5.1 |
| D-16 0 の伏せ扱い | 確定（設計レビュー M-1）: 0 は伏せない。二次伏せの候補は T 以上で最小のセル。03 §6.1 手順 1・3 と ADR 0003 判断 2 追記 1 に反映済み。MASK_ZERO は置かない | 02 §2.3・§9。03 §6.1・§16。07 U-04、U-05、I-DB-08 |
| D-17（新規）CSP の script-src | Next.js のインラインスクリプトの扱い。実装時に確認 | 06 §6、ADR 0008 結果、open_questions §5 |
| Q-33 二次伏せの表示 | 確定: 「—」+「伏せ値」、区別なし | ADR 0003 判断 5、02 §2.3、05 §2.3 |
| Q-34 Vercel Deploy Hook | 確定: Hobby 可、5 本、60 回 / 時、ビルド 45 分 | ADR 0006 |
| Q-35 日別ユーザー数 | 確定: (b) 格納しない | 03 §5.3、05 S-01 |
| Q-36 期間の流入チャネル・デバイス | 確定（2026-11-03）。`site_period_breakdown` に axis channel / device_pv / device_sessions を追加し、期間ごとに GA4 から取る（G19、G20）。二次伏せあり | ADR 0003 判断 6、02 §3.3・§5、03 §5.4・§11、04 §3.2、05 §3 |
| Q-37（新規）タグ一覧の並び | 未確定。設計は名前順固定 | 05 §7.3、§13、open_questions §4 |

## 7. 設計に現れない要件

| ID | 理由 |
| --- | --- |
| M-40 / FR-60 / DS-05 | 取得不可（Q-10 の 1）。サイト側の変更が前提。設計しない。受入基準も未定 |
| M-50 / DS-04 | 初回スコープ外（Q-09）。設計しない |
| M-04、M-05、M-07、M-08、M-42、FR-35、FR-62、DS-07 | 廃止。設計しない。「存在しないこと」は 07 U-22、U-23、S-05、S-06、I-DB-09、E-08 で検査する |
| M-43、FR-63、DS-08、DS-09 | 対象外。「作らない」ことを 06 §4、03 §5、07 U-23 で確認 |
| FR-05 | 優先度 低（Q-19）。実装方針だけ 05 §12 に書き、設計の本体はない |
| FR-61 / M-41 / S-09 | 初回対象外（設計レビュー M-4）。実装するときは NFR-39 の手順に従う。関係する記述は 04 §3.8、05 §9、07 §11 にある |
| U-xx（01_users.md） | 要件 ID ではないが、05 §11 に利用者 → 画面の対応を書いた |

1 回目の §7 にあった「2 回目に回す要件」（FR-03、FR-05、FR-24 の並べ替え制限、NFR-36 の画面上の担保、NFR-80、NFR-81、NFR-94〜NFR-99、FR-04 のリンク先固定、NFR-91 のクライアント側検証、NFR-10 / NFR-12 の確認、M-03 の日別）は、すべて §2〜§4 の 4 列目に入った。
