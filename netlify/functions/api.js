// MYM Schedule — Netlify Function Proxy
// GAS URL과 API 키를 서버 환경변수에 숨겨서 클라이언트에 노출되지 않도록 함

const GAS_URL = process.env.GAS_URL;
const API_KEY  = process.env.MYM_API_KEY;

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

  if (!GAS_URL || !API_KEY) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Server misconfigured' }) };
  }

  try {
    let response;

    if (event.httpMethod === 'GET') {
      // 클라이언트가 보낸 key는 무시하고 환경변수 key로 교체
      const params = { ...(event.queryStringParameters || {}) };
      delete params.key;
      params.key = API_KEY;
      const qs = new URLSearchParams(params).toString();
      response = await fetch(`${GAS_URL}?${qs}`, { redirect: 'follow' });

    } else if (event.httpMethod === 'POST') {
      const body = JSON.parse(event.body || '{}');
      delete body.key;
      body.key = API_KEY;
      response = await fetch(GAS_URL, {
        method:   'POST',
        headers:  { 'Content-Type': 'text/plain' },
        body:     JSON.stringify(body),
        redirect: 'follow'
      });

    } else {
      return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
    }

    const text = await response.text();
    return { statusCode: 200, headers, body: text };

  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
