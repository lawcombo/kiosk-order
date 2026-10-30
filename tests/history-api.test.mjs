import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHistoryHandler } from '../history-api/worker.mjs';

const origin = 'https://lawcombo.github.io';
const env = { GITHUB_TOKEN: 'github_pat_TestTokenNotARealSecret', ALLOWED_ORIGINS: origin };
const emptyList = { items: [], page: 1, pageSize: 10, total: 0, totalPages: 1, canDelete: true, nextCursor: null };
const defaultCatalog = () => JSON.parse(readFileSync(new URL('../index.html', import.meta.url), 'utf8').match(/id="catalogData">([\s\S]*?)<\/script>/)[1]);
const validState = () => ({ type: 'equipment', model: 1, qty: 1, van: 'NICE', priceDisclosure: 'Y', options: { ptz: { qty: 2, on: true } }, info: { site: '동해 숙박 <시험>', date: '2026-10-23', install: '2026-11-01', installTime: '14:30', notes: '안내 사항\n둘째 줄' }, infoEmphasis: { site: true, notes: true }, excludedParts: { 'general|1|NICE': ['g8', 'c28'] }, overrides: { g26: { price: 132000, pn: 'KI00672', name: 'PTZ 카메라', spec: '당시 사양' } } });

export function mockGithub() {
  const files = new Map(), calls = [], revisions = new Map();
  let failure = null, sequence = 0, revision = 0, conflictHook = null;
  const fetch = async (url, init) => {
    calls.push({ url, init });
    assert.equal(new URL(url).hostname, 'api.github.com');
    assert.equal(init.redirect, 'manual', 'Workers only supports follow/manual redirect modes');
    assert.equal(init.headers.Authorization, `Bearer ${env.GITHUB_TOKEN}`);
    if (failure && (!failure.method || failure.method === (init.method || 'GET'))) { const status = failure.status; failure = null; return Response.json({ message: 'Do not leak upstream error or tokens' }, { status }); }
    const path = new URL(url).pathname.split('/contents/')[1];
    assert.ok(['history.json', 'parts.json'].includes(path));
    if (init.method === 'PUT') {
      const body = JSON.parse(init.body);
      assert.equal(body.branch, 'main');
      if (conflictHook) { const hook = conflictHook; conflictHook = null; await hook(); }
      if (files.has(path) ? body.sha !== (revisions.get(path) || 'sha-0') : !!body.sha) return Response.json({}, { status: files.has(path) ? 409 : 422 });
      files.set(path, Buffer.from(body.content, 'base64').toString('utf8'));
      revision++;
      revisions.set(path, `sha-${revision}`);
      return Response.json({ commit: { sha: 'test-commit' }, content: { sha: `sha-${revision}` } }, { status: 201 });
    }
    if (!files.has(path)) return Response.json({}, { status: 404 });
    const content = files.get(path);
    return Response.json({ content: Buffer.from(content).toString('base64'), encoding: 'base64', size: Buffer.byteLength(content), sha: revisions.get(path) || 'sha-0' });
  };
  const handler = createHistoryHandler({ fetch, now: () => new Date(Date.UTC(2026, 9, 23, 1, 2, sequence, 4)), uuid: () => `00000000-0000-4000-8000-${String(++sequence).padStart(12, '0')}` });
  const request = (path = '', method = 'GET', data, config = env, headers = {}) => handler(new Request(`https://history.example/api/history${path}`, { method, headers: { Origin: origin, ...(data === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers }, ...(data === undefined ? {} : { body: JSON.stringify(data) }) }), config);
  const catalogRequest = (method = 'GET', data, config = env, headers = {}) => handler(new Request('https://history.example/api/catalog', { method, headers: { Origin: origin, ...(data === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers }, ...(data === undefined ? {} : { body: JSON.stringify(data) }) }), config);
  return { files, calls, request, catalogRequest, fail(status, method) { failure = { status, method }; }, onNextWrite(hook) { conflictHook = hook; } };
}

test('empty repository lists no history; missing secret never fakes a save', async () => {
  const mock = mockGithub();
  assert.deepEqual(await (await mock.request()).json(), emptyList);
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
  assert.deepEqual(record.state.infoEmphasis, state.infoEmphasis);
  assert.deepEqual(record.state.excludedParts, state.excludedParts);
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
  const second = await (await mock.request('?page=2')).json();
  const third = await (await mock.request('?page=3')).json();
  assert.equal(first.items.length, 10);
  assert.equal(second.items.length, 10);
  assert.equal(third.items.length, 5);
  assert.equal(third.nextCursor, null);
  assert.equal(first.total, 25);
  assert.equal(first.totalPages, 3);
  assert.equal(second.page, 2);
  assert.deepEqual((await (await mock.request('?page=99')).json()).items, third.items);
  assert.deepEqual((await (await mock.request('?before=' + encodeURIComponent(first.nextCursor))).json()).items, second.items);
  assert.equal(new Set([...first.items, ...second.items, ...third.items].map(item => item.id)).size, 25);
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
  for (const value of ['0', '-1', '1.5', 'abc', '']) assert.equal((await mock.request('?page=' + value)).status, 400);
  assert.equal((await mock.request('', 'POST', { schemaVersion: 2, state: validState() })).status, 400);
  const badQuantity = validState(); badQuantity.options.ptz.qty = -1;
  assert.equal((await mock.request('', 'POST', { schemaVersion: 1, state: badQuantity })).status, 400);
  const badPrice = validState(); badPrice.overrides.g26.price = 'free';
  assert.equal((await mock.request('', 'POST', { schemaVersion: 1, state: badPrice })).status, 400);
  const badExcludedKey = validState(); badExcludedKey.excludedParts = { '../main': ['g8'] };
  assert.equal((await mock.request('', 'POST', { schemaVersion: 1, state: badExcludedKey })).status, 400);
  const badExcludedValue = validState(); badExcludedValue.excludedParts = { 'general|1|NICE': ['g8', 'g8'] };
  assert.equal((await mock.request('', 'POST', { schemaVersion: 1, state: badExcludedValue })).status, 400);
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
  assert.match(preflight.headers.get('Access-Control-Allow-Methods'), /DELETE/);
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
    assert.deepEqual(await response.json(), emptyList);
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

test('deleting one entry preserves the file, all other snapshots and unrelated files', async () => {
  const mock = mockGithub();
  for (let i = 0; i < 3; i++) await mock.request('', 'POST', { schemaVersion: 1, state: validState() });
  const before = JSON.parse(mock.files.get('history.json')).entries;
  mock.files.set('index.html', '<html>unchanged</html>');
  const response = await mock.request('/' + before[1].id, 'DELETE');
  assert.equal(response.status, 200);
  assert.equal((await response.json()).deleted, true);
  assert.deepEqual(JSON.parse(mock.files.get('history.json')).entries, [before[0], before[2]]);
  assert.equal(mock.files.get('index.html'), '<html>unchanged</html>');
  assert.equal((await mock.request('/' + before[1].id)).status, 404);
  assert.equal(mock.calls.filter(call => call.init.method === 'DELETE').length, 0);
});

test('deleting the final entry keeps an empty history.json instead of deleting the file', async () => {
  const mock = mockGithub();
  const saved = await (await mock.request('', 'POST', { schemaVersion: 1, state: validState() })).json();
  assert.equal((await mock.request('/' + saved.id, 'DELETE')).status, 200);
  assert.equal(mock.files.has('history.json'), true);
  assert.deepEqual(JSON.parse(mock.files.get('history.json')), { schemaVersion: 1, entries: [] });
  assert.deepEqual(await (await mock.request()).json(), emptyList);
  const writes = mock.calls.filter(call => call.init.method === 'PUT').length;
  assert.equal((await mock.request('/' + saved.id, 'DELETE')).status, 404);
  assert.equal(mock.calls.filter(call => call.init.method === 'PUT').length, writes);
});

test('deletion requires an allowed origin, a valid id and the configured secret', async () => {
  const mock = mockGithub();
  const saved = await (await mock.request('', 'POST', { schemaVersion: 1, state: validState() })).json();
  const previous = mock.files.get('history.json');
  assert.equal((await mock.request('/' + saved.id, 'DELETE', undefined, env, {Origin:''})).status, 403);
  assert.equal((await mock.request('/' + saved.id, 'DELETE', undefined, env, {Origin:'https://other.example'})).status, 403);
  assert.equal((await mock.request('/' + saved.id, 'DELETE', undefined, {})).status, 503);
  assert.equal((await mock.request('/invalid', 'DELETE')).status, 400);
  assert.equal((await mock.request('', 'DELETE')).status, 405);
  assert.equal(mock.files.get('history.json'), previous);
});

test('a concurrent save survives a deletion SHA retry', async () => {
  const mock = mockGithub();
  const removed = await (await mock.request('', 'POST', { schemaVersion: 1, state: validState() })).json();
  const kept = await (await mock.request('', 'POST', { schemaVersion: 1, state: validState() })).json();
  let added;
  mock.onNextWrite(async () => { added = await (await mock.request('', 'POST', { schemaVersion: 1, state: validState() })).json(); });
  assert.equal((await mock.request('/' + removed.id, 'DELETE')).status, 200);
  assert.deepEqual(JSON.parse(mock.files.get('history.json')).entries.map(item => item.id), [kept.id, added.id]);
});

test('concurrent deletions remove only their selected entries', async () => {
  const mock = mockGithub(), records = [];
  for (let i = 0; i < 3; i++) records.push(await (await mock.request('', 'POST', { schemaVersion: 1, state: validState() })).json());
  mock.onNextWrite(async () => { assert.equal((await mock.request('/' + records[1].id, 'DELETE')).status, 200); });
  assert.equal((await mock.request('/' + records[0].id, 'DELETE')).status, 200);
  assert.deepEqual(JSON.parse(mock.files.get('history.json')).entries.map(item => item.id), [records[2].id]);
});

test('deleting the sole item on the final page moves the requested page to the remaining last page', async () => {
  const mock = mockGithub();
  for (let i = 0; i < 11; i++) await mock.request('', 'POST', { schemaVersion: 1, state: validState() });
  const second = await (await mock.request('?page=2')).json();
  assert.equal(second.items.length, 1);
  assert.equal((await mock.request('/' + second.items[0].id, 'DELETE')).status, 200);
  const after = await (await mock.request('?page=2')).json();
  assert.equal(after.page, 1);
  assert.equal(after.totalPages, 1);
  assert.equal(after.total, 10);
  assert.equal(after.items.length, 10);
});

test('corrupted history and failed GitHub writes are never reported as successful deletions', async () => {
  const mock = mockGithub();
  const saved = await (await mock.request('', 'POST', { schemaVersion: 1, state: validState() })).json();
  const previous = mock.files.get('history.json');
  mock.fail(403, 'PUT');
  assert.equal((await mock.request('/' + saved.id, 'DELETE')).status, 503);
  assert.equal(mock.files.get('history.json'), previous);
  mock.files.set('history.json', 'not JSON');
  assert.equal((await mock.request('/' + saved.id, 'DELETE')).status, 502);
  assert.equal(mock.files.get('history.json'), 'not JSON');
});

test('catalog is created and fully replaced independently from saved history', async () => {
  const mock = mockGithub(), catalog = defaultCatalog();
  assert.deepEqual(await (await mock.catalogRequest()).json(), { catalog: null, revision: null });
  const response = await mock.catalogRequest('PUT', { schemaVersion: 1, revision: null, catalog });
  assert.equal(response.status, 200);
  const first = await response.json();
  assert.ok(first.revision);
  assert.equal(first.catalog.parts.length, 73);
  assert.equal(first.catalog.models.length, 8);
  await mock.request('', 'POST', { schemaVersion: 1, state: validState() });
  const history = mock.files.get('history.json');
  first.catalog.parts[0].name = '변경된 함체'; first.catalog.parts[0].price = 0; first.catalog.parts[0].pn = '';
  const changed = await mock.catalogRequest('PUT', { schemaVersion: 1, revision: first.revision, catalog: first.catalog, path: 'index.html' });
  assert.equal(changed.status, 200);
  const loaded = await (await mock.catalogRequest()).json();
  assert.equal(loaded.catalog.parts[0].name, '변경된 함체');
  assert.equal(loaded.catalog.parts[0].price, 0);
  assert.equal(loaded.catalog.parts[0].pn, '-');
  assert.equal(mock.files.get('history.json'), history);
  assert.equal(mock.files.size, 2);
});

test('stale catalog revisions never overwrite another editor’s configuration', async () => {
  const mock = mockGithub();
  const first = await (await mock.catalogRequest('PUT', { schemaVersion: 1, revision: null, catalog: defaultCatalog() })).json();
  const other = structuredClone(first.catalog); other.parts[0].name = '다른 사용자 변경';
  assert.equal((await mock.catalogRequest('PUT', { schemaVersion: 1, revision: first.revision, catalog: other })).status, 200);
  const before = mock.files.get('parts.json');
  assert.equal((await mock.catalogRequest('PUT', { schemaVersion: 1, revision: first.revision, catalog: first.catalog })).status, 409);
  assert.equal(mock.files.get('parts.json'), before);
});

test('catalog rejects invalid references, duplicate parts, missing models and invalid quantities', async () => {
  const mock = mockGithub();
  const changes = [c=>c.models[0].items.push({partId:'missing',qty:1,section:'fixed',van:'ALL'}),c=>c.parts.push(c.parts[0]),c=>c.models.pop(),c=>c.models[0].items[0].qty=0,c=>c.parts[0].price=-1,c=>c.parts[0].name='',c=>c.options[0].ids=['missing'],c=>c.models[0].replacementBaseId='missing'];
  for (const change of changes) {
    const catalog = defaultCatalog(); change(catalog);
    assert.equal((await mock.catalogRequest('PUT', { schemaVersion: 1, revision: null, catalog })).status, 400);
  }
  assert.equal(mock.files.size, 0);
});

test('catalog writes require allowed origins and preserve corrupt files', async () => {
  const mock = mockGithub(), body = { schemaVersion: 1, revision: null, catalog: defaultCatalog() };
  assert.equal((await mock.catalogRequest('PUT', body, env, {Origin:''})).status, 403);
  assert.equal((await mock.catalogRequest('PUT', body, env, {Origin:'https://other.example'})).status, 403);
  assert.equal((await mock.catalogRequest('DELETE')).status, 405);
  assert.equal((await mock.catalogRequest('POST', body)).status, 405);
  mock.files.set('parts.json', 'corrupt');
  assert.equal((await mock.catalogRequest()).status, 502);
  assert.equal((await mock.catalogRequest('PUT', body)).status, 502);
  assert.equal(mock.files.get('parts.json'), 'corrupt');
});

test('historical configuration and custom part prices survive a master catalog update', async () => {
  const mock = mockGithub(), catalog = defaultCatalog();
  catalog.parts.push({id:'p_custom',category:'general',name:'신규 장치',pn:'',price:null,spec:''});
  catalog.models[0].items.push({partId:'p_custom',qty:2,section:'fixed',van:'ALL'});
  const state = {...validState(),type:'general',catalogSnapshot:catalog,overrides:{p_custom:{price:0,pn:''}}};
  const response = await mock.request('', 'POST', { schemaVersion: 1, state });
  assert.equal(response.status, 201);
  const saved = await response.json();
  await mock.catalogRequest('PUT', { schemaVersion: 1, revision: null, catalog: defaultCatalog() });
  const loaded = await (await mock.request('/'+saved.id)).json();
  assert.equal(loaded.state.catalogSnapshot.parts.at(-1).id, 'p_custom');
  assert.equal(loaded.state.catalogSnapshot.models[0].items.at(-1).qty, 2);
  assert.equal(loaded.state.overrides.p_custom.price, 0);
  assert.equal(loaded.state.overrides.p_custom.pn, '');
});
