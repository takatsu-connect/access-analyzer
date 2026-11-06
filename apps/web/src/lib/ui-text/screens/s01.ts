/**
 * S-01（全体ダッシュボード）の文言。src/lib/ui-text.ts の辞書にまとめて入り、t() で引く。
 *
 * 書き方の決まり:
 * - キーは 's01.' で始める、点区切りの平らな文字列にする。src/lib/ui-text.ts にあるキーと重ねない。
 * - 05 §2.1 の「使わない語」と「出ません」で終わる文を入れない（コメントにも書かない）。
 * - 差し込み値は {name} の形で書く（例: 's01.sample': '{n} 本の記事' → t('s01.sample', { n })）。
 *
 * ここの文言は仮の初期値（analytics-advisor の確認前）。
 */
import type { ScreenTexts } from './types';

export const S01_TEXT = {
  // --- 比較の相手や値がまだないとき ---
  // 前の期間の不在は共通の absent.prev を使う。
  's01.absent.value': 'まだ数字がありません',

  // --- もっと見る（訪問回数、読まれていた時間、公開した時期ごとの読まれ方） ---
  's01.more.summary': 'ほかの数字を見る（訪問回数、読まれていた時間など）',
  's01.engagement.prev': '前の期間は {value}',
  // 前の期間はあるが、読まれた回数が 20 回未満で目安を出せないとき（absent.ratio20 と同じ形）。
  's01.engagement.prev.ratio20': '前の期間の読まれた回数が 20 回以上のときに出ます',
  's01.freshness.column': '公開した時期',
  's01.freshness.note':
    '上の「読まれた回数」には、トップページなど記事以外のページも含まれるため、この表の合計とは一致しません。',

  // --- 日ごとの読まれた回数 ---
  's01.daily.h2': '日ごとの読まれた回数',
  's01.daily.title': '日ごとの{label}',
  's01.daily.title.week': '週ごとの{label}',
  's01.daily.metric.aria': 'グラフに出す数字',
  's01.daily.grain.aria': 'グラフのまとめ方',
  's01.daily.grain.week': '週ごと',
  's01.daily.grain.day': '日ごと',
  's01.daily.fixedRow.week.published': '。この週に {n} 本公開',
  's01.daily.table.date': '日付',
  's01.daily.table.week': '週',
  's01.daily.table.published': '公開した本数',
  's01.daily.table.unconfirmed': '{date}＊',
  's01.daily.table.note': '＊ の付いた日（週）は、あとで増えることがあります。',

  // --- 図に添える表（共通） ---
  's01.table.summary': '同じ数字を表で見る',
  's01.table.bucket': '区分',
  's01.table.prevShare': '前の期間の割合',

  // --- 読者はどこから来たか ---
  's01.channel.other.summary': '「その他」に含めた区分',
  's01.channel.other.body':
    'AI アシスタント（AI Assistant）、メール（Email）、動画（Organic Video）、広告（Paid 系）、分類できなかったもの（Unassigned）など、ほかの 4 つに入らないものをまとめています。',

  // --- 月ごとに集計する表（リンク元のサイト、市別） ---
  's01.monthly.heading': '{label}（{month}）',
  's01.monthly.note': '月ごとに集計しています。上で期間を選び直しても変わりません。',
  // 比べる月の表そのものがないとき。
  's01.monthly.noPrev': '前の月の数字なし',
  // 比べる月の表はあるが、その行がないとき（バッチは月ごとに上位 10 行だけを持つ）。
  's01.monthly.prevNotListed': '前の月は表にありません',
  's01.monthly.yoyNotListed': '去年の同じ月は表にありません',
  's01.city.label': '市別',
  's01.city.region': '都道府県',
  's01.city.city': '市',

  // --- 読者はどんな人？ ---
  's01.heat.mode.aria': '数字の出し方',
  's01.heat.row': '{day}曜',
  's01.heat.hour': '{hour} 時',
  's01.heat.label': '{metric}（{mode}）',
  's01.heat.table.day': '曜日',
  's01.heat.table.time': '時間帯',
  's01.heat.note.avg':
    '「1 日あたりの平均」は、期間の合計を期間の日数（{days} 日）で割った値です。',
  's01.device.h3': 'どんな端末で読まれたか',
  's01.device.sessions.summary': '詳しく（訪問回数で見る）',
  's01.device.sessions.title': 'どんな端末で読まれたか（訪問回数）',
  's01.newReturning.h3': '初めての人とまた来た人',
} as const satisfies ScreenTexts<'s01'>;
