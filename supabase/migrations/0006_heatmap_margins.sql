-- 曜日ごと・時間帯ごとの読まれた回数（S-01 のヒートマップの平均の列と行。2026-11-10 の依頼者の決定）。
-- site_period_breakdown に軸 dow（曜日 7 区分。'0' = 日曜）と hour（時間帯 24 区分）を足す。
-- バッチが GA4 の曜日 × 時間帯（G8）の伏せる前の値から合計を作り、区分ごとに T と二次伏せを
-- 適用して格納する（ADR 0003 判断 8）。表・ビュー・権限は増やさない。公開ビュー
-- pub_site_period_breakdown は軸を絞らずに出しているので、そのまま新しい軸も出る。
-- 制約を広げるだけなので、この適用の前に動いていたバッチの書き込みもそのまま通る。

alter table internal.site_period_breakdown
  drop constraint site_period_breakdown_axis_check;

alter table internal.site_period_breakdown
  add constraint site_period_breakdown_axis_check
  check (axis in ('sns', 'new_returning', 'local', 'channel', 'device_pv', 'device_sessions', 'dow', 'hour'));
