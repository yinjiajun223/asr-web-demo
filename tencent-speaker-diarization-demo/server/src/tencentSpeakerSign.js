import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const localEnvPath = path.resolve(__dirname, '../.env');
const sharedEnvPath = path.resolve(
  __dirname,
  '../../..',
  'tencent-asr-demo/server/.env',
);

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;

  const text = fs.readFileSync(filePath, 'utf8');
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue;
    const index = trimmed.indexOf('=');
    const key = trimmed.slice(0, index).trim();
    const value = trimmed.slice(index + 1).trim().replace(/^["']|["']$/g, '');
    if (key && process.env[key] === undefined) process.env[key] = value;
  }
}

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
    const timestamp = Number.parseInt(await res.text(), 10);
    return Number.isFinite(timestamp)
      ? timestamp
      : Math.round(Date.now() / 1000);
  } catch {
    return Math.round(Date.now() / 1000);
  }
}

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name} in ${localEnvPath} or ${sharedEnvPath}`);
  return value;
}

export async function buildTencentSpeakerWsUrl() {
  loadEnvFile(localEnvPath);
  loadEnvFile(sharedEnvPath);

  const secretId = requiredEnv('TENCENT_SECRET_ID');
  const secretKey = requiredEnv('TENCENT_SECRET_KEY');
  const appId = requiredEnv('TENCENT_APP_ID');
  const serverTime = await fetchTencentServerTime();
  const localTime = Math.round(Date.now() / 1000);

  const params = {
    secretid: secretId,
    engine_model_type: process.env.TENCENT_SPEAKER_ENGINE_MODEL_TYPE || '16k_zh_en_speaker',
    timestamp: serverTime,
    expired: localTime + Number.parseInt(process.env.TENCENT_URL_EXPIRE_SECONDS || '86400', 10),
    nonce: Math.round(localTime / 100),
    voice_id: guid(),
    voice_format: Number.parseInt(process.env.TENCENT_VOICE_FORMAT || '1', 10),
    speaker_diarization: 1,
    sentence_strategy: Number.parseInt(process.env.TENCENT_SENTENCE_STRATEGY || '0', 10),
  };

  if (process.env.TENCENT_TOKEN) params.token = process.env.TENCENT_TOKEN;

  const queryStr = Object.keys(params)
    .sort()
    .map((key) => `${key}=${params[key]}`)
    .join('&');
  const signStr = `asr.cloud.tencent.com/asr/v2/${appId}?${queryStr}`;
  const signature = crypto
    .createHmac('sha1', secretKey)
    .update(signStr)
    .digest('base64');

  return `wss://${signStr}&signature=${encodeURIComponent(signature)}`;
}
