// 毎時の確認結果(check.yml の artifact)を日本時間の 1 日ごとに集計し、data/summary.json・reports/・README.md を更新する。
//   node scripts/daily.mjs
// まとめていない日が残っていれば(日次の実行が飛んだ日など)、artifact の保存期間内でさかのぼって集計する。
// あわせて、証明書の残り日数の確認と、毎時の確認のワークフローの再有効化(60 日で止まらないように)を行う。
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import tls from 'node:tls';
import { addDays, ensureLabels, gh, jstDay, jstDayStart, readJson, repo } from './lib.mjs';

const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const SUMMARY_PATH = join(ROOT, 'data', 'summary.json');
const RETENTION_DAYS = 7; // check.yml の artifact の保存期間
const EXPECTED_RUNS = 24;
const TLS_HOST = 'mnkm.page';
const TLS_WARN_DAYS = 10;

const config = readJson(join(ROOT, 'targets.json'));
const summary = existsSync(SUMMARY_PATH) ? readJson(SUMMARY_PATH) : [];

// まとめる日を決める。最初の 1 回は前日だけにする(監視を始める前の日を「確認 0 回」として残さないため)
const today = jstDay(new Date());
const yesterday = addDays(today, -1);
const oldest = addDays(today, -(RETENTION_DAYS - 1));
const lastDay = summary.at(-1)?.day;
let start = lastDay ? addDays(lastDay, 1) : yesterday;
if (start < oldest) start = oldest;
let days = [];
for (let d = start; d <= yesterday; d = addDays(d, 1)) days.push(d);
// 動作確認用: SUMMARY_DAYS=2026-10-14,2026-10-15 のように、集計する日を直接指定する(DRY_RUN と組み合わせて手元で使う)
if (process.env.SUMMARY_DAYS) days = process.env.SUMMARY_DAYS.split(',');

if (days.length === 0) {
  console.log('まとめる日がない');
} else {
  console.log(`まとめる日: ${days.join(', ')}`);

  // 対象の日に記録された結果を集める。実行が遅れて日付をまたぐことがあるので、
  // 振り分けは実行の開始時刻ではなく、check.mjs が記録した確認時刻で行う
  // 集めるのは定期実行と手動実行(workflow_dispatch)の結果だけにする。フォークからの pull request などで
  // 書き換えられた check.yml が動いた実行の artifact を、本物の確認結果として数えないため
  // (定期実行は既定のブランチの check.yml でしか動かず、手動実行には書き込み権限が要る)
  const since = new Date(jstDayStart(days[0]).getTime() - 3 * 3600_000);
  const runs = ['schedule', 'workflow_dispatch']
    .flatMap((event) =>
      gh(['run', 'list', '--workflow', 'check.yml', '--event', event, '--limit', '400', '--json', 'databaseId,createdAt'], { json: true })
    )
    .filter((r) => new Date(r.createdAt) >= since);
  const workDir = mkdtempSync(join(tmpdir(), 'site-monitor-'));
  const records = [];
  for (const r of runs) {
    const dir = join(workDir, String(r.databaseId));
    try {
      gh(['run', 'download', String(r.databaseId), '--dir', dir]);
    } catch {
      continue; // 失敗した実行など、artifact が無いもの
    }
    // artifact が 1 つでも複数でも読めるよう、展開先の result.json をすべて探す
    for (const file of readdirSync(dir, { recursive: true })) {
      if (String(file).endsWith('result.json')) records.push(JSON.parse(readFileSync(join(dir, String(file)), 'utf8')));
    }
  }
  console.log(`実行 ${runs.length} 件から結果 ${records.length} 件を読み込んだ`);

  // まだ一度もまとめていないときは、監視を始める前の日(結果が 1 件も無い日)を記録しない
  if (summary.length === 0) {
    while (days.length && !records.some((rec) => jstDay(rec.checkedAt) === days[0])) days.shift();
  }

  const tlsDaysLeft = await certificateDaysLeft(TLS_HOST);
  const latestDay = days.at(-1);

  for (const day of days) {
    const ofDay = records.filter((rec) => jstDay(rec.checkedAt) === day);
    const decided = ofDay.filter((rec) => !rec.inconclusive);
    const targets = {};
    for (const t of config.targets) {
      // 動作確認(simulate_down)で停止したことにした結果は、稼働率に含めない
      const results = decided.map((rec) => rec.results.find((x) => x.id === t.id)).filter((x) => x && !x.skipped && !x.simulated);
      const durations = results.filter((x) => x.ok).map((x) => x.durationMs);
      const failures = results.filter((x) => !x.ok).length;
      targets[t.id] = {
        checks: results.length,
        failures,
        availability: results.length ? Math.round(((results.length - failures) / results.length) * 10000) / 100 : null,
        avgMs: durations.length ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : null,
        maxMs: durations.length ? Math.max(...durations) : null,
      };
    }
    summary.push({
      day,
      runs: ofDay.length,
      inconclusive: ofDay.length - decided.length,
      // 証明書は今の状態しか確かめられないので、いちばん新しい日にだけ記録する
      tlsDaysLeft: day === latestDay ? tlsDaysLeft : null,
      targets,
    });
  }
  summary.sort((a, b) => a.day.localeCompare(b.day));

  if (days.length === 0) {
    console.log('結果のある日がまだ無い');
  } else {
  mkdirSync(join(ROOT, 'data'), { recursive: true });
  writeFileSync(SUMMARY_PATH, `${JSON.stringify(summary, null, 2)}\n`);
  for (const month of new Set(days.map((d) => d.slice(0, 7)))) writeMonthlyReport(month);
  writeReadme();
  syncTlsIssue(tlsDaysLeft);
  }
}

// 毎時の確認のワークフローを有効にし直す(60 日間動きが無いリポジトリで、定期実行が止まらないようにするための保険)
gh(['api', '-X', 'PUT', `repos/${repo()}/actions/workflows/check.yml/enable`]);

function certificateDaysLeft(host) {
  return new Promise((resolve, reject) => {
    const socket = tls.connect({ host, port: 443, servername: host, timeout: 30_000 }, () => {
      const validTo = new Date(socket.getPeerCertificate().valid_to);
      socket.end();
      resolve(Math.floor((validTo.getTime() - Date.now()) / 86400000));
    });
    socket.on('timeout', () => socket.destroy(new Error('TLS timeout')));
    socket.on('error', reject);
  });
}

function syncTlsIssue(daysLeft) {
  ensureLabels([['tls', '5319e7', '証明書の期限']]);
  const open = gh(['issue', 'list', '--state', 'open', '--label', 'tls', '--limit', '10', '--json', 'number'], { json: true })[0]?.number;
  if (daysLeft < TLS_WARN_DAYS && !open) {
    gh([
      'issue', 'create',
      '--title', `[証明書] ${TLS_HOST} の期限まで残り ${daysLeft} 日`,
      '--body', `${TLS_HOST} の証明書の期限まで、残り ${daysLeft} 日です。Cloudflare は通常、期限の約 30 日前に更新するので、更新がうまくいっていない可能性があります。Cloudflare のダッシュボード(SSL/TLS → Edge Certificates)を確認してください。\n\n残りが ${TLS_WARN_DAYS} 日以上に戻ると、この Issue は自動で閉じます。`,
      '--label', 'tls',
      '--assignee', repo().split('/')[0],
    ]);
  } else if (daysLeft >= TLS_WARN_DAYS && open) {
    gh(['issue', 'comment', String(open), '--body', `証明書が更新されました(期限まで残り ${daysLeft} 日)。`]);
    gh(['issue', 'close', String(open)]);
  }
}

function fmtPct(v) {
  return v === null ? '-' : `${v.toFixed(2)}%`;
}
function fmtMs(v) {
  return v === null ? '-' : `${v} ms`;
}

function totals(entries, id) {
  let checks = 0, failures = 0, weighted = 0, okCount = 0, maxMs = null;
  for (const e of entries) {
    const t = e.targets[id];
    if (!t) continue;
    checks += t.checks;
    failures += t.failures;
    const ok = t.checks - t.failures;
    if (t.avgMs !== null) { weighted += t.avgMs * ok; okCount += ok; }
    if (t.maxMs !== null) maxMs = Math.max(maxMs ?? 0, t.maxMs);
  }
  return {
    checks,
    failures,
    availability: checks ? Math.round(((checks - failures) / checks) * 10000) / 100 : null,
    avgMs: okCount ? Math.round(weighted / okCount) : null,
    maxMs,
  };
}

function targetTable(rows) {
  return [
    '| 対象 | 稼働率 | 確認 | 失敗 | 平均応答 | 最大応答 |',
    '| --- | ---: | ---: | ---: | ---: | ---: |',
    ...config.targets.map((t) => {
      const s = rows(t.id);
      return `| ${t.name} | ${fmtPct(s.availability)} | ${s.checks} | ${s.failures} | ${fmtMs(s.avgMs)} | ${fmtMs(s.maxMs)} |`;
    }),
  ];
}

function writeMonthlyReport(month) {
  const entries = summary.filter((e) => e.day.startsWith(month));
  const lines = [
    `# ${month} の稼働状況`,
    '',
    '日本時間で集計しています。応答時間は、成功した確認の値です。',
    '',
    '## 対象ごとの月間の集計',
    '',
    ...targetTable((id) => totals(entries, id)),
    '',
    '## 日ごとの記録',
    '',
    `「確認回数」は、その日に実行された毎時の確認の回数です(${EXPECTED_RUNS} 回が上限。GitHub Actions の都合で、実行が飛ぶことがあります)。「判定不能」は、監視する側の通信の不調で判定しなかった回数です。`,
    '',
    '| 日付 | 確認回数 | 判定不能 | 失敗 | 証明書の残り日数 |',
    '| --- | ---: | ---: | --- | ---: |',
    ...entries.map((e) => {
      const failed = config.targets
        .filter((t) => e.targets[t.id]?.failures)
        .map((t) => `${t.name} ${e.targets[t.id].failures} 回`)
        .join('、');
      return `| ${e.day} | ${e.runs} / ${EXPECTED_RUNS} | ${e.inconclusive} | ${failed || 'なし'} | ${e.tlsDaysLeft ?? '-'} |`;
    }),
    '',
  ];
  mkdirSync(join(ROOT, 'reports'), { recursive: true });
  writeFileSync(join(ROOT, 'reports', `${month}.md`), lines.join('\n'));
}

function writeReadme() {
  const path = join(ROOT, 'README.md');
  const latest = summary.at(-1);
  const section = [
    '<!-- status:start -->',
    `### ${latest.day} の稼働状況`,
    '',
    `確認回数 ${latest.runs} / ${EXPECTED_RUNS}(判定不能 ${latest.inconclusive})${latest.tlsDaysLeft !== null ? `、証明書の期限まで残り ${latest.tlsDaysLeft} 日` : ''}`,
    '',
    ...targetTable((id) => latest.targets[id] ?? totals([], id)),
    '',
    `月ごとの記録: [reports/](reports/)`,
    '<!-- status:end -->',
  ].join('\n');
  const readme = readFileSync(path, 'utf8');
  writeFileSync(path, readme.replace(/<!-- status:start -->[\s\S]*<!-- status:end -->/, section));
}
