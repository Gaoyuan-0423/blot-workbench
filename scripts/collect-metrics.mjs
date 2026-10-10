import { mkdir, writeFile, appendFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const API = 'https://api.github.com';
const count = (value) => Number.isSafeInteger(value) && value >= 0 ? value : null;

export async function collectMetrics({ repo, token, fetchImpl = fetch, now = () => new Date() }) {
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]*\/[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(repo)) throw new Error('Expected repository in owner/name format.');
  const startedAt = now().toISOString();
  const errors = [];
  const requests = [];
  const prefix = `/repos/${repo}`;
  const headers = { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'blot-workbench-metrics' };
  if (token) headers.Authorization = `Bearer ${token}`;

  async function request(url) {
    if (new URL(url).origin !== API) throw new Error('Refusing an API pagination URL outside api.github.com.');
    const response = await fetchImpl(url, { headers, redirect: 'error', signal: AbortSignal.timeout(20_000) });
    requests.push({ url, status: response.status, observedAt: now().toISOString() });
    if (!response.ok) throw new Error(`GitHub API returned HTTP ${response.status} for ${new URL(url).pathname}.`);
    return { data: await response.json(), next: response.headers.get('link')?.match(/<([^>]+)>;\s*rel="next"/)?.[1] ?? null };
  }

  async function list(path) {
    let next = `${API}${path}${path.includes('?') ? '&' : '?'}per_page=100`;
    const seen = new Set();
    const items = new Map();
    while (next) {
      if (seen.has(next)) throw new Error('Repeated API pagination URL.');
      seen.add(next);
      const page = await request(next);
      if (!Array.isArray(page.data)) throw new Error(`Expected an array for ${path}.`);
      for (const item of page.data) {
        if (!Number.isSafeInteger(item?.id)) throw new Error(`Missing item ID in ${path}.`);
        items.set(item.id, item);
      }
      next = page.next;
    }
    return [...items.values()];
  }

  async function read(label, callback) {
    try { return await callback(); }
    catch (error) { errors.push({ scope: label, message: error.message }); return null; }
  }

  const [repository, issues, pulls, releases] = await Promise.all([
    read('repository', async () => (await request(`${API}${prefix}`)).data),
    read('issues', async () => {
      const items = (await list(`${prefix}/issues?state=all`)).filter((item) => !item.pull_request);
      if (items.some((item) => !['open', 'closed'].includes(item.state))) throw new Error('Unknown issue state.');
      return { total: items.length, open: items.filter((item) => item.state === 'open').length, closed: items.filter((item) => item.state === 'closed').length };
    }),
    read('pullRequests', async () => {
      const items = await list(`${prefix}/pulls?state=all`);
      if (items.some((item) => !['open', 'closed'].includes(item.state) || !Object.hasOwn(item, 'merged_at'))) throw new Error('Unknown pull request state or missing merge status.');
      return {
        total: items.length,
        open: items.filter((item) => item.state === 'open').length,
        closed: items.filter((item) => item.state === 'closed').length,
        closedUnmerged: items.filter((item) => item.state === 'closed' && item.merged_at === null).length,
        merged: items.filter((item) => item.merged_at !== null).length,
      };
    }),
    read('releases', async () => (await list(`${prefix}/releases`)).filter((item) => !item.draft)),
  ]);

  const releaseRecords = releases === null ? null : [];
  if (releases) {
    for (const release of releases) {
      const assets = await read(`releaseAssets:${release.id}`, async () => {
        const items = await list(`${prefix}/releases/${release.id}/assets`);
        return items.map((asset) => ({
          id: asset.id, name: asset.name, downloadCount: count(asset.download_count),
          source: asset.url ?? `${API}${prefix}/releases/assets/${asset.id}`,
          downloadUrl: asset.browser_download_url ?? null,
        }));
      });
      releaseRecords.push({
        id: release.id, tag: release.tag_name, prerelease: Boolean(release.prerelease),
        publishedAt: release.published_at ?? null, url: release.html_url ?? null,
        assets,
        assetDownloads: assets !== null && assets.every((asset) => asset.downloadCount !== null)
          ? assets.reduce((total, asset) => total + asset.downloadCount, 0) : null,
      });
    }
  }

  const stars = count(repository?.stargazers_count);
  const forks = count(repository?.forks_count);
  const totalDownloads = releaseRecords !== null && releaseRecords.every((release) => release.assetDownloads !== null)
    ? releaseRecords.reduce((total, release) => total + release.assetDownloads, 0) : null;
  const complete = errors.length === 0 && [stars, forks, issues, pulls, totalDownloads].every((value) => value !== null);
  return {
    schemaVersion: 1,
    repository: repo,
    repositoryUrl: `https://github.com/${repo}`,
    collectionStartedAt: startedAt,
    collectionFinishedAt: now().toISOString(),
    status: complete ? 'complete' : 'partial',
    counts: { stars, forks, issues, pullRequests: pulls, publishedReleases: releaseRecords?.length ?? null, releaseAssetDownloads: totalDownloads },
    releases: releaseRecords,
    methodology: {
      source: 'GitHub REST API; every collection endpoint is paginated.',
      issues: 'Excludes pull requests returned by the issues endpoint.',
      pullRequests: 'Closed includes merged. Open, closedUnmerged, and merged are disjoint categories; do not add closed and merged.',
      downloads: 'Sum of download_count for assets on currently published releases, including prereleases. Excludes source archive downloads, deleted releases/assets, and GitHub Pages visits. Not unique users.',
      unknownValues: 'null means unavailable or incomplete; it never means zero.',
      interpretation: 'Popularity and repository activity are not evidence of scientific correctness, validation, adoption, or publication readiness.',
      privacy: 'No application analytics, image data, project data, or individual user identities are collected.',
      timing: 'API reads are a time-bounded snapshot, not an atomic transaction; counts may change during collection.',
    },
    requests,
    errors,
  };
}

async function main() {
  const args = process.argv.slice(2);
  const values = {};
  for (let i = 0; i < args.length; i += 2) {
    if (!['--repo', '--output-dir'].includes(args[i]) || !args[i + 1]) throw new Error('Usage: node scripts/collect-metrics.mjs --repo owner/name [--output-dir directory]');
    values[args[i]] = args[i + 1];
  }
  const repo = values['--repo'] ?? process.env.GITHUB_REPOSITORY;
  if (!repo) throw new Error('No repository selected. Pass --repo owner/name explicitly; no metrics have been collected.');
  const snapshot = await collectMetrics({ repo, token: process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN });
  snapshot.trigger = process.env.GITHUB_EVENT_NAME ?? 'local-manual';
  snapshot.workflowRun = process.env.GITHUB_RUN_ID ? { id: process.env.GITHUB_RUN_ID, attempt: process.env.GITHUB_RUN_ATTEMPT ?? '1' } : null;
  const directory = resolve(values['--output-dir'] ?? '.release/metrics');
  await mkdir(directory, { recursive: true });
  const suffix = process.env.GITHUB_RUN_ID ? `-${process.env.GITHUB_RUN_ID}-${process.env.GITHUB_RUN_ATTEMPT ?? '1'}` : '';
  const filename = `${snapshot.collectionStartedAt.replaceAll(':', '-').replaceAll('.', '-')}${suffix}.json`;
  await writeFile(resolve(directory, filename), `${JSON.stringify(snapshot, null, 2)}\n`, { flag: 'wx' });
  console.log(`Saved ${snapshot.status} snapshot: ${filename}`);
  if (snapshot.status !== 'complete') console.warn('Some metrics are unavailable. Inspect null values and errors; they are not zero.');
  if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, `## Repository metrics\n\nSaved a **${snapshot.status}** snapshot at ${snapshot.collectionFinishedAt}.\n\nCounts describe repository activity, not scientific validation or unique users. Unknown values remain null.\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
