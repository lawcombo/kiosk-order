import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHistoryHandler } from '../history-api/worker.mjs';

const origin = 'https://lawcombo.github.io';
const env = { GITHUB_TOKEN: 'github_pat_TestTokenNotARealSecret', ALLOWED_ORIGINS: origin };
const validState = () => ({ type: 'equipment', model: 1, qty: 1, van: 'NICE', priceDisclosure: 'Y', options: { ptz: { qty: 2, on: true } }, info: { site: '동해 숙박 <시험>', date: '2026-10-23', install: '2026-11-01', installTime: '14:30', notes: '안내 사항\n둘째 줄' }, overrides: { g26: { price: 132000, pn: 'KI00672', name: 'PTZ 카메라', spec: '당시 사양' } } });

export function mockGithub() {
  const files = new Map(), calls = [];
  let failure = null, sequence = 0, revision = 0, conflictHook = null;
  const fetch = async (url, init) => {
    calls.push({ url, init });
    assert.equal(new URL(url).hostname, 'api.github.com');
    assert.equal(init.redirect, 'manual', 'Workers only supports follow/manual redirect modes');
    assert.equal(init.headers.Authorization, `Bearer ${env.GITHUB_TOKEN}`);
    if (failure && (!failure.method || failure.method === (init.method || 'GET'))) { const status = failure.status; failure = null; return Response.json({ message: 'Do not leak upstream error or tokens' }, { status }); }
    const path = new URL(url).pathname.split('/contents/')[1];
    assert.equal(path, 'history.json');
    if (init.method === 'PUT') {
      const body = JSON.parse(init.body);
      assert.equal(body.branch, 'main');
      if (conflictHook) { const hook = conflictHook; conflictHook = null; await hook(); }
      if (files.has(path) ? body.sha !== `sha-${revision}` : !!body.sha) return Response.json({}, { status: files.has(path) ? 409 : 422 });
      files.set(path, Buffer.from(body.content, 'base64').toString('utf8'));
      revision++;
      return Response.json({ commit: { sha: 'test-commit' } }, { status: 201 });
    }
    if (!files.has(path)) return Response.json({}, { status: 404 });
    const content = files.get(path);
    return Response.json({ content: Buffer.from(content).toString('base64'), encoding: 'base64', size: Buffer.byteLength(content), sha: `sha-${revision}` });
  };
  const handler = createHistoryHandler({ fetch, now: () => new Date(Date.UTC(2026, 9, 23, 1, 2, sequence, 4)), uuid: () => `00000000-0000-4000-8000-${String(++sequence).padStart(12, '0')}` });
  const request = (path = '', method = 'GET', data, config = env, headers = {}) => handler(new Request(`https://history.example/api/history${path}`, { method, headers: { Origin: origin, ...(data === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers }, ...(data === undefined ? {} : { body: JSON.stringify(data) }) }), config);
  return { files, calls, request, fail(status, method) { failure = { status, method }; }, onNextWrite(hook) { conflictHook = hook; } };
}

test('empty repository lists no history; missing secret never fakes a save', async () => {
  const mock = mockGithub();
  assert.deepEqual(await (await mock.request()).json(), { items: [], nextCursor: null });
  const response = await mock.request('', 'POST', { schemaVersion: 1, state: validState() }, { ALLOWED_ORIGINS: origin });
  assert.equal(response.status, 503);
  assert.equal(mock.files.size, 0);
});

test('save creates one Unicode JSON snapshot and reloads exact historical values', async () => {
  const mock = mockGithub(), state = validState();
  const response = await mock.request('', 'POST', { schemaVersion: 1, state, path: '../index.html', repo: 'another/repo' });
  assert.equal(response.status, 201);
  const result = await response.json();
  assert.equal(result.site, state.info.site);
  assert.equal(result.savedAt, '2026-10-23T01:02:00.004Z');
  assert.equal(mock.files.size, 1);
  assert.equal([...mock.files.keys()][0], 'history.json');
  assert.equal(JSON.parse(mock.files.get('history.json')).entries.length, 1);
  assert.ok(Buffer.byteLength(result.id) < 255);
  const record = await (await mock.request('/' + result.id)).json();
  assert.deepEqual(record.state.info.notes, state.info.notes);
  assert.equal(record.state.info.installTime, '14:30');
  assert.deepEqual(record.state.overrides, state.overrides);
  assert.deepEqual(record.state.options, state.options);
  assert.ok(!JSON.stringify(record).includes(env.GITHUB_TOKEN));
  const list = await (await mock.request()).json();
  assert.equal(list.items[0].id, result.id);
});

test('saves append to a single file; listing is newest-first and paginated', async () => {
  const mock = mockGithub();
  for (let i = 0; i < 25; i++) assert.equal((await mock.request('', 'POST', { schemaVersion: 1, state: validState() })).status, 201);
  mock.files.set('index.html', '<html>unchanged</html>');
  const first = await (await mock.request()).json();
  const second = await (await mock.request('?before=' + encodeURIComponent(first.nextCursor))).json();
  assert.equal(first.items.length, 20);
  assert.equal(second.items.length, 5);
  assert.equal(second.nextCursor, null);
  assert.equal(new Set([...first.items, ...second.items].map(item => item.id)).size, 25);
  assert.ok(first.items[0].savedAt > second.items[0].savedAt);
  assert.equal(mock.files.get('index.html'), '<html>unchanged</html>');
  assert.equal(JSON.parse(mock.files.get('history.json')).entries.length, 25);
  assert.equal(mock.files.size, 2);
});

test('unapproved origins, traversal, invalid payloads and methods cannot write', async () => {
  const mock = mockGithub(), payload = { schemaVersion: 1, state: validState() };
  assert.equal((await mock.request('', 'POST', payload, env, { Origin: 'https://other.example' })).status, 403);
  assert.equal((await mock.request('', 'POST', payload, env, { Origin: '' })).status, 403);
  assert.equal((await mock.request('', 'DELETE')).status, 405);
  assert.equal((await mock.request('/invalid.json')).status, 400);
  assert.equal((await mock.request('?before=invalid')).status, 400);
  assert.equal((await mock.request('', 'POST', { schemaVersion: 2, state: validState() })).status, 400);
  const badQuantity = validState(); badQuantity.options.ptz.qty = -1;
  assert.equal((await mock.request('', 'POST', { schemaVersion: 1, state: badQuantity })).status, 400);
  const badPrice = validState(); badPrice.overrides.g26.price = 'free';
  assert.equal((await mock.request('', 'POST', { schemaVersion: 1, state: badPrice })).status, 400);
  const huge = validState(); huge.info.notes = 'x'.repeat(129 * 1024);
  assert.equal((await mock.request('', 'POST', { schemaVersion: 1, state: huge })).status, 413);
  assert.equal((await mock.request('', 'POST', payload, env, { 'Content-Type': 'text/plain' })).status, 415);
  assert.equal(mock.files.size, 0);
});

test('CORS preflight is scoped to configured origins; error responses hide secrets', async () => {
  const mock = mockGithub();
  const preflight = await mock.request('', 'OPTIONS');
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get('Access-Control-Allow-Origin'), origin);
  assert.equal((await mock.request('', 'OPTIONS', undefined, env, { Origin: 'https://other.example' })).status, 403);
  mock.fail(403);
  const denied = await mock.request();
  assert.equal(denied.status, 503);
  assert.ok(!(await denied.text()).includes('Do not leak'));
  mock.fail(422, 'PUT');
  assert.equal((await mock.request('', 'POST', { schemaVersion: 1, state: validState() })).status, 201);
});

test('corrupted history is not applied and request data is never executed', async () => {
  const mock = mockGithub();
  const saved = await (await mock.request('', 'POST', { schemaVersion: 1, state: validState() })).json();
  mock.files.set('history.json', 'not JSON');
  assert.equal((await mock.request('/' + saved.id)).status, 502);
  assert.equal((await mock.request('', 'POST', { schemaVersion: 1, state: validState() })).status, 502);
  assert.equal(mock.files.get('history.json'), 'not JSON');
});

test('VAN to be supplied later is retained in stored and loaded history', async () => {
  const mock = mockGithub(), state = { ...validState(), type: 'general', van: 'PENDING' };
  const response = await mock.request('', 'POST', { schemaVersion: 1, state });
  assert.equal(response.status, 201);
  const saved = await response.json();
  const record = await (await mock.request('/' + saved.id)).json();
  assert.equal(record.state.van, 'PENDING');
});

test('simultaneous first saves and updates retry SHA conflicts without losing either entry', async () => {
  for (const existing of [false, true]) {
    const mock = mockGithub();
    if (existing) await mock.request('', 'POST', { schemaVersion: 1, state: validState() });
    mock.onNextWrite(async () => {
      const other = validState(); other.info.site = '다른 사용자';
      assert.equal((await mock.request('', 'POST', { schemaVersion: 1, state: other })).status, 201);
    });
    const first = validState(); first.info.site = '첫 사용자';
    assert.equal((await mock.request('', 'POST', { schemaVersion: 1, state: first })).status, 201);
    const records = JSON.parse(mock.files.get('history.json')).entries;
    assert.equal(records.length, existing ? 3 : 2);
    assert.ok(records.some(record => record.state.info.site === '다른 사용자'));
    assert.ok(records.some(record => record.state.info.site === '첫 사용자'));
  }
});

test('missing detail returns 404; capacity errors keep all previous history intact', async () => {
  const mock = mockGithub();
  assert.equal((await mock.request('/20261023T010200004Z_00000000-0000-4000-8000-000000000001')).status, 404);
  await mock.request('', 'POST', { schemaVersion: 1, state: validState() });
  const store = JSON.parse(mock.files.get('history.json'));
  store.padding = 'x'.repeat(900 * 1024 - Buffer.byteLength(JSON.stringify(store)) - 20);
  const previous = JSON.stringify(store);
  mock.files.set('history.json', previous);
  assert.equal((await mock.request('', 'POST', { schemaVersion: 1, state: validState() })).status, 413);
  assert.equal(mock.files.get('history.json'), previous);
});

test('dashboard defaults only need the GitHub secret configured', async () => {
  const mock = mockGithub();
  assert.equal((await mock.request('', 'POST', { schemaVersion: 1, state: validState() }, { GITHUB_TOKEN: env.GITHUB_TOKEN })).status, 201);
});

test('default outbound fetch preserves the runtime receiver', async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = function () {
      assert.equal(this, globalThis);
      return Promise.resolve(Response.json({}, { status: 404 }));
    };
    const handler = createHistoryHandler();
    const response = await handler(new Request('https://history.example/api/history'), env);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { items: [], nextCursor: null });
  } finally { globalThis.fetch = original; }
});

test('secret boundary whitespace is trimmed; invalid contents are rejected before any request', async () => {
  const mock = mockGithub();
  assert.equal((await mock.request('', 'POST', { schemaVersion: 1, state: validState() }, { ...env, GITHUB_TOKEN: '\n ' + env.GITHUB_TOKEN + ' \r\n' })).status, 201);
  const before = mock.calls.length;
  const response = await mock.request('', 'GET', undefined, { ...env, GITHUB_TOKEN: 'Bearer ' + env.GITHUB_TOKEN });
  assert.equal(response.status, 503);
  assert.equal(mock.calls.length, before);
  assert.ok(!(await response.text()).includes(env.GITHUB_TOKEN));
});

test('runtime errors expose only a safe category, never an exception containing a token', async () => {
  const original = console.error, logs = [];
  console.error = (...args) => logs.push(args);
  try {
    for (const [error, code] of [[new TypeError('Illegal invocation ' + env.GITHUB_TOKEN), 'CALL_CONTEXT'], [new Error(env.GITHUB_TOKEN), 'NETWORK'], [new SyntaxError(env.GITHUB_TOKEN), 'INVALID_RESPONSE'], [new DOMException(env.GITHUB_TOKEN, 'AbortError'), 'TIMEOUT']]) {
      const handler = createHistoryHandler({ fetch: async () => { throw error; } });
      const response = await handler(new Request('https://history.example/api/history'), env);
      assert.equal(response.status, 502);
      const body = await response.text();
      assert.ok(body.includes(code));
      assert.ok(!body.includes(env.GITHUB_TOKEN));
    }
    assert.ok(!JSON.stringify(logs).includes(env.GITHUB_TOKEN));
  } finally { console.error = original; }
});

test('GitHub redirects are rejected without forwarding the token to another host', async () => {
  let calls = 0;
  const handler = createHistoryHandler({ fetch: async (url, init) => {
    calls++;
    assert.equal(new URL(url).hostname, 'api.github.com');
    assert.equal(init.redirect, 'manual');
    return new Response(null, { status: 302, headers: { Location: 'https://other.example' } });
  } });
  const response = await handler(new Request('https://history.example/api/history'), env);
  assert.equal(response.status, 502);
  assert.equal(calls, 1);
});
