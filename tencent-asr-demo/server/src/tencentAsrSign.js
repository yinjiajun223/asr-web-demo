import crypto from 'node:crypto';

function guid() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

async function fetchTencentServerTime() {
  try {
    const res = await fetch('https://asr.cloud.tencent.com/server_time', {
      signal: AbortSignal.timeout(2500),
    });
    const text = await res.text();
    const timestamp = Number.parseInt(text, 10);
    return Number.isFinite(timestamp)
      ? timestamp
      : Math.round(Date.now() / 1000);
  } catch {
    return Math.round(Date.now() / 1000);
  }
}

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export async function buildTencentAsrWsUrl() {
  const secretId = requiredEnv('TENCENT_SECRET_ID');
  const secretKey = requiredEnv('TENCENT_SECRET_KEY');
  const appId = requiredEnv('TENCENT_APP_ID');

  const serverTime = await fetchTencentServerTime();
  const localTime = Math.round(Date.now() / 1000);
  const expireSeconds = Number.parseInt(
    process.env.TENCENT_URL_EXPIRE_SECONDS || '86400',
    10,
  );

  const params = {
    secretid: secretId,
    engine_model_type: process.env.TENCENT_ENGINE_MODEL_TYPE || '16k_zh',
    timestamp: serverTime,
    expired: localTime + expireSeconds,
    nonce: Math.round(localTime / 100),
    voice_id: guid(),
    voice_format: Number.parseInt(process.env.TENCENT_VOICE_FORMAT || '1', 10),
  };

  if (process.env.TENCENT_TOKEN) {
    params.token = process.env.TENCENT_TOKEN;
  }

  const sortedKeys = Object.keys(params).sort();
  const queryStr = sortedKeys.map((key) => `${key}=${params[key]}`).join('&');
  const signStr = `asr.cloud.tencent.com/asr/v2/${appId}?${queryStr}`;
  const signature = crypto
    .createHmac('sha1', secretKey)
    .update(signStr)
    .digest('base64');

  return `wss://${signStr}&signature=${encodeURIComponent(signature)}`;
}
