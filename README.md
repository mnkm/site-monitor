# site-monitor

`mnkm.page` で公開しているサイトと、碓氷ゆら 非公式ファンサイト(`yurayurausui.fans`)の死活監視です。GitHub Actions で 1 時間ごとに各サイトを確認し、止まっていれば Issue を作ります。1 日 1 回、稼働状況のまとめをコミットします。

## 現在の状況

<!-- status:start -->
### 2026-10-30 の稼働状況

確認回数 24 / 24(判定不能 0)、証明書の期限まで残り mnkm.page 56 日・yurayurausui.fans 77 日

| 対象 | 稼働率 | 確認 | 失敗 | 平均応答 | 最大応答 |
| --- | ---: | ---: | ---: | ---: | ---: |
| ポータル | 100.00% | 24 | 0 | 253 ms | 489 ms |
| prnb-songlist | 100.00% | 24 | 0 | 317 ms | 670 ms |
| prnb-stream-calendar | 100.00% | 24 | 0 | 227 ms | 460 ms |
| prnb-stream-calendar API | 100.00% | 24 | 0 | 410 ms | 913 ms |
| tanzaku-generator | 100.00% | 24 | 0 | 323 ms | 787 ms |
| yura-teatime | 100.00% | 24 | 0 | 298 ms | 514 ms |
| yura-fansite | 100.00% | 24 | 0 | 417 ms | 721 ms |
| yura-fansite API | 100.00% | 24 | 0 | 681 ms | 1051 ms |
| prnb-stream-calendar 予定の同期 | 100.00% | 24 | 0 | 610 ms | 1102 ms |
| prnb-songlist データ(Google Apps Script) | 100.00% | 24 | 0 | 3251 ms | 4482 ms |
| yura-teatime データ(Google スプレッドシート) | 100.00% | 24 | 0 | 1572 ms | 9612 ms |
| robots.txt | 100.00% | 24 | 0 | 428 ms | 680 ms |
| sitemap-tools.xml | 100.00% | 24 | 0 | 439 ms | 727 ms |

月ごとの記録: [reports/](reports/)
<!-- status:end -->

## 確認している内容

対象と確認の内容は [`targets.json`](targets.json) に書いています。

| 対象 | 確認の内容 | 通知 |
| --- | --- | --- |
| ポータル、tanzaku-generator、yura-teatime、prnb-stream-calendar、yura-fansite | 応答が 200 で、本文に canonical の URL があること | 1 回の失敗で通知 |
| prnb-songlist | 応答が 200 で、本文にページのタイトルがあること | 1 回の失敗で通知 |
| prnb-stream-calendar | 画面が読み込むスクリプト(`assets/index-*.js`)も 200 で返ること | 1 回の失敗で通知 |
| prnb-stream-calendar API | `/api/channels` が空でない JSON の配列を返すこと | 1 回の失敗で通知 |
| yura-fansite API | `/api/videos` が、動画を 1 件以上含む JSON(`events`)を返すこと(サイトの Worker からカレンダーを読めているか) | 1 回の失敗で通知 |
| prnb-stream-calendar 予定の同期 | 前後 7 日の予定(`/api/events`)が 1 件以上あること(同期が止まっていないか) | 3 回連続の失敗で通知 |
| prnb-songlist のデータ | Google Apps Script が、エラーでない空でない `rows` を返すこと | 3 回連続の失敗で通知 |
| yura-teatime のデータ | Google スプレッドシートの書き出しが XLSX(`PK` で始まるファイル)を返すこと(共有が外れるとログイン画面が返る) | 3 回連続の失敗で通知 |
| robots.txt | `sitemap-tools.xml` への参照があること | 3 回連続の失敗で通知 |
| sitemap-tools.xml | URL が 4 件以上あること(ビルドのときに GitHub API から作るので、空になることがある) | 3 回連続の失敗で通知 |
| 証明書(`mnkm.page`・`yurayurausui.fans`) | 期限まで 10 日以上あること(日次のまとめで確認) | 残り 10 日未満で、ドメインごとに通知 |

- 失敗したら、10 秒後と 30 秒後にもう一度確認してから判定します。応答が遅いだけでは失敗にせず、応答時間を記録します。
- `mnkm.page` と `yurayurausui.fans` は転送(リダイレクト)の先へ進まず、200 が返ることを確かめます。ログイン画面や別のページへの転送を見逃さないためです。Google のサービスは転送の先まで確かめます。
- 最初に `https://www.cloudflare.com/cdn-cgi/trace` を確かめ、これにもアクセスできないときは、GitHub の実行環境の通信の問題とみなして、その回は判定しません(Issue も変えません)。

## Cloudflare のボット対策

GitHub Actions の実行環境からのアクセスは、Cloudflare のボット対策で止められることがあります。このとき、失敗の理由は「Cloudflare のボット対策で止められた」になります。

この監視のアクセスを通すため、`mnkm.page` と `yurayurausui.fans` へのリクエストには、リポジトリの Secret `MONITOR_TOKEN` の値を `X-Site-Monitor` ヘッダーで付けます(ほかのサイトには送りません)。Cloudflare には、このヘッダーの値が一致するリクエストのボット対策を省くルールを設定します。ルールはゾーンごとの設定なので、`yurayurausui.fans` でボット対策を使うときは、そちらにも同じルールを作ります。

## 通知

- 停止を見つけると `[停止] <対象>` の Issue を作り、リポジトリの持ち主を担当者にします。担当者になるので、通知のメールが届きます。
- 停止が続く間は、コメントを足しません。復旧を確かめたら、コメントを書いて Issue を閉じます。
- 監視のスクリプトが異常終了したときは、ワークフローの実行が失敗し、GitHub から失敗の通知メールが届きます。サイトが止まっただけでは、実行は失敗になりません。

## 日次のまとめ

- 毎日 2:30(JST)ごろに前日の結果を集計し、[`data/summary.json`](data/)、[`reports/`](reports/) の月ごとのファイル、この README の「現在の状況」を更新してコミットします。
- 毎時の結果は artifact として 7 日間残します。日次のまとめが実行されなかった日の分は、次の実行で 7 日前までさかのぼって集計します。
- GitHub Actions の定期実行は遅れたり実行されなかったりするので、「確認回数」が 24 に届かない日があります。実行されなかった回は停止として数えません。

## Cloudflare Workers からの起動

GitHub Actions の定期実行は、混んでいると実行されないことがあります。そのため、Cloudflare Workers の Cron Triggers([`worker/`](worker/))から、毎時 0 分(UTC)に「Check sites」を手動実行(`workflow_dispatch`)として起動しています。

- GitHub の定期実行(毎時 5 分)は予備として残しています。同じ時間帯(毎時 5 分の予定時刻を含む 1 時間)に手動実行があれば、定期実行は確認をせずに終わります(`gate` ジョブ)。
- Worker が起動に失敗すると、Cloudflare のダッシュボード(Workers → `site-monitor-trigger` → ログ)に記録が残ります。トークンの期限切れや権限の不足(401・403)ではやり直さず、GitHub の一時的なエラー(5xx・429)では 3 回までやり直します。

### 設定の手順

1. GitHub で fine-grained personal access token を作ります。
   - Repository access: `mnkm/site-monitor` だけ
   - Permissions: `Actions` の Read and write だけ
   - 有効期限を付け、期限が近づいたら作り直して手順 3 で設定し直します。
2. `worker/` で Cloudflare にログインします: `npx wrangler@4.147.0 login`
3. トークンを Secret に設定します: `npx wrangler@4.147.0 secret put GITHUB_TOKEN`
4. デプロイします: `npx wrangler@4.147.0 deploy`

このトークンでは、このリポジトリのワークフローの起動や取り消しができます。`simulate_down` を指定した起動もできるので、外に出さないでください。

## 定期実行の自動停止への対策

GitHub は 60 日間更新の無い公開リポジトリの定期実行を自動で止めます。このリポジトリには日次のまとめのコミットが毎日入るので、止まりません。加えて、日次のまとめのたびに、毎時の確認のワークフローを API で有効にし直しています。

## 動作確認

Actions タブで「Check sites」を手動で実行し、`simulate_down` に対象の id(例: `tanzaku`)を入れると、その対象が止まったものとして Issue が作られます。次の通常の実行で、復旧として閉じられます。この結果は日次のまとめの稼働率には含めません。

## ファイル構成

```
.
├── targets.json                 # 監視する対象と、確認の内容
├── scripts/
│   ├── check.mjs                # 各対象を確認し、結果を JSON に書き出す
│   ├── issues.mjs               # 結果から Issue を作る・閉じる
│   ├── daily.mjs                # 1 日分の集計、証明書の確認、ワークフローの再有効化
│   └── lib.mjs                  # 共通の処理
├── .github/
│   ├── workflows/check.yml      # 毎時の確認(Worker が毎時 0 分に起動。定期実行の毎時 5 分は予備)
│   ├── workflows/daily.yml      # 毎日 2:30(JST)に実行
│   └── dependabot.yml           # アクションの定期更新
├── worker/                      # 毎時の確認を起動する Cloudflare Worker(Cron Triggers)
├── data/summary.json            # 日ごとの集計(日次のまとめが更新)
└── reports/YYYY-MM.md           # 月ごとの稼働状況(日次のまとめが更新)
```

依存パッケージはありません。Node.js 24 の標準機能だけで動きます。Worker のデプロイには `npx` で wrangler を使います。
