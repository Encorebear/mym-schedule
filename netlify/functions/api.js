// MYM Schedule — Netlify Function (Google Sheets API v4 직접 연결)
// GAS 완전 제거 버전

const { google } = require('googleapis');

const SPREADSHEET_ID   = process.env.SPREADSHEET_ID;
const CLIENT_EMAIL     = process.env.GOOGLE_CLIENT_EMAIL;

// private key 형식 정규화 (Netlify 환경변수 줄바꿈 방식 다양하게 대응)
function parsePrivateKey(raw) {
  if (!raw) return '';
  let key = raw;
  // JSON 이스케이프된 \n → 실제 줄바꿈
  key = key.replace(/\\n/g, '\n');
  // Windows 줄바꿈 정규화
  key = key.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  // 앞뒤 따옴표 제거 (실수로 붙여넣은 경우)
  key = key.replace(/^["']|["']$/g, '').trim();
  return key;
}
const PRIVATE_KEY = parsePrivateKey(process.env.GOOGLE_PRIVATE_KEY);

// ── 시트 탭 이름 (실제 스프레드시트와 다르면 환경변수로 덮어쓰기 가능) ──
const SHEET_EVENTS = process.env.SHEET_EVENTS || '이벤트';
const SHEET_USERS  = process.env.SHEET_USERS  || '사용자';
const SHEET_AUDIT  = process.env.SHEET_AUDIT  || '감사로그';
const SHEET_CAR    = process.env.SHEET_CAR    || '차량기록';

// ── 기본 헤더 (해당 시트가 비어있을 때만 사용) ──
const DEFAULT_EVENT_HEADERS = [
  'id','actor','type','title','date','startTime','endTime',
  'location','manager','memo','isPrivate','vehicle','color',
  'category','completed','completedAt','completedBy','createdAt','updatedAt'
];
const DEFAULT_USER_HEADERS  = ['id','name','password','role'];
const DEFAULT_AUDIT_HEADERS = ['timestamp','userId','auditAction','eventId','actor','title','date','details'];
const DEFAULT_CAR_HEADERS   = ['id','date','vehicle','plate','type','handler','amount','memo'];

// ── Sheets 클라이언트 ──
function getSheets() {
  const auth = new google.auth.JWT(
    CLIENT_EMAIL, null, PRIVATE_KEY,
    ['https://www.googleapis.com/auth/spreadsheets']
  );
  return google.sheets({ version: 'v4', auth });
}

// ── 시트 읽기 (첫 행=헤더, 나머지=데이터 객체 배열) ──
async function readSheet(sheets, sheetName) {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: sheetName,
  });
  const rows = res.data.values || [];
  if (rows.length < 1) return { headers: [], data: [] };
  const headers = rows[0];
  const data = rows.slice(1)
    .map(row => {
      const obj = {};
      headers.forEach((h, i) => { if (h) obj[h] = (row[i] !== undefined ? row[i] : ''); });
      return obj;
    })
    .filter(obj => Object.values(obj).some(v => v !== ''));
  return { headers, data };
}

// ── 첫 행(헤더)만 읽기 ──
async function getHeaders(sheets, sheetName, fallback) {
  try {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${sheetName}!1:1`,
    });
    const h = (res.data.values || [[]])[0];
    return h && h.length > 0 ? h : fallback;
  } catch (e) {
    return fallback;
  }
}

// ── 시트 전체 덮어쓰기 (클리어 후 재기록) ──
async function writeSheet(sheets, sheetName, data, headers) {
  const rows = [
    headers,
    ...data.map(obj =>
      headers.map(h => {
        const v = obj[h];
        if (v === undefined || v === null) return '';
        if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
        return String(v);
      })
    ),
  ];
  await sheets.spreadsheets.values.clear({
    spreadsheetId: SPREADSHEET_ID,
    range: sheetName,
  });
  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `${sheetName}!A1`,
    valueInputOption: 'RAW',
    requestBody: { values: rows },
  });
}

// ── 행 추가(append) ──
async function appendRow(sheets, sheetName, obj, defaultHeaders) {
  const headers = await getHeaders(sheets, sheetName, defaultHeaders);
  const row = headers.map(h => {
    const v = obj[h];
    if (v === undefined || v === null) return '';
    return String(v);
  });
  await sheets.spreadsheets.values.append({
    spreadsheetId: SPREADSHEET_ID,
    range: sheetName,
    valueInputOption: 'RAW',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values: [row] },
  });
}

// ── 메인 핸들러 ──
exports.handler = async (event) => {
  const resHeaders = {
    'Access-Control-Allow-Origin':  '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Content-Type': 'application/json',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: resHeaders, body: '' };
  }

  const ok   = (data) => ({ statusCode: 200, headers: resHeaders, body: JSON.stringify({ ok: true,  ...data }) });
  const fail = (msg)  => ({ statusCode: 200, headers: resHeaders, body: JSON.stringify({ ok: false, error: msg }) });

  try {
    const sheets = getSheets();

    // 액션 & 바디 파싱
    let action, body = {};
    if (event.httpMethod === 'POST') {
      try { body = JSON.parse(event.body || '{}'); } catch (e) {}
      action = body.action;
    } else {
      body   = event.queryStringParameters || {};
      action = body.action;
    }

    // ── PING ──
    if (action === 'ping') {
      return ok({ version: 'v10-sheets' });
    }

    // ── LOGIN ──
    if (action === 'login') {
      const { username, password } = body;
      const { data: users } = await readSheet(sheets, SHEET_USERS);
      const user = users.find(u =>
        (u.name === username || u.id === username) && u.password === password
      );
      if (!user) return fail('아이디 또는 비밀번호가 올바르지 않습니다.');
      const token = Buffer.from(`${username}:${Date.now()}`).toString('base64');
      const { password: _pw, ...safeUser } = user;
      return ok({ user: safeUser, sessionToken: token });
    }

    // ── LOAD EVENTS ──
    if (action === 'load') {
      const { data: events } = await readSheet(sheets, SHEET_EVENTS);
      const normalized = events
        .map(ev => ({
          ...ev,
          isPrivate: ev.isPrivate === 'TRUE' || ev.isPrivate === true  || ev.isPrivate === '1',
          completed: ev.completed === 'TRUE' || ev.completed === true  || ev.completed === '1',
        }))
        .filter(ev => ev.id);
      return ok({ events: normalized });
    }

    // ── SAVE EVENTS ──
    if (action === 'save') {
      const events  = body.events || [];
      const headers = await getHeaders(sheets, SHEET_EVENTS, DEFAULT_EVENT_HEADERS);
      await writeSheet(sheets, SHEET_EVENTS, events, headers);
      return ok({ saved: events.length });
    }

    // ── LOAD USERS (비밀번호 제외) ──
    if (action === 'loadUsers') {
      const { data: users } = await readSheet(sheets, SHEET_USERS);
      const safeUsers = users.map(({ password: _pw, ...u }) => u);
      return ok({ users: safeUsers });
    }

    // ── SAVE USERS ──
    if (action === 'saveUsers') {
      const users   = body.users || [];
      const headers = await getHeaders(sheets, SHEET_USERS, DEFAULT_USER_HEADERS);
      await writeSheet(sheets, SHEET_USERS, users, headers);
      return ok({ saved: users.length });
    }

    // ── CHANGE PASSWORD ──
    if (action === 'changePassword') {
      const { sessionToken, currentPassword, newPassword } = body;
      if (!sessionToken) return fail('인증 필요');
      let username = '';
      try { username = Buffer.from(sessionToken, 'base64').toString().split(':')[0]; } catch (e) {}
      const { headers, data: users } = await readSheet(sheets, SHEET_USERS);
      const idx = users.findIndex(u =>
        (u.name === username || u.id === username) && u.password === currentPassword
      );
      if (idx === -1) return fail('현재 비밀번호가 올바르지 않습니다.');
      users[idx].password = newPassword;
      await writeSheet(sheets, SHEET_USERS, users, headers);
      return ok({});
    }

    // ── LOG AUDIT ──
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
      await appendRow(sheets, SHEET_AUDIT, entry, DEFAULT_AUDIT_HEADERS);
      return ok({});
    }

    // ── LOAD AUDIT LOG ──
    if (action === 'loadAuditLog') {
      try {
        const { data: logs } = await readSheet(sheets, SHEET_AUDIT);
        return ok({ logs });
      } catch (e) {
        return ok({ logs: [] });
      }
    }

    // ── LOAD CAR RECORDS ──
    if (action === 'loadCarRecords') {
      try {
        const { data: records } = await readSheet(sheets, SHEET_CAR);
        return ok({ records });
      } catch (e) {
        return ok({ records: [] });
      }
    }

    // ── ADD CAR RECORD ──
    if (action === 'addCarRecord') {
      const record = body.record || {};
      if (!record.id) record.id = 'car_' + Date.now();
      await appendRow(sheets, SHEET_CAR, record, DEFAULT_CAR_HEADERS);
      return ok({ record });
    }

    // ── DELETE CAR RECORD ──
    if (action === 'deleteCarRecord') {
      const { headers, data: records } = await readSheet(sheets, SHEET_CAR);
      const updated = records.filter(r => r.id !== body.id);
      await writeSheet(sheets, SHEET_CAR, updated, headers);
      return ok({ deleted: records.length - updated.length });
    }

    return fail('Unknown action: ' + action);

  } catch (err) {
    console.error('[api] error:', err.message);
    return {
      statusCode: 500,
      headers: resHeaders,
      body: JSON.stringify({ ok: false, error: err.message }),
    };
  }
};
