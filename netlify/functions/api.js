// MYM Schedule — Netlify Function Proxy

// 환경변수보다 코드 직접 지정 우선 (환경변수 충돌 방지)
const GAS_URL = 'https://script.google.com/macros/s/AKfycbwVMd-YwEr-Rz6YIMO73QYLxCCWJSBjul32aQNOTiUHsMsDHNh-GcRiGSYmU7Yaiu8J/exec';

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin':  '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  try {
    let response;

    if (event.httpMethod === 'POST') {
      const body = JSON.parse(event.body || '{}');
      response = await fetch(GAS_URL, {
        method:   'POST',
        headers:  { 'Content-Type': 'text/plain' },
        body:     JSON.stringify(body),
        redirect: 'follow'
      });
    } else {
      // queryStringParameters로 쿼리스트링 재조립 (rawQuery보다 안정적)
      const qp = event.queryStringParameters || {};
      const qs = Object.keys(qp).length
        ? '?' + Object.entries(qp).map(([k,v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&')
        : '';
      response = await fetch(GAS_URL + qs, { redirect: 'follow' });
    }

    const text = await response.text();

    // GAS가 HTML 오류 페이지를 돌려줄 경우 JSON으로 변환
    if (text.trim().startsWith('<')) {
      return { statusCode: 200, headers, body: JSON.stringify({ ok: false, error: 'GAS_HTML_ERROR' }) };
    }

    // action=load 응답에서 이벤트 스키마 정규화
    // GAS 구버전이 actors(복수)/id 누락된 이벤트를 반환할 경우 보정
    const action = (event.httpMethod === 'GET')
      ? (event.queryStringParameters || {}).action
      : (() => { try { return JSON.parse(event.body || '{}').action; } catch(e) { return ''; } })();

    if (action === 'load') {
      try {
        const data = JSON.parse(text);
        if (data.ok && Array.isArray(data.events)) {
          let changed = false;
          data.events = data.events.map((ev, idx) => {
            // actors(복수) → actor(단수) 변환
            if (!ev.actor && ev.actors) { ev.actor = ev.actors; changed = true; }
            // id 없으면 생성
            if (!ev.id) { ev.id = 'sv_' + Date.now() + '_' + idx + '_' + Math.random().toString(36).slice(2,5); changed = true; }
            return ev;
          });
          if (changed) {
            return { statusCode: 200, headers, body: JSON.stringify(data) };
          }
        }
      } catch(e) { /* 파싱 실패시 원본 반환 */ }
    }

    return { statusCode: 200, headers, body: text };

  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ ok: false, error: err.message }) };
  }
};
