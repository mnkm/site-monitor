# site-monitor

`mnkm.page` で公開しているサイトの死活監視です。GitHub Actions で 1 時間ごとに(Cloudflare Workers から起動して)各サイトを確認し、止まっていれば Issue で知らせます。1 日 1 回、稼働状況のまとめをコミットします。

## 現在の状況

<!-- status:start -->
### 2026-10-17 の稼働状況

確認回数 24 / 24(判定不能 0)、証明書の期限まで残り 69 日

| 対象 | 稼働率 | 確認 | 失敗 | 平均応答 | 最大応答 |
| --- | ---: | ---: | ---: | ---: | ---: |
| ポータル | 100.00% | 24 | 0 | 231 ms | 425 ms |
| prnb-songlist | 100.00% | 24 | 0 | 302 ms | 479 ms |
| prnb-stream-calendar | 100.00% | 24 | 0 | 241 ms | 372 ms |
| prnb-stream-calendar API | 100.00% | 24 | 0 | 415 ms | 611 ms |
| tanzaku-generator | 100.00% | 24 | 0 | 289 ms | 704 ms |
| yura-teatime | 100.00% | 24 | 0 | 263 ms | 461 ms |
| prnb-stream-calendar 予定の同期 | 100.00% | 24 | 0 | 415 ms | 678 ms |
| prnb-songlist データ(Google Apps Script) | 100.00% | 24 | 0 | 2831 ms | 5081 ms |
| yura-teatime データ(Google スプレッドシート) | 100.00% | 24 | 0 | 892 ms | 1327 ms |
| robots.txt | 100.00% | 24 | 0 | 233 ms | 435 ms |
| sitemap-tools.xml | 100.00% | 24 | 0 | 240 ms | 364 ms |

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

## Cloudflare Workers からの起動

GitHub Actions の定期実行は混むと飛ばされることがあり、毎時の確認が 1 日に数回しか動かない日がありました。そこで、Cloudflare Workers の Cron Triggers([`worker/`](worker/))から、毎時 0 分(UTC)に「Check sites」を手動実行(`workflow_dispatch`)として起動しています。

- GitHub の定期実行(毎時 5 分)は予備として残しています。その回が受け持つ時間帯(毎時 5 分の予定時刻を含む 1 時間)に、すでに手動実行があれば確認せずに終わります(`gate` ジョブ)。Worker の起動が失敗したり止まったりした時間帯は、定期実行が動けば確認されます。
- Worker が起動に失敗したときは、Cloudflare のダッシュボード(Workers → `site-monitor-trigger` → ログ)に失敗が残ります。トークンの期限切れや権限不足(401・403)はやり直さず、GitHub 側の一時的な不調(5xx・429)は 3 回までやり直します。

### 設定の手順

1. GitHub で Fine-grained personal access token を作ります。
   - Repository access: `mnkm/site-monitor` だけ
   - Permissions: `Actions` を Read and write(ほかは付けない)
   - 有効期限を付け、期限が近づいたら作り直して手順 3 で設定し直します
2. `worker/` で Cloudflare にログインします: `npx wrangler@4.147.0 login`
3. トークンを Secret に設定します: `npx wrangler@4.147.0 secret put GITHUB_TOKEN`
4. デプロイします: `npx wrangler@4.147.0 deploy`

このトークンでできるのは、このリポジトリのワークフローの起動・取り消しなどだけです(`simulate_down` を指定した起動もできるので、外には出さないでください)。

## 定期実行が止まらないようにする仕組み

GitHub は、60 日間動きの無い公開リポジトリの定期実行を自動で止めます。このリポジトリでは、日次のまとめのコミットが毎日入るので止まりません。念のため、日次のまとめのたびに、毎時の確認のワークフローを API で有効にし直しています。

## 動作確認

Actions タブで「Check sites」を手動実行し、`simulate_down` に対象の id(例: `tanzaku`)を入れると、その対象だけ停止したことにして Issue が作られます。次の通常の実行で、復旧として閉じられます。停止したことにした結果は、日次のまとめの稼働率には含めません。

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
│   ├── workflows/check.yml      # 毎時の確認(Worker から毎時 0 分に起動。定期実行の毎時 5 分は予備)
│   ├── workflows/daily.yml      # 毎日 JST 2:30 に実行
│   └── dependabot.yml           # アクションの定期更新
├── worker/                      # 毎時の確認を起動する Cloudflare Worker(Cron Triggers)
│   ├── wrangler.jsonc
│   └── src/index.js
├── data/summary.json            # 日ごとの集計(日次のまとめが更新)
└── reports/YYYY-MM.md           # 月ごとの稼働状況(日次のまとめが更新)
```

依存パッケージはありません(Node.js 24 の標準機能だけで動きます。Worker のデプロイには `npx` で wrangler を使います)。
