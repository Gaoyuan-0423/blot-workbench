import test from 'node:test';
import assert from 'node:assert/strict';
import { collectMetrics } from './collect-metrics.mjs';

const root = 'https://api.github.com/repos/example/blot';
function fetchFixture(overrides = {}) {
  const responses = {
    [root]: { data: { stargazers_count: 2, forks_count: 1 } },
    [`${root}/issues?state=all&per_page=100`]: { data: [{ id: 1, state: 'open' }, { id: 2, state: 'closed', pull_request: {} }], next: `${root}/issues?state=all&per_page=100&page=2` },
    [`${root}/issues?state=all&per_page=100&page=2`]: { data: [{ id: 3, state: 'closed' }] },
    [`${root}/pulls?state=all&per_page=100`]: { data: [{ id: 2, state: 'closed', merged_at: '2026-01-01' }, { id: 4, state: 'closed', merged_at: null }, { id: 5, state: 'open', merged_at: null }] },
    [`${root}/releases?per_page=100`]: { data: [{ id: 10, tag_name: 'v0.1.0-alpha.1', prerelease: true, draft: false }] },
    [`${root}/releases/10/assets?per_page=100`]: { data: [{ id: 20, name: 'app.zip', download_count: 3 }], next: `${root}/releases/10/assets?per_page=100&page=2` },
    [`${root}/releases/10/assets?per_page=100&page=2`]: { data: [{ id: 21, name: 'SHA256SUMS', download_count: 0 }] },
    ...overrides,
  };
  return async (url) => {
    assert.ok(Object.hasOwn(responses, url), `Unexpected API request ${url}`);
    const response = responses[url];
    return new Response(JSON.stringify(response.data), { status: response.status ?? 200, headers: response.next ? { link: `<${response.next}>; rel="next"` } : {} });
  };
}

test('paginates issues and assets and does not count pull requests as issues', async () => {
  const snapshot = await collectMetrics({ repo: 'example/blot', fetchImpl: fetchFixture() });
  assert.equal(snapshot.status, 'complete');
  assert.deepEqual(snapshot.counts.issues, { total: 2, open: 1, closed: 1 });
  assert.deepEqual(snapshot.counts.pullRequests, { total: 3, open: 1, closed: 2, closedUnmerged: 1, merged: 1 });
  assert.equal(snapshot.counts.releaseAssetDownloads, 3);
  assert.equal(snapshot.releases[0].assets[1].downloadCount, 0);
});

test('an API failure on a later page makes the aggregate unknown, not a partial count or zero', async () => {
  const snapshot = await collectMetrics({ repo: 'example/blot', fetchImpl: fetchFixture({ [`${root}/issues?state=all&per_page=100&page=2`]: { status: 403, data: {} }, [`${root}/releases/10/assets?per_page=100&page=2`]: { status: 503, data: {} } }) });
  assert.equal(snapshot.status, 'partial');
  assert.equal(snapshot.counts.issues, null);
  assert.equal(snapshot.counts.releaseAssetDownloads, null);
  assert.equal(snapshot.releases[0].assets, null);
  assert.equal(snapshot.counts.stars, 2);
  assert.equal(snapshot.errors.length, 2);
});

test('verified empty API lists are zero and draft releases are excluded', async () => {
  const snapshot = await collectMetrics({ repo: 'example/blot', fetchImpl: fetchFixture({ [`${root}/releases?per_page=100`]: { data: [{ id: 99, draft: true }] }, [`${root}/issues?state=all&per_page=100`]: { data: [] }, [`${root}/pulls?state=all&per_page=100`]: { data: [] } }) });
  assert.equal(snapshot.counts.publishedReleases, 0);
  assert.equal(snapshot.counts.releaseAssetDownloads, 0);
  assert.deepEqual(snapshot.counts.issues, { total: 0, open: 0, closed: 0 });
  assert.equal(snapshot.status, 'complete');
});

test('never follows an external pagination link with the API token', async () => {
  const snapshot = await collectMetrics({ repo: 'example/blot', token: 'test-token', fetchImpl: fetchFixture({ [`${root}/issues?state=all&per_page=100`]: { data: [], next: 'https://untrusted.example/next' } }) });
  assert.equal(snapshot.counts.issues, null);
  assert.equal(snapshot.status, 'partial');
  assert.match(snapshot.errors[0].message, /outside api.github.com/);
});

test('an absent or inaccessible repository produces unknown metrics, not invented releases or zero popularity', async () => {
  const snapshot = await collectMetrics({ repo: 'example/not-published', fetchImpl: async (_url, options) => {
    assert.equal(options.redirect, 'error');
    return new Response('{}', { status: 404 });
  } });
  assert.equal(snapshot.status, 'partial');
  assert.equal(snapshot.releases, null);
  assert.ok(Object.values(snapshot.counts).every((value) => value === null));
  assert.equal(snapshot.errors.length, 4);
});

test('an explicit valid repository is required before any network request', async () => {
  let called = false;
  const fetchImpl = async () => { called = true; throw new Error('Network should not be called.'); };
  await assert.rejects(collectMetrics({ fetchImpl }), /Expected repository/);
  await assert.rejects(collectMetrics({ repo: '../not-a-repository', fetchImpl }), /Expected repository/);
  assert.equal(called, false);
});
