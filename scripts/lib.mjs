// check.mjs・issues.mjs・daily.mjs で共通に使う処理
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

export const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));

// 何回連続で失敗したら Issue を作るか。core はサイト本体、secondary は外部データや補助的なファイル
export const ISSUE_THRESHOLD = { core: 1, secondary: 3 };

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

/** 日本時間の日付(YYYY-MM-DD) */
export const jstDay = (date) => new Date(new Date(date).getTime() + JST_OFFSET_MS).toISOString().slice(0, 10);

/** 日本時間の日時(YYYY-MM-DD HH:MM) */
export const jstTime = (date) =>
  new Date(new Date(date).getTime() + JST_OFFSET_MS).toISOString().slice(0, 16).replace('T', ' ');

/** 日本時間のその日の 0 時を UTC の Date で返す */
export const jstDayStart = (day) => new Date(new Date(`${day}T00:00:00Z`).getTime() - JST_OFFSET_MS);

export const addDays = (day, n) => new Date(new Date(`${day}T00:00:00Z`).getTime() + n * 86400000).toISOString().slice(0, 10);

/** gh CLI を呼ぶ。json: true なら結果を JSON として読む */
export function gh(args, { json = false, input } = {}) {
  if (process.env.DRY_RUN && !['list', 'view'].includes(args[1]) && args[0] !== 'run') {
    console.log(`[dry-run] gh ${args.join(' ')}`);
    return json ? [] : '';
  }
  const out = execFileSync('gh', args, { encoding: 'utf8', input, stdio: ['pipe', 'pipe', 'inherit'] });
  return json ? JSON.parse(out || 'null') : out;
}

export const repo = () => {
  const r = process.env.GITHUB_REPOSITORY;
  if (!r) throw new Error('GITHUB_REPOSITORY is not set');
  return r;
};

/** ラベルが無ければ作る(gh issue create は、存在しないラベルを指定すると失敗するため) */
export function ensureLabels(labels) {
  const existing = new Set(gh(['label', 'list', '--limit', '200', '--json', 'name'], { json: true }).map((l) => l.name));
  for (const [name, color, description] of labels) {
    if (!existing.has(name)) gh(['label', 'create', name, '--color', color, '--description', description]);
  }
}
