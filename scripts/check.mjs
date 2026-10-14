// 各サイトに 1 回ずつアクセスして結果を JSON に書き出す。
//   node scripts/check.mjs <出力先> [前回の結果]
// サイトが止まっていても終了コードは 0(停止の通知は issues.mjs が Issue で行う)。
// 終了コードが 0 以外になるのは、この監視の仕組み自体が壊れたときだけ。
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { readJson } from './lib.mjs';

const [outPath, prevPath] = process.argv.slice(2);
if (!outPath) throw new Error('usage: node scripts/check.mjs <out.json> [prev.json]');

const config = readJson(new URL('../targets.json', import.meta.url));
const prev = prevPath && existsSync(prevPath) ? readJson(prevPath) : null;
const prevById = new Map((prev?.results ?? []).map((r) => [r.id, r]));

const USER_AGENT = `site-monitor (+https://github.com/${process.env.GITHUB_REPOSITORY ?? 'mnkm/site-monitor'})`;
// Cloudflare のボット対策を、この監視のアクセスだけ通すための目印(リポジトリの Secret に置き、mnkm.page にだけ送る)
const MONITOR_TOKEN = process.env.MONITOR_TOKEN || '';
const headersFor = (url) => ({
  'User-Agent': USER_AGENT,
  ...(MONITOR_TOKEN && new URL(url).hostname === 'mnkm.page' ? { 'X-Site-Monitor': MONITOR_TOKEN } : {}),
});
const RETRY_WAITS_MS = [10_000, 30_000]; // 失敗したら 10 秒後と 30 秒後にやり直す
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function resolveUrl(target, now) {
  if (!target.window) return target.url;
  const day = 86400000;
  const from = new Date(now - target.window.pastDays * day).toISOString();
  const to = new Date(now + target.window.futureDays * day).toISOString();
  return target.url.replace('{from}', encodeURIComponent(from)).replace('{to}', encodeURIComponent(to));
}

/** 応答の中身を確かめる。問題があれば理由を返す */
async function inspect(target, url, res, body) {
  const expect = target.expect ?? {};
  for (const text of expect.contains ?? []) {
    if (!body.includes(text)) return `本文に「${text}」がない`;
  }
  if (expect.startsWith && !body.startsWith(expect.startsWith)) return `本文が「${expect.startsWith}」で始まらない`;
  if (expect.minCount) {
    const count = body.split(expect.minCount.text).length - 1;
    if (count < expect.minCount.min) return `「${expect.minCount.text}」が ${count} 件(${expect.minCount.min} 件以上のはず)`;
  }
  if (expect.json) {
    let data;
    try {
      data = JSON.parse(body);
    } catch {
      return 'JSON として読めない';
    }
    for (const key of expect.json.forbidKeys ?? []) {
      if (data && typeof data === 'object' && key in data) return `JSON にエラー(${key})が含まれている`;
    }
    const value = expect.json.path ? data?.[expect.json.path] : data;
    if (expect.json.nonEmptyArray && !(Array.isArray(value) && value.length > 0)) {
      return `JSON の${expect.json.path ? ` ${expect.json.path} ` : ''}配列が空`;
    }
  }
  if (expect.scriptAsset) {
    // 画面は JavaScript が描くので、HTML が返るだけでは壊れたデプロイを見分けられない。読み込むスクリプトも確かめる
    const src = body.match(/<script[^>]+src="([^"]*assets\/[^"]+\.js)"/)?.[1];
    if (!src) return 'スクリプトの読み込みが見つからない';
    const assetUrl = new URL(src, url).href;
    const asset = await fetch(assetUrl, { redirect: 'manual', headers: headersFor(assetUrl), signal: AbortSignal.timeout(30_000) });
    await asset.arrayBuffer();
    if (asset.status !== 200) return `スクリプト(${new URL(assetUrl).pathname})が ${asset.status}`;
  }
  return null;
}

/** 1 回アクセスする */
async function attempt(target, now) {
  const url = resolveUrl(target, now);
  const started = Date.now();
  try {
    const res = await fetch(url, {
      redirect: target.redirect ?? 'manual',
      headers: headersFor(url),
      signal: AbortSignal.timeout((target.timeoutSec ?? 30) * 1000),
    });
    const body = await res.text();
    const durationMs = Date.now() - started;
    if (res.status !== 200) {
      // Cloudflare のボット対策で止められた場合は、サイトの停止と区別できるようにする
      const challenged = res.headers.get('cf-mitigated') === 'challenge';
      const where = res.status >= 300 && res.status < 400 ? `(転送先: ${res.headers.get('location') ?? '不明'})` : '';
      return { ok: false, status: res.status, durationMs, reason: challenged ? 'Cloudflare のボット対策で止められた' : `応答が ${res.status}${where}` };
    }
    const problem = await inspect(target, url, res, body);
    return { ok: !problem, status: res.status, durationMs, reason: problem };
  } catch (error) {
    const timedOut = error?.name === 'TimeoutError';
    return {
      ok: false,
      status: null,
      durationMs: Date.now() - started,
      reason: timedOut ? `${target.timeoutSec ?? 30} 秒以内に応答がない` : `接続できない(${error?.cause?.code ?? error?.message ?? 'unknown'})`,
    };
  }
}

/** 失敗したらやり直したうえで、最終的な結果を返す */
async function check(target) {
  if (process.env.SIMULATE_DOWN === target.id) {
    return { ok: false, status: null, durationMs: null, reason: '動作確認のための模擬的な停止', attempts: 1 };
  }
  let result;
  for (let i = 0; i <= RETRY_WAITS_MS.length; i++) {
    if (i > 0) await sleep(RETRY_WAITS_MS[i - 1]);
    result = { ...(await attempt(target, Date.now())), attempts: i + 1 };
    if (result.ok) break;
  }
  return result;
}

const checkedAt = new Date().toISOString();

// 監視する側(GitHub の実行環境)の通信が不調なだけで、すべてのサイトを停止と判断しないよう、先に対照の URL を確かめる
const control = await check({ ...config.control, id: 'control' });
const inconclusive = !control.ok;

let results;
if (inconclusive) {
  // 判定できなかった回は、連続失敗の回数を前回のまま引き継ぐ
  results = config.targets.map((t) => ({ id: t.id, skipped: true, consecutiveFailures: prevById.get(t.id)?.consecutiveFailures ?? 0 }));
} else {
  results = await Promise.all(
    config.targets.map(async (t) => {
      const r = await check(t);
      const consecutiveFailures = r.ok ? 0 : (prevById.get(t.id)?.consecutiveFailures ?? 0) + 1;
      return { id: t.id, ...r, consecutiveFailures };
    })
  );
}

const output = { checkedAt, inconclusive, control, results };
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, `${JSON.stringify(output, null, 2)}\n`);

if (inconclusive) console.log(`::warning::対照の URL にもアクセスできなかったため、この回は判定しない(${control.reason})`);
for (const r of results) {
  const name = config.targets.find((t) => t.id === r.id).name;
  if (r.skipped) continue;
  console.log(`${r.ok ? 'OK  ' : 'DOWN'} ${name}: ${r.ok ? `${r.durationMs} ms` : r.reason}(${r.attempts} 回目, 連続失敗 ${r.consecutiveFailures})`);
}
