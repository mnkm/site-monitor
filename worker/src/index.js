// Cloudflare Workers の Cron Triggers から、毎時の確認(check.yml)を手動実行(workflow_dispatch)として起動する。
// GitHub Actions の定期実行(schedule)は混むと飛ばされるため、こちらを主にし、定期実行は予備にする。
// 起動に失敗したときは例外で終え、Cloudflare のダッシュボードの Cron Events に失敗として残す。

const MAX_ATTEMPTS = 3;

export default {
  async scheduled(controller, env) {
    await dispatch(env);
  },
};

async function dispatch(env) {
  const url = `https://api.github.com/repos/${env.REPO}/actions/workflows/${env.WORKFLOW}/dispatches`;
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${env.GITHUB_TOKEN}`,
        'Content-Type': 'application/json',
        'User-Agent': 'site-monitor-trigger', // GitHub API は User-Agent の無いリクエストを拒む
        'X-GitHub-Api-Version': '2022-11-28',
      },
      body: JSON.stringify({ ref: env.REF }),
    });
    if (res.ok) {
      console.log(`${env.WORKFLOW} を起動した(${attempt} 回目)`);
      return;
    }
    const body = await res.text();
    // トークンの期限切れや権限不足(401・403・404 など)は、やり直しても直らない
    const retryable = res.status >= 500 || res.status === 429;
    if (!retryable || attempt >= MAX_ATTEMPTS) {
      throw new Error(`${env.WORKFLOW} を起動できなかった: ${res.status} ${body}`);
    }
    console.log(`起動に失敗したのでやり直す: ${res.status}`);
    await new Promise((resolve) => setTimeout(resolve, attempt * 10_000));
  }
}
