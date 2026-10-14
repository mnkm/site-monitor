# site-monitor

`mnkm.page` で公開しているサイトの死活監視です。GitHub Actions で 1 時間ごとに各サイトを確認し、止まっていれば Issue で知らせます。1 日 1 回、稼働状況のまとめをコミットします。

## 現在の状況

<!-- status:start -->
### 2026-10-14 の稼働状況

確認回数 4 / 24(判定不能 0)、証明書の期限まで残り 72 日

| 対象 | 稼働率 | 確認 | 失敗 | 平均応答 | 最大応答 |
| --- | ---: | ---: | ---: | ---: | ---: |
| ポータル | 100.00% | 4 | 0 | 195 ms | 250 ms |
| prnb-songlist | 100.00% | 4 | 0 | 219 ms | 263 ms |
| prnb-stream-calendar | 100.00% | 4 | 0 | 212 ms | 285 ms |
| prnb-stream-calendar API | 100.00% | 4 | 0 | 530 ms | 814 ms |
| tanzaku-generator | 100.00% | 4 | 0 | 274 ms | 352 ms |
| yura-teatime | 100.00% | 4 | 0 | 263 ms | 368 ms |
| prnb-stream-calendar 予定の同期 | 100.00% | 4 | 0 | 536 ms | 816 ms |
| prnb-songlist データ(Google Apps Script) | 100.00% | 4 | 0 | 2010 ms | 2504 ms |
| yura-teatime データ(Google スプレッドシート) | 100.00% | 4 | 0 | 1033 ms | 1897 ms |
| robots.txt | 100.00% | 4 | 0 | 225 ms | 283 ms |
| sitemap-tools.xml | 100.00% | 4 | 0 | 229 ms | 261 ms |

月ごとの記録: [reports/](reports/)
<!-- status:end -->

## 確認している内容

対象と確認の内容は [`targets.json`](targets.json) にあります。

| 対象 | 確認の内容 | 通知 |
| --- | --- | --- |
| ポータル、tanzaku-generator、yura-teatime、prnb-stream-calendar | 応答が 200 で、本文に canonical の URL があること | 1 回の失敗で通知 |
| prnb-songlist | 応答が 200 で、本文にページのタイトルがあること | 1 回の失敗で通知 |
| prnb-stream-calendar | 画面が読み込むスクリプト(`assets/index-*.js`)も 200 で返ること | 1 回の失敗で通知 |
| prnb-stream-calendar API | `/api/channels` が空でない JSON の配列を返すこと | 1 回の失敗で通知 |
| prnb-stream-calendar 予定の同期 | 前後 7 日の予定(`/api/events`)が 1 件以上あること(同期が止まっていないか) | 3 回連続の失敗で通知 |
| prnb-songlist のデータ | Google Apps Script が、エラーでない空でない `rows` を返すこと | 3 回連続の失敗で通知 |
| yura-teatime のデータ | Google スプレッドシートの書き出しが XLSX(`PK` で始まるファイル)を返すこと(共有が外れるとログイン画面が返る) | 3 回連続の失敗で通知 |
| robots.txt | `sitemap-tools.xml` への参照があること | 3 回連続の失敗で通知 |
| sitemap-tools.xml | URL が 4 件以上あること(ビルド時に GitHub API から作るため、空になる故障がありうる) | 3 回連続の失敗で通知 |
| 証明書(`mnkm.page`) | 期限まで 10 日以上あること(日次のまとめで確認) | 残り 10 日未満で通知 |

- 失敗したら、10 秒後と 30 秒後にやり直してから判定します。応答が遅いだけでは失敗にしません(応答時間は記録します)。
- `mnkm.page` のサイトは転送(リダイレクト)をたどらず、200 そのものを求めます(ログイン画面や別のページへの転送を見逃さないため)。Google のサービスは転送をたどります。
- 先に対照として `https://www.cloudflare.com/cdn-cgi/trace` を確かめ、それにもアクセスできないときは、GitHub の実行環境の通信の不調とみなしてその回は判定しません(Issue も変えません)。

## Cloudflare のボット対策との関係

GitHub Actions の実行環境(データセンターの IP)からのアクセスは、Cloudflare のボット対策でチャレンジされることがあります。その場合の失敗は、理由が「Cloudflare のボット対策で止められた」になります。

この監視のアクセスだけを通すため、`mnkm.page` へのリクエストには、リポジトリの Secret `MONITOR_TOKEN` の値を `X-Site-Monitor` ヘッダーで付けます(Google など、ほかのサイトには送りません)。Cloudflare 側で、このヘッダーの値が一致するリクエストのボット対策をスキップするルールを設定します。

## 通知

- 停止を検知すると `[停止] <対象>` の Issue を作り、リポジトリの持ち主を担当者にします(担当者になるので、通知メールが届きます)。
- 停止中は、毎時確認してもコメントは増やしません。復旧を確認したら、コメントを残して自動で閉じます。
- この監視の仕組み自体が壊れたとき(スクリプトの異常終了など)は、ワークフローの実行が失敗し、GitHub から失敗の通知メールが届きます。サイトの停止では実行は失敗しません。

## 日次のまとめ

- 毎日 JST 2:30 ごろに、前日の結果を集計して [`data/summary.json`](data/) と [`reports/`](reports/) の月ごとのファイル、この README の「現在の状況」を更新し、コミットします。
- 毎時の結果は artifact として 7 日間残します。日次のまとめが飛んだ日は、次の実行で 7 日前までさかのぼって集計します。
- 「確認回数」が 24 に届かない日があります。GitHub Actions の定期実行は遅れたり飛んだりすることがあり、その分は停止として数えません。

## 定期実行が止まらないようにする仕組み

GitHub は、60 日間動きの無い公開リポジトリの定期実行を自動で止めます。このリポジトリでは、日次のまとめのコミットが毎日入るので止まりません。念のため、日次のまとめのたびに、毎時の確認のワークフローを API で有効にし直しています。

## 動作確認

Actions タブで「Check sites」を手動実行し、`simulate_down` に対象の id(例: `tanzaku`)を入れると、その対象だけ停止したことにして Issue が作られます。次の通常の実行で、復旧として閉じられます。

## ファイル構成

```
.
├── targets.json                 # 監視する対象と、確認の内容
├── scripts/
│   ├── check.mjs                # 各対象を確認し、結果を JSON に書き出す
│   ├── issues.mjs               # 結果をもとに Issue を作る・閉じる
│   ├── daily.mjs                # 1 日分の結果の集計、証明書の確認、ワークフローの再有効化
│   └── lib.mjs                  # 共通の処理
├── .github/
│   ├── workflows/check.yml      # 毎時 5 分に実行
│   ├── workflows/daily.yml      # 毎日 JST 2:30 に実行
│   └── dependabot.yml           # アクションの定期更新
├── data/summary.json            # 日ごとの集計(日次のまとめが更新)
└── reports/YYYY-MM.md           # 月ごとの稼働状況(日次のまとめが更新)
```

依存パッケージはありません(Node.js 24 の標準機能だけで動きます)。
