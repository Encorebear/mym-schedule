// MYM Schedule — Netlify Function Proxy

const GAS_URL = process.env.GAS_URL || 'https://script.google.com/macros/s/AKfycbynNDWxLMSXZVxO7xscWw-h4R7mpougxeP8tBH5wzSRDBDq0fpO4KOsocfvuz20U1MV/exec';
const API_KEY = process.env.MYM_API_KEY || 'mym_internal';

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

    if (event.httpMethod === 'GET') {
      const params = { ...(event.queryStringParameters || {}) };
      const qs = new URLSearchParams(params).toString();
      response = await fetch(`${GAS_URL}?${qs}`, { redirect: 'follow' });

    } else if (event.httpMethod === 'POST') {
      const body = JSON.parse(event.body || '{}');
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
