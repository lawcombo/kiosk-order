const MAX_BYTES = 128 * 1024;
const MAX_HISTORY_BYTES = 900 * 1024;
const PAGE_SIZE = 10;
const RECORD_ID = /^\d{8}T\d{9}Z_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const DEFAULT_ORIGINS = 'https://lawcombo.github.io,http://127.0.0.1:4173,http://localhost:4173';
const INFO_KEYS = ['applicant', 'date', 'site', 'business', 'contact', 'install', 'installTime', 'address', 'nickname', 'catid', 'sw', 'pms', 'delivery', 'notes'];

class ApiError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function encode(text) {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(binary);
}

function decode(text) {
  return new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(atob(text.replace(/\s/g, '')), c => c.charCodeAt(0)));
}

function summary(record) {
  return { id: record.id, savedAt: record.savedAt, type: record.state.type, model: record.state.model, site: record.state.info.site || '매장명 미기재' };
}

function parseHistory(text) {
  try {
    const data = JSON.parse(text);
    if (!object(data) || data.schemaVersion !== 1 || !Array.isArray(data.entries)) throw Error();
    const ids = new Set();
    for (const record of data.entries) {
      if (!object(record) || record.schemaVersion !== 1 || !RECORD_ID.test(record.id) || ids.has(record.id) ||
          typeof record.savedAt !== 'string' || !Number.isFinite(Date.parse(record.savedAt)) ||
          !record.id.startsWith(record.savedAt.replace(/[-:.]/g, '') + '_') ||
          !object(record.state) || !['general', 'slim', 'equipment'].includes(record.state.type) ||
          !integer(record.state.model, 1, 4) || !object(record.state.info) ||
          typeof record.state.info.site !== 'string') throw Error();
      ids.add(record.id);
    }
    return data;
  } catch { throw new ApiError(502, 'history.json 형식이 올바르지 않습니다. 기존 파일을 확인해주세요.'); }
}

function object(value) { return value && typeof value === 'object' && !Array.isArray(value); }
function integer(value, min, max) { return Number.isInteger(value) && value >= min && value <= max; }

// This pure validator is also embedded in the single HTML page.
export function validateCatalog(input, fail = message => { throw new Error(message); }) {
  const obj = value => value && typeof value === 'object' && !Array.isArray(value);
  const id = value => typeof value === 'string' && /^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(value) && !['constructor', 'prototype'].includes(value);
  const text = (value, max, fallback = '') => {
    if (value === undefined || value === null) return fallback;
    if (typeof value !== 'string' || value.length > max) fail('문자열 길이나 형식이 올바르지 않습니다.');
    return value.trim();
  };
  const number = (value, min, max) => Number.isInteger(value) && value >= min && value <= max;
  if (!obj(input) || input.schemaVersion !== 1 || !Array.isArray(input.parts) || input.parts.length < 1 || input.parts.length > 200 ||
      !Array.isArray(input.models) || input.models.length !== 8 || !Array.isArray(input.options) || input.options.length > 100) fail('부품·모델 설정 형식이 올바르지 않습니다.');
  const partIds = new Set();
  const parts = input.parts.map(p => {
    if (!obj(p) || !id(p.id) || partIds.has(p.id) || !['general', 'slim', 'common'].includes(p.category)) fail('부품 번호나 구분이 올바르지 않습니다.');
    const name = text(p.name, 200);
    if (!name) fail('모든 부품의 품목명을 입력해주세요.');
    if (p.price !== null && (typeof p.price !== 'number' || !Number.isFinite(p.price) || p.price < 0 || p.price > 1e12)) fail('단가는 0 이상의 숫자 또는 빈칸이어야 합니다.');
    partIds.add(p.id);
    return { id: p.id, category: p.category, name, pn: text(p.pn, 200) || '-', spec: text(p.spec, 500), price: p.price };
  });
  const modelIds = new Set();
  const models = input.models.map(m => {
    if (!obj(m) || !['general', 'slim'].includes(m.type) || !number(m.number, 1, 4) || m.id !== (m.type === 'general' ? 'G' : 'S') + m.number || modelIds.has(m.id) || !Array.isArray(m.items) || m.items.length > 200) fail('8개 모델의 구성 설정이 올바르지 않습니다.');
    modelIds.add(m.id);
    const used = new Set();
    const items = m.items.map(row => {
      if (!obj(row) || !partIds.has(row.partId) || used.has(row.partId) || !number(row.qty, 1, 10000) || !['fixed', 'model', 'mount'].includes(row.section) || !['ALL', 'NICE', 'KIS'].includes(row.van)) fail('모델에 포함된 품목·수량·VAN 조건을 확인해주세요.');
      used.add(row.partId);
      return { partId: row.partId, qty: row.qty, section: row.section, van: row.van };
    });
    const replacementBaseId = m.replacementBaseId || null;
    if (replacementBaseId && !items.some(row => row.partId === replacementBaseId && row.van === 'ALL')) fail('교체 차감 기준은 해당 모델의 공통 포함 품목이어야 합니다.');
    const title = text(m.title, 100);
    if (!title) fail('모델 이름을 입력해주세요.');
    return { id: m.id, type: m.type, number: m.number, title, description: text(m.description, 300), replacementBaseId, items };
  });
  const optionIds = new Set();
  const options = input.options.map(o => {
    if (!obj(o) || !id(o.id) || optionIds.has(o.id) || !Array.isArray(o.ids) || !o.ids.length || o.ids.length > 10 || new Set(o.ids).size !== o.ids.length || o.ids.some(key => !partIds.has(key))) fail('추가 옵션에 없는 부품이나 중복 번호가 있습니다.');
    const name = text(o.name, 200);
    if (!name || !number(o.defaultQty, 1, 10000)) fail('추가 옵션의 이름과 기본 수량을 확인해주세요.');
    optionIds.add(o.id);
    return { id: o.id, name, ids: [...o.ids], group: text(o.group, 80) || '추가 장비', unit: text(o.unit, 20) || '개', defaultQty: o.defaultQty, hint: text(o.hint, 300), replacement: o.replacement === true };
  });
  return { schemaVersion: 1, parts, models, options };
}

// Only application data can be saved; clients cannot choose repository paths or commits.
export function validateState(input) {
  if (!object(input) || !['general', 'slim', 'equipment'].includes(input.type) ||
      !integer(input.model, 1, 4) || !integer(input.qty, 1, 100) || !['NICE', 'KIS', 'PENDING'].includes(input.van)) {
    throw new ApiError(400, '신청 구성 데이터가 올바르지 않습니다.');
  }
  if (!object(input.info) || !object(input.options) || !object(input.overrides)) {
    throw new ApiError(400, '신청 정보 또는 품목 데이터가 올바르지 않습니다.');
  }
  const info = Object.fromEntries(INFO_KEYS.map(key => {
    const value = input.info[key] ?? '';
    if (typeof value !== 'string' || value.length > (key === 'notes' ? 8000 : 500)) throw new ApiError(400, '신청 정보의 길이나 형식을 확인해주세요.');
    return [key, value];
  }));
  const rawInfoEmphasis = input.infoEmphasis ?? {};
  if (!object(rawInfoEmphasis) || Object.entries(rawInfoEmphasis).some(([key, value]) => !INFO_KEYS.includes(key) || typeof value !== 'boolean')) {
    throw new ApiError(400, '신청 정보 강조 설정이 올바르지 않습니다.');
  }
  const infoEmphasis = Object.fromEntries(Object.entries(rawInfoEmphasis).filter(([, value]) => value));
  if (Object.keys(input.options).length > 100 || Object.keys(input.overrides).length > 200) throw new ApiError(400, '품목 데이터가 너무 많습니다.');
  const options = Object.fromEntries(Object.entries(input.options).map(([key, value]) => {
    if (!/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(key) || ['constructor', 'prototype'].includes(key) || !object(value) || !integer(value.qty, 0, 10000)) {
      throw new ApiError(400, '옵션 수량이 올바르지 않습니다.');
    }
    return [key, { qty: value.qty, on: value.qty > 0 }];
  }));
  const overrides = Object.fromEntries(Object.entries(input.overrides).map(([key, value]) => {
    if (!/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(key) || ['constructor', 'prototype'].includes(key) || !object(value)) throw new ApiError(400, '부품 정보가 올바르지 않습니다.');
    const fields = {};
    for (const field of ['pn', 'name', 'spec']) {
      if (value[field] !== undefined) {
        if (typeof value[field] !== 'string' || value[field].length > 500) throw new ApiError(400, '부품 정보가 너무 깁니다.');
        fields[field] = value[field];
      }
    }
    if (value.price !== undefined) {
      if (value.price !== null && (typeof value.price !== 'number' || !Number.isFinite(value.price) || value.price < 0 || value.price > 1e12)) {
        throw new ApiError(400, '부품 단가가 올바르지 않습니다.');
      }
      fields.price = value.price;
    }
    return [key, fields];
  }));
  const catalogSnapshot = input.catalogSnapshot ? validateCatalog(input.catalogSnapshot, message => { throw new ApiError(400, message); }) : undefined;
  return { type: input.type, model: input.model, qty: input.qty, van: input.van, priceDisclosure: input.priceDisclosure === 'Y' ? 'Y' : 'N', optionQtyVersion: 2, info, infoEmphasis, options, overrides, pn: {}, showCost: false, showFixed: false, ...(catalogSnapshot ? { catalogSnapshot } : {}) };
}

async function readJson(request) {
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) throw new ApiError(415, 'JSON 데이터만 저장할 수 있습니다.');
  if (Number(request.headers.get('content-length')) > MAX_BYTES) throw new ApiError(413, '저장할 내용이 너무 큽니다.');
  const reader = request.body?.getReader();
  if (!reader) throw new ApiError(400, '저장할 내용이 없습니다.');
  const chunks = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BYTES) { await reader.cancel(); throw new ApiError(413, '저장할 내용이 너무 큽니다.'); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try { return JSON.parse(new TextDecoder().decode(bytes)); }
  catch { throw new ApiError(400, '저장 데이터 형식이 올바르지 않습니다.'); }
}

// Keep the native fetch receiver: detached runtime methods can fail in Workers.
export function createHistoryHandler({ fetch: upstreamFetch = (input, init) => globalThis.fetch(input, init), now = () => new Date(), uuid = () => crypto.randomUUID() } = {}) {
  return async function handle(request, env) {
    const origin = request.headers.get('Origin');
    const allowed = (env.ALLOWED_ORIGINS || DEFAULT_ORIGINS).split(',').map(s => s.trim()).filter(Boolean);
    const headers = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Vary': 'Origin' };
    if (origin && allowed.includes(origin)) headers['Access-Control-Allow-Origin'] = origin;
    const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers });
    try {
      if (origin && !allowed.includes(origin)) throw new ApiError(403, '이 주소에서는 이력 서비스를 사용할 수 없습니다.');
      if (request.method === 'OPTIONS') {
        if (!origin || !allowed.includes(origin)) throw new ApiError(403, '허용되지 않은 요청입니다.');
        return new Response(null, { status: 204, headers: { ...headers, 'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Max-Age': '600' } });
      }
      const url = new URL(request.url);
      const isList = url.pathname === '/api/history' || url.pathname === '/api/history/';
      const isCatalog = url.pathname === '/api/catalog' || url.pathname === '/api/catalog/';
      const detail = /^\/api\/history\/([^/]+)$/.exec(url.pathname);
      if (!isList && !detail && !isCatalog) throw new ApiError(404, '요청한 기능을 찾을 수 없습니다.');
      if (!(isCatalog ? ['GET', 'PUT'] : isList ? ['GET', 'POST'] : ['GET', 'DELETE']).includes(request.method)) throw new ApiError(405, '지원하지 않는 요청입니다.');
      if (['POST', 'PUT', 'DELETE'].includes(request.method) && !origin) throw new ApiError(403, '허용된 페이지에서 요청해주세요.');
      const owner = env.GITHUB_OWNER || 'lawcombo', repo = env.GITHUB_REPO || 'kiosk-order', branch = env.GITHUB_BRANCH || 'main';
      const token = typeof env.GITHUB_TOKEN === 'string' ? env.GITHUB_TOKEN.trim() : '';
      if (!token || !/^[A-Za-z0-9_.-]+$/.test(owner) || !/^[A-Za-z0-9_.-]+$/.test(repo)) throw new ApiError(503, '이력 저장 서비스 설정이 아직 완료되지 않았습니다.');
      if (!/^[A-Za-z0-9_]+$/.test(token)) throw new ApiError(503, 'GITHUB_TOKEN 형식을 확인해주세요. Secret에는 토큰 값만 입력해야 합니다.');
      const base = `https://api.github.com/repos/${owner}/${repo}`;
      async function github(path, init = {}, allowMissing = false) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 12000);
        try {
          const response = await upstreamFetch(base + path, { ...init, redirect: 'manual', signal: controller.signal, headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}`, 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'kiosk-order-history', 'Cache-Control': 'no-cache', ...(init.body ? { 'Content-Type': 'application/json' } : {}) } });
          if (response.status >= 300 && response.status < 400) throw new ApiError(502, 'GitHub 저장소 주소가 변경됐습니다. 저장소 설정을 확인해주세요.');
          if (allowMissing && response.status === 404) return null;
          if (!response.ok) {
            if ([401, 403].includes(response.status)) throw new ApiError(503, 'GitHub 저장 권한 또는 API 사용량을 확인해주세요.');
            if (response.status === 404) throw new ApiError(404, '저장 이력 또는 저장소를 찾을 수 없습니다.');
            if ([409, 422].includes(response.status)) throw new ApiError(409, '저장이 완료되지 않았습니다. 잠시 후 다시 시도해주세요.');
            if (response.status === 429) throw new ApiError(429, '요청이 많습니다. 잠시 후 다시 시도해주세요.');
            throw new ApiError(502, 'GitHub 이력 서비스에 연결할 수 없습니다.');
          }
          return await response.json();
        } catch (error) {
          if (error instanceof ApiError) throw error;
          // Never log the original message, headers or token; some runtime errors include them.
          const code = controller.signal.aborted || error?.name === 'AbortError' ? 'TIMEOUT'
            : /illegal invocation/i.test(error?.message || '') ? 'CALL_CONTEXT'
            : error instanceof SyntaxError ? 'INVALID_RESPONSE' : 'NETWORK';
          console.error('History GitHub request failed', { code });
          throw new ApiError(502, code === 'TIMEOUT' ? 'GitHub 연결 시간이 초과됐습니다. 잠시 후 다시 시도해주세요. (TIMEOUT)'
            : `GitHub 요청을 처리하지 못했습니다. 관리자에게 오류 코드를 알려주세요. (${code})`);
        } finally { clearTimeout(timer); }
      }
      if (isCatalog) {
        const file = await github(`/contents/parts.json?ref=${encodeURIComponent(branch)}`, {}, true);
        let current = null;
        if (file) {
          if (file.encoding !== 'base64' || typeof file.content !== 'string' || !file.sha || file.size > MAX_BYTES) throw new ApiError(502, '부품 설정 파일을 읽을 수 없습니다.');
          try { current = validateCatalog(JSON.parse(decode(file.content))); }
          catch { throw new ApiError(502, 'parts.json 형식이 올바르지 않습니다. 기존 설정을 확인해주세요.'); }
        }
        if (request.method === 'GET') return json({ catalog: current, revision: file?.sha || null });
        const body = await readJson(request);
        if (!object(body) || body.schemaVersion !== 1 || !Object.hasOwn(body, 'revision')) throw new ApiError(400, '설정 저장 형식이 올바르지 않습니다.');
        if (body.revision !== (file?.sha || null)) throw new ApiError(409, '다른 사용자가 설정을 변경했습니다. 변경 내용을 확인한 후 새로 불러와주세요.');
        const catalog = validateCatalog(body.catalog, message => { throw new ApiError(400, message); });
        const serialized = JSON.stringify(catalog) + '\n';
        if (new TextEncoder().encode(serialized).byteLength > MAX_BYTES) throw new ApiError(413, '부품 설정의 용량이 너무 큽니다.');
        const result = await github('/contents/parts.json', { method: 'PUT', body: JSON.stringify({ message: 'Update kiosk parts and model configuration [skip ci]', branch, content: encode(serialized), ...(file ? { sha: file.sha } : {}) }) });
        return json({ catalog, revision: result.content?.sha || null, commit: result.commit?.sha });
      }
      async function loadHistoryFile() {
        const file = await github(`/contents/history.json?ref=${encodeURIComponent(branch)}`, {}, true);
        if (!file) return { data: { schemaVersion: 1, entries: [] }, sha: null };
        if (file.encoding !== 'base64' || typeof file.content !== 'string' || !file.sha || file.size > MAX_HISTORY_BYTES) {
          throw new ApiError(502, 'history.json을 읽을 수 없거나 파일 용량이 한도를 초과했습니다.');
        }
        let text;
        try { text = decode(file.content); } catch { throw new ApiError(502, 'history.json 문자 형식이 올바르지 않습니다.'); }
        if (new TextEncoder().encode(text).byteLength > MAX_HISTORY_BYTES) throw new ApiError(502, 'history.json 파일 용량이 한도를 초과했습니다.');
        return { data: parseHistory(text), sha: file.sha };
      }
      async function updateHistory(change, message) {
        // Re-read on a SHA conflict so a save or deletion never overwrites another user's change.
        for (let attempt = 0; attempt < 3; attempt++) {
          const { data, sha } = await loadHistoryFile();
          const value = change(data);
          const serialized = JSON.stringify(data) + '\n';
          if (new TextEncoder().encode(serialized).byteLength > MAX_HISTORY_BYTES) throw new ApiError(413, '이력 파일 용량이 한도에 도달했습니다. 기존 이력을 백업한 후 관리자에게 문의해주세요.');
          try {
            const result = await github('/contents/history.json', { method: 'PUT', body: JSON.stringify({ message, branch, content: encode(serialized), ...(sha ? { sha } : {}) }) });
            return { value, commit: result.commit?.sha };
          } catch (error) {
            if (!(error instanceof ApiError) || error.status !== 409 || attempt === 2) throw error;
          }
        }
      }
      if (request.method === 'POST') {
        const body = await readJson(request);
        if (!object(body) || body.schemaVersion !== 1) throw new ApiError(400, '지원하지 않는 저장 형식입니다.');
        const state = validateState(body.state), savedAt = now().toISOString();
        const id = `${savedAt.replace(/[-:.]/g, '')}_${uuid()}`;
        const record = { schemaVersion: 1, id, savedAt, state };
        if (new TextEncoder().encode(JSON.stringify(record)).byteLength > MAX_BYTES) throw new ApiError(413, '저장할 내용이 너무 큽니다.');
        const result = await updateHistory(data => data.entries.push(record), 'Save kiosk request history [skip ci]');
        return json({ ...summary(record), commit: result.commit }, 201);
      }
      if (detail) {
        let id;
        try { id = decodeURIComponent(detail[1]); } catch { throw new ApiError(400, '이력 번호가 올바르지 않습니다.'); }
        if (!RECORD_ID.test(id)) throw new ApiError(400, '이력 번호가 올바르지 않습니다.');
        if (request.method === 'DELETE') {
          const result = await updateHistory(data => {
            const index = data.entries.findIndex(item => item.id === id);
            if (index === -1) throw new ApiError(404, '이미 삭제됐거나 찾을 수 없는 이력입니다.');
            data.entries.splice(index, 1);
          }, 'Delete kiosk request history entry [skip ci]');
          return json({ id, deleted: true, commit: result.commit });
        }
        const { data } = await loadHistoryFile();
        const record = data.entries.find(item => item.id === id);
        if (!record) throw new ApiError(404, '저장 이력을 찾을 수 없습니다.');
        return json({ ...record, state: validateState(record.state) });
      }
      const cursor = url.searchParams.get('before');
      if (cursor && !RECORD_ID.test(cursor)) throw new ApiError(400, '목록 위치가 올바르지 않습니다.');
      const requestedPage = url.searchParams.get('page') ?? '1';
      if (!/^[1-9]\d{0,6}$/.test(requestedPage) || (cursor && url.searchParams.has('page'))) throw new ApiError(400, '페이지 번호가 올바르지 않습니다.');
      const { data } = await loadHistoryFile();
      const entries = data.entries.map(summary)
        .filter(item => !cursor || item.id < cursor).sort((a, b) => a.id === b.id ? 0 : a.id < b.id ? 1 : -1);
      const total = entries.length, totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
      const page = Math.min(Number(requestedPage), totalPages), start = (page - 1) * PAGE_SIZE;
      const items = entries.slice(start, start + PAGE_SIZE);
      return json({ items, page, pageSize: PAGE_SIZE, total, totalPages, canDelete: true, nextCursor: start + PAGE_SIZE < total ? items.at(-1).id : null });
    } catch (error) {
      return json({ error: error instanceof ApiError ? error.message : '이력 처리 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.' }, error instanceof ApiError ? error.status : 500);
    }
  };
}

export default { fetch: createHistoryHandler() };
