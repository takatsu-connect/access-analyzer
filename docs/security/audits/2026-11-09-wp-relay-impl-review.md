# セキュリティ監査: WP REST API の中継（ADR 0011）の実装差分

- 状態: 草案
- 更新日: 2026-11-09
- 範囲: 未コミットの変更（`git status` と `git diff`、新規の `apps/wp-relay/`）。観点は依頼の項目（トークン比較、fail closed、検査の順序、許可リストの回避、SSRF、応答ヘッダ、ログ、秘密の置き場、ワークフローの権限と Secret の渡し先、SHA 固定、新しい依存）と、ADR レビューの指摘 M-1〜M-4、L-1〜L-7 の実装での充足。監査はコードの読み取りと、リポジトリ設定の読み取りだけで行い、テストの実行、デプロイ済みの中継への接続、対象サイトへの接続はしていない
- 読んだもの:
  - docs/design/adr/0011-wp-fetch-relay.md 全体
  - docs/security/audits/2026-11-09-wp-relay-adr-review.md 全体
  - .claude/rules/security.md 全体（依頼時のコンテキストで参照）
  - apps/wp-relay/api/relay.ts、vercel.json、package.json 全体
  - apps/wp-relay/tests/relay.test.ts（テスト名と `Bearer` などの文字列を Grep）、pnpm-lock.yaml（構造を Grep）
  - `git diff`: .env.example、.github/dependabot.yml、.github/scripts/check_repo_rules.py、.github/workflows/audit.yml・ci.yml・daily.yml、apps/batch/src/takatsu_batch/env.py・pipeline.py・wp_fetch.py、contracts/constants.json
  - .github/workflows/daily.yml、audit.yml、.github/dependabot.yml 全体。ci.yml（`uses:` と権限を Grep）
  - apps/batch/src/takatsu_batch/wp_fetch.py 155-204 行、env.py 85-160 行、__main__.py（例外とログの設定を Grep）
  - .gitignore（Grep）、apps/web/package.json（`packageManager` を Grep）
- 実行した確認: `pnpm audit`（apps/wp-relay）、`gh api`（Environment `production`、デプロイ元のブランチ、main の保護、ruleset）、`gh secret list`（名前だけ）

## 結論

**修正後に公開。** 致命的 0 件、高 0 件、中 1 件、低 3 件。

実装のコードには、致命的・高の問題も、許可リストを回避できる経路も見つからなかった。ADR レビューの M-1 と L-3〜L-5、L-7 はコードで満たされている。

「修正後」としたのは、M-2 と M-3 の対策が CLI のデプロイとトークンのローテーションの**手順**であり、その本文がまだ docs/operations/ にないため（M-1）。コードの変更をコミットすることを妨げる指摘はない。中継を本番にデプロイする前に M-1 を済ませる。

## 指摘

### 致命的

なし。

### 高

なし。

### 中

#### M-1 デプロイの安全の前提になる手順が docs/operations/ にない

- 対象: docs/operations/（`WP_RELAY`、`wp-relay` の記述なし）、ADR 0011 §1（48-58 行）、§3（122-136 行）、「影響する設計文書」（265 行）
- 問題: ADR は手順の「本文は docs/operations/」としているが、まだ書かれていない。06_security.md と 07_test_plan.md にも中継の記述がない（設計文書は ADR の確定時に直す計画で、ADR の状態はレビュー中）。
- 悪用の筋道: プレビューを作らないこと（ADR レビュー M-2）と、旧トークンを持つ過去のデプロイの削除（同 M-3）は、コードでは強制できず手順でしか守られない。手順がないまま作業すると、`--prod` なしの `vercel deploy` でプレビューができる、Git 連携が残る、ローテーションの後も過去のデプロイが旧トークンを受け付ける、のいずれかが起きうる。
- 影響: 検査を外したコードが hnd1 で動く経路、または無効化したはずのトークンが有効なまま残る経路が開く。損失の見積もりは ADR レビューと同じで、主に対象サイトへの負荷と Vercel の費用である。
- 対策: 中継をデプロイする前に、ADR §1 の手順 1〜5、§3 のローテーションと 2 通りの停止手順、§8 の切り分け、実行回数の目安を docs/operations/ に書く。ADR の確定と設計文書の更新も同じ時期に行う。
- 根拠: `git grep -l -E "WP_RELAY|wp-relay" -- docs/operations docs/design/06_security.md docs/design/07_test_plan.md` の結果が空。`git status` に docs の変更がない。
- 関係: ADR レビュー M-2、M-3、M-4、NFR-44、security.md「確認の流れ」

### 低

#### L-1 トークンの長さの下限がどこでも検査されない

- 対象: apps/wp-relay/api/relay.ts 219-221 行、apps/batch/src/takatsu_batch/env.py 29 行（`_RELAY_TOKEN`）、127 行
- 問題: ADR §3 は 32 バイト以上の乱数と定めているが、中継は空でなければ受け入れ、バッチも 1 文字以上の ASCII なら受け入れる。短い値を誤って登録しても起動時に気づかない。
- 悪用の筋道: 設定の誤りで短いトークンが入ると、公開の入口に対する総当たりが現実的になる。中継にレート制限はない（ADR の M-4 の受け入れ）。
- 影響: 許可リストの範囲の読み取りと、対象サイトへの負荷。設定の誤りが前提なので低とした。
- 対策: 中継で長さが足りないときも `misconfigured` の 401 にする（16 進 64 文字を想定するなら 64 文字未満）。バッチの `_RELAY_TOKEN` にも同じ下限を入れる。あわせてテストを足す。
- 根拠: 該当行の読み取り。
- 関係: ADR 0011 §3

#### L-2 CI の合格が main の条件になっておらず、中継のデプロイは手元の main から行う

- 対象: リポジトリの設定（main の保護）、ADR 0011 §1（53 行）
- 問題: main にあるのは ruleset「main: force push と削除の禁止」だけで、必須のステータスチェックがない。今回足した `wp-relay` ジョブの失敗は main への反映を止めない。ADR §1 の手順は「main に切り替えて `git status` がきれい」までで、そのコミットの CI の結果を確かめない。
- 悪用の筋道: 許可リストを壊す変更やテストの失敗が main に入ったまま、手元からデプロイされる。public リポジトリの第三者が直接 main に入れる経路ではない（誤操作の防止の話）。
- 影響: 入口の検査の退行が本番に出る。
- 対策: docs/operations/ の手順に「デプロイするコミットの `wp-relay` ジョブが成功していること」を足す。必須チェックを main に設けるかは依頼者が決める（直接 push の運用との兼ね合いがある）。
- 根拠: `gh api .../branches/main/protection/required_status_checks` が 404（Branch not protected）。`gh api .../rulesets` の一覧が上記の 1 件。ruleset の中身のルールまでは読んでいないが、名称と `required_status_checks` の 404 からの判断で、必須チェックの有無は依頼者の確認項目 5 で確定する。
- 関係: security.md「依存」、脅威モデル「誤操作」

#### L-3 pnpm の版に integrity が付いていない

- 対象: apps/wp-relay/package.json 7 行、.github/workflows/ci.yml 98-101 行
- 問題: `packageManager` は `pnpm@10.6.5` で、ハッシュがない。CI は corepack で pnpm を取得して実行する。Actions は SHA で、Python の依存はハッシュで固定しているのに対し、ここだけ版の指定に留まる。apps/web も同じ形で、新しい弱点ではなく既存の形の踏襲である。
- 悪用の筋道: 配布元の pnpm が差し替えられた場合に CI で実行される。CI のこのジョブは Secret を持たず `contents: read` なので、影響は限られる。corepack が既定で行う検証の内容は事実票になく未確認。
- 影響: 小さい。
- 対策: 次に pnpm を更新するときに、apps/web と apps/wp-relay の両方で `pnpm@<版>+sha512.<値>` の形にする。
- 根拠: 該当行の読み取り。

## ADR レビューの指摘の充足

| 指摘 | 判定 | 確認した内容 |
| --- | --- | --- |
| M-1 必須キー | 満たす | relay.ts 41-48 行で全パスの `_fields`、`/posts` の `status`、一覧の `per_page` と `page` が必須。94 行で欠落は 400 |
| M-2 プレビュー | コードの範囲外。手順待ち | ADR §1 に決定はある。手順の本文は未作成（本報告 M-1）、Vercel の設定は未確認 |
| M-3 旧トークン | コードの範囲外。手順待ち | 同上 |
| M-4 上限と検知 | ADR で受け入れ | 中継に状態を持たせない実装で ADR どおり。Firewall と費用の通知はデプロイ工程の未確認事項のまま |
| L-1 slug | ADR に反映済み | `USER_FIELDS` は `name,slug,link`。security.md の断り書きと、slug とログイン名の異同は依頼者の判断待ち |
| L-2 著者 ID と基盤ログ | ADR に反映済み | 中継のログには出ない（relay.ts 124 行）。Vercel の基盤の記録は未確認 |
| L-3 検査の順序 | 満たす | relay.ts 220-224 行。環境変数なしも不一致も同じ 401 で本文なし |
| L-4 応答ヘッダ | 満たす | relay.ts 126-129 行 |
| L-5 依存と CI | 満たす | dependabot.yml 49-57 行、audit.yml 52-54 行、ci.yml の `wp-relay` ジョブと deps-audit |
| L-6 拒否の区別 | ADR で見送り | ヘッダは足していない。Vercel のログの保持期間が前提 |
| L-7 読みながら数える | 満たす | relay.ts 151-168 行。`Content-Length` を使わない |
| L-7 本文まで含む 20 秒 | 満たす | relay.ts 179-182、199、213 行。タイマーは本文の読み終わりのあとに解除 |
| L-7 localhost の完全一致 | 満たす | env.py 123 行は集合の完全一致。`_RELAY_ORIGIN` はユーザー情報、パス、クエリを通さない |
| L-7 api/ は 1 ファイル | 満たす（リポジトリ内） | `apps/wp-relay/api/` は relay.ts だけ。Vercel 上の関数の数はデプロイ後に確認 |

## 依頼者に確認してもらう項目

| # | 項目 | 場所 | 関係 |
| --- | --- | --- | --- |
| 1 | `takatsu-connect-wp-relay` に Git 連携がないこと、Standard Protection が有効なこと | Vercel のプロジェクト設定 | ADR レビュー M-2 |
| 2 | `WP_RELAY_TOKEN` を Production だけに、Sensitive で登録できるか。64 文字の乱数であること（値は見せない） | Vercel の環境変数 | L-1 |
| 3 | デプロイ後、関数が `api/relay` の 1 つだけで、デプロイの一覧にプレビューがないこと | Vercel のデプロイの画面 | ADR §1 |
| 4 | Environment `production` に `WP_RELAY_URL` と `WP_RELAY_TOKEN` を登録すること。現時点では未登録で、バッチは直接接続のまま | GitHub の Environment | ADR §3、§6 |
| 5 | main の必須チェックを設けるか。ruleset の中身に必須チェックがないこと | GitHub の ruleset | L-2 |
| 6 | Firewall のレート制限、費用の上限や通知、基盤のログの項目と保持期間、チームのメンバーと 2 要素認証 | Vercel のチーム設定、Docs | ADR レビュー M-4、L-2、L-6 |

## 未確認

| 項目 | 確認方法 |
| --- | --- |
| Vercel が `GET` などの名前つき export の Web 標準ハンドラをこの構成（Next.js なし）で動かすか、`request.url` の形、export していないメソッドの応答 | Vercel Docs の事実票（ADR の未確認の事項）。デプロイ後は 07 A-11 の実行で確かめる |
| `vercel deploy` が作業ツリーのどのファイルをアップロードするか。`.gitignore` 済みのファイル（`apps/wp-relay/.env` を置いた場合など）が含まれるか。`.vercelignore` はまだない | Vercel Docs の事実票。含まれるなら `.vercelignore` を足す。少なくとも `apps/wp-relay` に秘密のファイルを置かない手順を docs/operations/ に書く |
| `package.json` や `tests/` などが静的ファイルとして配信されるか。内容は public リポジトリと同じなので秘密は増えないが、公開の入口を 1 つにする ADR の趣旨に関わる | デプロイ後に依頼者がデプロイの出力（Vercel の画面の Source / Output）で確かめる。監査では本番に接続しない |
| `redirect: 'manual'` での 3xx の見え方（実環境） | 実機の確認。relay.ts 171-173 行で 0 の場合も失敗側に倒している |
| hnd1 の出口 IP の国と固定性 | ADR の未確認の事項のとおり |
| 単体テストが実際に通るか。今回は実行せず、テスト名の Grep だけ | CI の `wp-relay` ジョブ、`apps/batch` のテスト |

## 問題なしと確認した項目

コードの読み取りによる。動作は未実行。

- **トークン比較**: 受信値と期待値を SHA-256 にして `timingSafeEqual`（relay.ts 106-114 行）。長さで分岐しない。ヘッダ欠落は空文字として同じ経路。
- **fail closed**: 環境変数の未設定と空は 401（220 行）。空のトークンと空の `Authorization` の一致も起きない（220 行で先に返る）。
- **検査の順序**: トークン → メソッド → パスとクエリ（220-224 行）。全メソッドが同じ `handle` を通る。401 は本文なし。
- **パスの回避**: `X-WP-Path` は完全一致（50-55 行）で正規化をしないので、`/posts/`、`/../`、`%2e`、`/users/01` は通らない。JavaScript の `$` は複数行フラグなしで文字列の末尾だけに一致し、`\d` は ASCII だけなので、末尾の改行や全角数字は通らない。同名のヘッダの重複は `, ` で連結され、完全一致に失敗する。
- **クエリの回避**: 判定は `URLSearchParams` のデコード後に行うので、`%5Ffields` と `_fields` の重複は 92 行で 400（テストにもある）。未知のキー、`__proto__` は配列の照合で 400。値はキーごとに完全一致または ASCII の正規表現。転送する URL は検証済みの組からだけ作る（96-103 行）。
- **SSRF**: ホストとスキームは定数（6 行）。`redirect: 'manual'`（186 行）。入力由来はパスの完全一致の値と検証済みのクエリだけ。
- **ヘッダの遮断**: 上流へは `User-Agent` だけ（187 行）。`Authorization`、Cookie、`X-Forwarded-For` は渡らない。
- **応答**: 上流から返すのは状態コード、2xx の本文、形を検査した `X-WP-Total` と `X-WP-TotalPages` だけ（133-140、192-207 行）。`Location`、`Set-Cookie` は返さない。`no-store` と 3 つのセキュリティヘッダはエラーを含む全応答に付く（`respond` に集約）。
- **本文の上限**: 読みながら数える。`fetch` の展開後の大きさを数えるので、圧縮爆弾でも 4 MB で止まる。
- **ログ**: 1 行に `outcome`、`status`、`duration_ms` だけ（124 行）。`catch` は例外の内容を出さない。
- **バッチの秘密の扱い**: URL とトークンは `SecretStr`。root のログは `CRITICAL + 1` で `sys.excepthook` を差し替え済み（__main__.py 41、48、59-62 行）で、httpx の例外や URL は Actions のログに出ない。`follow_redirects=False` のままで、3xx でトークンが別のホストに送られない。`_RELAY_TOKEN` の検査で、不正な文字のエラーに値が載らない。`WpClient` を作るのは pipeline.py 135 行だけで、中継の失敗時に直接接続に戻さない。片方だけの設定は `BatchValidationError`。
- **Secret の渡し先**: `WP_RELAY_URL` と `WP_RELAY_TOKEN` は daily.yml の `daily` と `backfill` のバッチのステップの `env` だけ（79-80、119-120 行）。`publish_only`、pip の導入、GCP の認証のステップには渡らない。`publish_only` は `load_publish_hook` で中継の変数を読まない。ci.yml と audit.yml は参照しない。check_repo_rules.py がこの配置を CI で強制する。
- **ワークフロー**: ci.yml、audit.yml、daily.yml の既定は `contents: read`。`id-token: write` は `daily` と `backfill` だけ。`pull_request_target` なし。`wp-relay` ジョブは Secret なしで fork の PR でも安全。新しい `uses:` は既存と同じ commit SHA で、バージョンのコメントつき。`persist-credentials: false`。
- **Environment**: `production` のデプロイ元は `main` のブランチ 1 件だけ（ADR レビューの確認項目 9 を今回解消）。`WP_RELAY_*` は Environment に置く計画で、リポジトリの Secret の一覧にもない。
- **文書とサンプル**: `.env.example` は項目名だけ。`.vercel/` は .gitignore 41 行、`.env` は 12 行で除外。テストに実物らしいトークンの Grep の一致なし（`Bearer` は定数の組み立てだけ）。
- **依存**: 実行時の依存はゼロ（relay.ts の import は `node:crypto` だけ）。開発の依存 3 つは版を固定し、ロックファイルあり。ロックに `tarball` などの registry 外の参照なし。`pnpm audit --audit-level=low` は「No known vulnerabilities found」（2026-11-09）。Dependabot の対象に追加済み。
- **設定**: `regions` は `["hnd1"]`、`maxDuration` は 25 秒で、リライトやヘッダの上書きはない。
