// check.mjs の結果をもとに、停止の Issue を作る・復旧したら閉じる。
//   node scripts/issues.mjs <check.mjs の出力>
// 停止中に何度確認しても、Issue へのコメントは増やさない(通知が増えすぎないように)。
import { ISSUE_THRESHOLD, ensureLabels, gh, jstTime, readJson, repo } from './lib.mjs';

const [resultPath] = process.argv.slice(2);
if (!resultPath) throw new Error('usage: node scripts/issues.mjs <result.json>');

const config = readJson(new URL('../targets.json', import.meta.url));
const run = readJson(resultPath);

if (run.inconclusive) {
  console.log('この回は判定しなかったため、Issue は変更しない');
  process.exit(0);
}

const owner = repo().split('/')[0];
const runUrl = process.env.GITHUB_RUN_URL;

ensureLabels([
  ['down', 'd73a4a', 'サイトやデータの停止'],
  ['severity:core', 'b60205', 'サイト本体(1 回の失敗で通知)'],
  ['severity:secondary', 'fbca04', '外部データ・補助ファイル(3 回連続の失敗で通知)'],
  ...config.targets.map((t) => [`target:${t.id}`, 'ededed', t.name]),
]);

const openIssues = gh(['issue', 'list', '--state', 'open', '--label', 'down', '--limit', '100', '--json', 'number,labels'], { json: true });
const openByTarget = new Map();
for (const issue of openIssues) {
  const label = issue.labels.map((l) => l.name).find((n) => n.startsWith('target:'));
  if (label) openByTarget.set(label.slice('target:'.length), issue.number);
}

for (const target of config.targets) {
  const result = run.results.find((r) => r.id === target.id);
  if (!result || result.skipped) continue;
  const open = openByTarget.get(target.id);

  if (result.ok && open) {
    gh(['issue', 'comment', String(open), '--body', `${jstTime(run.checkedAt)} に復旧を確認しました(応答 ${result.durationMs} ms)。`]);
    gh(['issue', 'close', String(open)]);
    console.log(`#${open} を閉じた: ${target.name}`);
    continue;
  }

  const threshold = ISSUE_THRESHOLD[target.severity];
  if (!result.ok && !open && result.consecutiveFailures >= threshold) {
    const body = [
      `**${target.name}** の確認に失敗しました。`,
      '',
      '| 項目 | 内容 |',
      '| --- | --- |',
      `| URL | ${target.url.includes('{') ? target.url.split('?')[0] : target.url} |`,
      `| 理由 | ${result.reason} |`,
      `| 応答コード | ${result.status ?? '-'} |`,
      `| 確認日時 | ${jstTime(run.checkedAt)}(日本時間) |`,
      `| 連続失敗 | ${result.consecutiveFailures} 回(各回 ${result.attempts} 回試行) |`,
      runUrl ? `| 実行ログ | ${runUrl} |` : null,
      '',
      '復旧を確認すると、この Issue は自動で閉じます。',
    ]
      .filter((line) => line !== null)
      .join('\n');
    gh([
      'issue', 'create',
      '--title', `[停止] ${target.name}`,
      '--body', body,
      '--label', 'down',
      '--label', `target:${target.id}`,
      '--label', `severity:${target.severity}`,
      '--assignee', owner,
    ]);
    console.log(`Issue を作成: ${target.name}`);
  }
}
