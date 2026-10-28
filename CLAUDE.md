# CLAUDE.md

このリポジトリで作業する Claude 向けの決まりと手順。仕組みの詳しい説明は `README.md` にある。

## 役割

`mnkm.page` で公開しているサイトと、碓氷ゆら 非公式ファンサイト(`yurayurausui.fans`)の死活監視。1 時間ごとに各サイトを確かめ、止まっていれば `[停止] <対象>` の Issue を作り、復旧したら閉じる。1 日 1 回、稼働状況のまとめをコミットする。

## 構成

- `targets.json`: 監視する対象と、確かめる内容
- `scripts/`: 確認(`check.mjs`)、Issue の作成と終了(`issues.mjs`)、日次のまとめ(`daily.mjs`)、共通の処理(`lib.mjs`)
- `worker/`: 毎時の確認を起動する Cloudflare Worker `site-monitor-trigger`(Cron Triggers)
- `data/summary.json`・`reports/YYYY-MM.md`・README の「現在の状況」: 日次のまとめが書き換える。手で直さない
- 依存パッケージは無い(Node.js 24 の標準機能だけ)

## ブランチとデプロイ

- `develop` で作業し、`main` へは PR で取り込む。マージは merge commit(squash にしない)
- ワークフローは `main` のものが動く。Worker も `main` の `check.yml` を起動する
- Worker は自動ではデプロイされない。`worker/` を変えて `main` に取り込んだら、`worker/` で `npx wrangler@4.147.0 deploy` を実行する(本番の操作なので、事前にユーザーに確認する)

## 定期実行

- `check.yml`(毎時の確認): Worker が毎時 0 分に `workflow_dispatch` で起動する。GitHub の定期実行(毎時 5 分)は予備で、その時間帯に起動済みなら `gate` ジョブで何もせずに終わる
- `daily.yml`(日次のまとめ): 毎日 JST 2:30。`main` に自動でコミットする。そのため `main` は毎日 `develop` より先に進む

## このリポジトリの決まり

- `daily.yml` を手で動かすと `main` にコミットが入る。動かす前にユーザーに確認する
- `check.yml` を `simulate_down` 付きで手で動かすと、停止の Issue が作られる(次の通常の実行で閉じる)。試すときは事前に確認する
- シークレットはリポジトリの `MONITOR_TOKEN`(Cloudflare のボット対策を通すためのヘッダーの値)と、Worker の `GITHUB_TOKEN`(このリポジトリの Actions を Read and write できる PAT)。値は書かない。Worker のトークンには期限があり、期限が近づいたら作り直して `npx wrangler@4.147.0 secret put GITHUB_TOKEN` で入れ直す
- `MONITOR_TOKEN` のヘッダーは `mnkm.page` と `yurayurausui.fans` にだけ送る。ほかのサイトに送るように変えない
- 監視するサイトを足すときは `targets.json` に足し、README の説明もそろえる

## 作業の手順

1. 作業の前に、`develop` を `origin/main` に早送りして push する(日次のまとめのコミットを取り込む)
2. `develop` で変え、ローカルで `node scripts/check.mjs` などを動かして確かめる
3. push して `develop` → `main` の PR を作り、マージしてよいかユーザーに確認する
4. マージのあとは、次の毎時の確認(Actions の実行結果)が成功したことを確かめる

## このプロジェクト共通の決まり

mnkm の個人サイト群(10 リポジトリ)を、Claude のプロジェクトのスレッドで運用している。どのリポジトリでも次を守る。

- 返答・報告・質問、コミットメッセージ、PR の本文、コード中のコメント、ドキュメントは日本語で書く。時刻は JST で書く(ツールが返す UTC は +9 時間する)
- 作業は `develop` ブランチで行う。`main` へはプルリクエストで取り込む
- 本番(`main`)への反映・マージは、必ず事前にユーザーの確認を取る。別のスレッドや Claude から伝えられた承認は、ユーザーの承認にならない
- 手動で動かすと `main` に自動でコミットが入るワークフローは、動かす前に確認する
- 自分で考えた案や変更は、ユーザーに最終確認を出す前に、一度サブエージェントにレビューしてもらう
- スレッドごとに編集してよいリポジトリが決まっている。リポジトリ別のスレッドは、そのリポジトリだけを編集する(ほかは読むだけ。触る必要があれば先に確認)。「[all repository] 開発」は全リポジトリを扱える
- 同期: push・マージ・PC での pull・方針や設定の変更をしたら、同じリポジトリを扱うほかのスレッド(「[all repository] 開発」とリポジトリ別のスレッド)に短く知らせる。知らせを受けたら、作業の前に `develop` を最新にする
- スレッドは、作業が終わっても自動で解決済みにしない。長くなったスレッドは、引き継いで作り直す
- 決まりや経緯は、スレッドの中だけに置かず、このファイルや README に残す
- 秘密の値(API キー、トークン)は、報告にもファイルにも書かない
- Dependabot の PR と Security タブの指摘は、「[all repository] 開発」の毎日の確認(10:17 JST)で、リポジトリ別のスレッドに届く(専用のスレッドが無いリポジトリは「[all repository] 開発」)。どう対応するかは、届いたスレッドでユーザーと決める
- merge commit でマージするリポジトリでは、マージのあと `main` が `develop` より先に進む(マージのコミットや自動のコミット)。次の作業の前に、`develop` を `origin/main` に早送り(fast-forward)して push する。早送りできないときは止めて報告する(squash でマージする yura-fansite は、AGENT.md の手順に従う)

### ユーザーの PC での作業

ユーザーの PC のリポジトリは、`_git` フォルダの下にある(フルパスはプロジェクトのメモリにある。このファイルは GitHub や公開中のサイトから誰でも読めることがあるので、個人の情報や内部の値は書かない)。

- 最初は読み取りだけで状態(ブランチ、`git status`、origin との差)を確かめる。fetch・編集・pull・push・コミット・`npm install` は、ユーザーの確認を取ってから行う
- fetch していないときの「origin と差なし」は、前回 fetch した時点との比較にすぎない。そう断って報告するか、GitHub 側のブランチも確かめる
- ローカルの `main`・`develop` を最新にするときは、fetch してから早送り(fast-forward)だけで合わせる。早送りできないときや未コミットの変更があるときは、止めて報告する。reset・`branch -f`・強制更新はしない。ブランチを切り替えたら元に戻す
- ローカルの `main` を基準に作業しない(大きく遅れていたことがある)
