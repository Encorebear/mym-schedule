// MYM Schedule — Netlify Function
// npm 패키지 없이 Node.js 18 내장 crypto + fetch 만 사용

const crypto = require('crypto');

const SPREADSHEET_ID = process.env.SPREADSHEET_ID;
const CLIENT_EMAIL   = process.env.GOOGLE_CLIENT_EMAIL;

function parsePrivateKey(raw) {
  if (!raw) return '';
  return raw.replace(/\\n/g, '\n').replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/^["']|["']$/g, '').trim();
}
const PRIVATE_KEY = parsePrivateKey(process.env.GOOGLE_PRIVATE_KEY);

const SHEET_EVENTS = process.env.SHEET_EVENTS || '이벤트';
const SHEET_USERS  = process.env.SHEET_USERS  || '사용자';
const SHEET_AUDIT  = process.env.SHEET_AUDIT  || '감사로그';
const SHEET_CAR    = process.env.SHEET_CAR    || '차량기록';

const DEFAULT_EVENT_HEADERS = ['id','actor','type','title','date','startTime','endTime','location','manager','memo','isPrivate','vehicle','color','category','completed','completedAt','completedBy','createdAt','updatedAt'];
const DEFAULT_USER_HEADERS  = ['id','name','password','role','actors'];
const DEFAULT_AUDIT_HEADERS = ['timestamp','userId','auditAction','eventId','actor','title','date','details'];
const DEFAULT_CAR_HEADERS   = ['id','date','vehicle','plate','type','handler','amount','memo'];

// ── 인메모리 캐시 (시트 데이터 + 액세스 토큰) ──
// Netlify 함수는 컨테이너가 재사용되므로 캐시가 실제로 작동함
let _tokenCache  = null;
const _sheetCache = {};          // { [sheetName]: { data, headers, exp } }
const CACHE_TTL_EVENTS = 30000;  // 이벤트: 30초
const CACHE_TTL_USERS  = 120000; // 사용자: 2분

function getCached(sheetName) {
  const c = _sheetCache[sheetName];
  return (c && c.exp > Date.now()) ? c : null;
}
function setCached(sheetName, headers, data, ttl) {
  _sheetCache[sheetName] = { headers, data, exp: Date.now() + ttl };
}
function invalidate(sheetName) {
  delete _sheetCache[sheetName];
}

function makeJWT() {
  const now = Math.floor(Date.now() / 1000);
  const header  = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    iss:   CLIENT_EMAIL,
    scope: 'https://www.googleapis.com/auth/spreadsheets',
    aud:   'https://oauth2.googleapis.com/token',
    iat:   now,
    exp:   now + 3600,
  })).toString('base64url');
  const sign = crypto.createSign('RSA-SHA256');
  sign.update(`${header}.${payload}`);
  const sig = sign.sign(PRIVATE_KEY, 'base64url');
  return `${header}.${payload}.${sig}`;
}

async function getAccessToken() {
  if (_tokenCache && _tokenCache.exp > Date.now()) return _tokenCache.token;
  const jwt = makeJWT();
  const res  = await fetch('https://oauth2.googleapis.com/token', {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body:    `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`,
  });
  const data = await res.json();
  if (!data.access_token) throw new Error('토큰 발급 실패: ' + JSON.stringify(data));
  _tokenCache = { token: data.access_token, exp: Date.now() + (data.expires_in - 60) * 1000 };
  return _tokenCache.token;
}

// ── Sheets REST API 래퍼 ──
const BASE = 'https://sheets.googleapis.com/v4/spreadsheets';

async function sheetsGet(token, range) {
  const r = await fetch(`${BASE}/${SPREADSHEET_ID}/values/${encodeURIComponent(range)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return r.json();
}

async function sheetsClear(token, range) {
  await fetch(`${BASE}/${SPREADSHEET_ID}/values/${encodeURIComponent(range)}:clear`, {
    method:  'POST',
    headers: { Authorization: `Bearer ${token}` },
  });
}

async function sheetsUpdate(token, range, values) {
  const r = await fetch(
    `${BASE}/${SPREADSHEET_ID}/values/${encodeURIComponent(range)}?valueInputOption=RAW`,
    {
      method:  'PUT',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body:    JSON.stringify({ values }),
    }
  );
  return r.json();
}

async function sheetsAppend(token, range, values) {
  const r = await fetch(
    `${BASE}/${SPREADSHEET_ID}/values/${encodeURIComponent(range)}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
    {
      method:  'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body:    JSON.stringify({ values }),
    }
  );
  return r.json();
}

// ── 시트 읽기 / 쓰기 헬퍼 ──
async function readSheet(token, sheetName, ttl) {
  const cached = getCached(sheetName);
  if (cached) return { headers: cached.headers, data: cached.data };

  const data = await sheetsGet(token, sheetName);
  if (data.error) throw new Error(`Sheets API 오류: ${data.error.message} (${data.error.code})`);
  const rows = data.values || [];
  if (rows.length < 1) return { headers: [], data: [] };
  const headers = rows[0];
  const objs = rows.slice(1)
    .map(row => {
      const obj = {};
      headers.forEach((h, i) => { if (h) obj[h] = row[i] !== undefined ? row[i] : ''; });
      return obj;
    })
    .filter(obj => Object.values(obj).some(v => v !== ''));
  if (ttl) setCached(sheetName, headers, objs, ttl);
  return { headers, data: objs };
}

async function getHeaders(token, sheetName, fallback) {
  try {
    const data = await sheetsGet(token, `${sheetName}!1:1`);
    const h = (data.values || [[]])[0];
    return h && h.length > 0 ? h : fallback;
  } catch (e) { return fallback; }
}

async function writeSheet(token, sheetName, objs, headers) {
  const rows = [
    headers,
    ...objs.map(obj => headers.map(h => {
      const v = obj[h];
      if (v === undefined || v === null) return '';
      if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
      return String(v);
    })),
  ];
  await sheetsClear(token, sheetName);
  await sheetsUpdate(token, `${sheetName}!A1`, rows);
}

async function appendRow(token, sheetName, obj, fallbackHeaders) {
  const headers = await getHeaders(token, sheetName, fallbackHeaders);
  const row = headers.map(h => { const v = obj[h]; return (v === undefined || v === null) ? '' : String(v); });
  await sheetsAppend(token, sheetName, [row]);
}

// ── 메인 핸들러 ──
exports.handler = async (event) => {
  const resHeaders = {
    'Access-Control-Allow-Origin':  '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Content-Type': 'application/json',
  };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: resHeaders, body: '' };

  const ok   = d  => ({ statusCode: 200, headers: resHeaders, body: JSON.stringify({ ok: true,  ...d }) });
  const fail = msg => ({ statusCode: 200, headers: resHeaders, body: JSON.stringify({ ok: false, error: msg }) });

  try {
    let action, body = {};
    if (event.httpMethod === 'POST') {
      try { body = JSON.parse(event.body || '{}'); } catch (e) {}
      action = body.action;
    } else {
      body = event.queryStringParameters || {};
      action = body.action;
    }

    if (action === 'ping') return ok({ version: 'v11-direct' });

    // 진단용: JWT 서명 테스트 (네트워크 호출 없음)
    if (action === 'testkey') {
      try {
        const keyPreview = PRIVATE_KEY.slice(0, 50) + '...' + PRIVATE_KEY.slice(-20);
        const hasBegin = PRIVATE_KEY.includes('-----BEGIN PRIVATE KEY-----');
        const hasEnd   = PRIVATE_KEY.includes('-----END PRIVATE KEY-----');
        let jwtOk = false, jwtErr = '';
        try { makeJWT(); jwtOk = true; } catch(e) { jwtErr = e.message; }
        return ok({ keyLen: PRIVATE_KEY.length, hasBegin, hasEnd, jwtOk, jwtErr, keyPreview });
      } catch(e) { return fail(e.message); }
    }

    // 진단용: OAuth 토큰 발급 테스트
    if (action === 'testtoken') {
      try {
        const t = await Promise.race([
          getAccessToken(),
          new Promise((_, reject) => setTimeout(() => reject(new Error('timeout 10s')), 10000))
        ]);
        return ok({ tokenLen: t.length, tokenPreview: t.slice(0, 20) + '...' });
      } catch(e) { return fail(e.message); }
    }

    // 진단용: Sheets API 직접 호출 테스트
    if (action === 'testsheets') {
      try {
        const t = await getAccessToken();
        const url = `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}?fields=sheets.properties.title`;
        const r = await Promise.race([
          fetch(url, { headers: { Authorization: `Bearer ${t}` } }),
          new Promise((_, reject) => setTimeout(() => reject(new Error('timeout 25s')), 25000))
        ]);
        const text = await r.text();
        return ok({ status: r.status, rawText: text.slice(0, 500) });
      } catch(e) { return fail(e.message); }
    }

    const token = await getAccessToken();

    // LOGIN
    if (action === 'login') {
      const { username, password } = body;
      const { data: users } = await readSheet(token, SHEET_USERS, CACHE_TTL_USERS);
      const user = users.find(u => (u.name === username || u.id === username) && u.password === password);
      if (!user) return fail('아이디 또는 비밀번호가 올바르지 않습니다.');
      const sessionToken = Buffer.from(`${username}:${Date.now()}`).toString('base64');
      const { password: _pw, ...safeUser } = user;
      // actors 필드: JSON 문자열이면 파싱, 아니면 빈 배열
      if (typeof safeUser.actors === 'string') {
        try { safeUser.actors = JSON.parse(safeUser.actors); } catch { safeUser.actors = []; }
      }
      if (!Array.isArray(safeUser.actors)) safeUser.actors = [];
      return ok({ user: safeUser, sessionToken });
    }

    // LOAD EVENTS
    if (action === 'load') {
      const { data: events } = await readSheet(token, SHEET_EVENTS, CACHE_TTL_EVENTS);
      const normalized = events
        .map(ev => ({
          ...ev,
          isPrivate: ev.isPrivate === 'TRUE' || ev.isPrivate === true || ev.isPrivate === '1',
          completed: ev.completed === 'TRUE' || ev.completed === true || ev.completed === '1',
        }))
        .filter(ev => ev.id);
      return ok({ events: normalized });
    }

    // SAVE EVENTS
    if (action === 'save') {
      const events  = body.events || [];
      const headers = await getHeaders(token, SHEET_EVENTS, DEFAULT_EVENT_HEADERS);
      await writeSheet(token, SHEET_EVENTS, events, headers);
      invalidate(SHEET_EVENTS);
      return ok({ saved: events.length });
    }

    // LOAD USERS
    if (action === 'loadUsers') {
      const { data: users } = await readSheet(token, SHEET_USERS, CACHE_TTL_USERS);
      return ok({ users: users.map(({ password: _pw, ...u }) => {
        // actors: JSON 문자열 → 배열로 파싱
        if (typeof u.actors === 'string') {
          try { u.actors = JSON.parse(u.actors); } catch { u.actors = []; }
        }
        if (!Array.isArray(u.actors)) u.actors = [];
        return u;
      }) });
    }

    // SAVE USERS
    if (action === 'saveUsers') {
      const users = (body.users || []).map(u => ({
        ...u,
        // actors: 배열 → JSON 문자열로 저장
        actors: Array.isArray(u.actors) ? JSON.stringify(u.actors) : (u.actors || '[]')
      }));
      const headers = await getHeaders(token, SHEET_USERS, DEFAULT_USER_HEADERS);
      await writeSheet(token, SHEET_USERS, users, headers);
      invalidate(SHEET_USERS);
      return ok({ saved: users.length });
    }

    // CHANGE PASSWORD
    if (action === 'changePassword') {
      const { sessionToken, currentPassword, newPassword } = body;
      if (!sessionToken) return fail('인증 필요');
      let username = '';
      try { username = Buffer.from(sessionToken, 'base64').toString().split(':')[0]; } catch (e) {}
      const { headers, data: users } = await readSheet(token, SHEET_USERS);
      const idx = users.findIndex(u => (u.name === username || u.id === username) && u.password === currentPassword);
      if (idx === -1) return fail('현재 비밀번호가 올바르지 않습니다.');
      users[idx].password = newPassword;
      await writeSheet(token, SHEET_USERS, users, headers);
      return ok({});
    }

    // LOG AUDIT
    if (action === 'logAudit') {
      const entry = {
        timestamp:   body.timestamp   || new Date().toISOString(),
        userId:      body.userId      || '',
        auditAction: body.auditAction || body.actionType || '',
        eventId:     body.eventId     || '',
        actor:       body.actor       || '',
        title:       body.title       || '',
        date:        body.date        || '',
        details:     body.details     || '',
      };
      await appendRow(token, SHEET_AUDIT, entry, DEFAULT_AUDIT_HEADERS);
      return ok({});
    }

    // LOAD AUDIT LOG
    if (action === 'loadAuditLog') {
      try { const { data: logs } = await readSheet(token, SHEET_AUDIT); return ok({ logs }); }
      catch (e) { return ok({ logs: [] }); }
    }

    // LOAD CAR RECORDS
    if (action === 'loadCarRecords') {
      try { const { data: records } = await readSheet(token, SHEET_CAR); return ok({ records }); }
      catch (e) { return ok({ records: [] }); }
    }

    // ADD CAR RECORD
    if (action === 'addCarRecord') {
      const record = body.record || {};
      if (!record.id) record.id = 'car_' + Date.now();
      await appendRow(token, SHEET_CAR, record, DEFAULT_CAR_HEADERS);
      return ok({ record });
    }

    // DELETE CAR RECORD
    if (action === 'deleteCarRecord') {
      const { headers, data: records } = await readSheet(token, SHEET_CAR);
      const updated = records.filter(r => r.id !== body.id);
      await writeSheet(token, SHEET_CAR, updated, headers);
      return ok({ deleted: records.length - updated.length });
    }

    return fail('Unknown action: ' + action);

  } catch (err) {
    console.error('[api] error:', err.message);
    return { statusCode: 500, headers: resHeaders, body: JSON.stringify({ ok: false, error: err.message }) };
  }
};
