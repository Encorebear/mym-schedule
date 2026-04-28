// MYM Schedule — Netlify Function Proxy

// 환경변수보다 코드 직접 지정 우선 (환경변수 충돌 방지)
const GAS_URL = 'https://script.google.com/macros/s/AKfycbynNDWxLMSXZVxO7xscWw-h4R7mpougxeP8tBH5wzSRDBDq0fpO4KOsocfvuz20U1MV/exec';

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

    return { statusCode: 200, headers, body: text };

  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ ok: false, error: err.message }) };
  }
};
