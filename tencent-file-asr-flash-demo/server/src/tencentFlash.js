import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const FLASH_HOST = 'asr.cloud.tencent.com';
export const MAX_AUDIO_BYTES = 100_000_000;
const SUPPORTED_FORMATS = new Set([
  'wav',
  'pcm',
  'ogg-opus',
  'speex',
  'silk',
  'mp3',
  'm4a',
  'aac',
  'amr',
]);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPaths = [
  path.resolve(__dirname, '.env'),
  path.resolve(__dirname, '../.env'),
  path.resolve(
    __dirname,
    '../../..',
    'tencent-speaker-diarization-demo/server/.env',
  ),
  path.resolve(__dirname, '../../..', 'tencent-asr-demo/server/.env'),
];

function httpError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

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

export function loadFlashEnv() {
  envPaths.forEach(loadEnvFile);
}

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw httpError(
      500,
      `Missing ${name} in ${envPaths.join(' or ')}`,
    );
  }
  return value;
}

export async function readAudioBody(stream, maxBytes = MAX_AUDIO_BYTES) {
  const declaredLength = Number(stream.headers?.['content-length']);
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw httpError(413, '音频文件超过腾讯极速版 100MB 限制。');
  }

  // ponytail: 单请求最多缓存 100MB；并发量上来后改为临时文件或受控流式管道。
  const chunks = [];
  let totalBytes = 0;

  for await (const chunk of stream) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalBytes += buffer.length;
    if (totalBytes > maxBytes) {
      throw httpError(413, '音频文件超过腾讯极速版 100MB 限制。');
    }
    chunks.push(buffer);
  }

  if (!totalBytes) throw httpError(400, '请选择非空音频文件。');
  return Buffer.concat(chunks, totalBytes);
}

async function fetchTencentServerTime() {
  try {
    const response = await fetch(`https://${FLASH_HOST}/server_time`, {
      signal: AbortSignal.timeout(2500),
    });
    const timestamp = Number.parseInt(await response.text(), 10);
    return Number.isFinite(timestamp)
      ? timestamp
      : Math.round(Date.now() / 1000);
  } catch {
    return Math.round(Date.now() / 1000);
  }
}

export function buildFlashRequest({
  appId,
  secretId,
  secretKey,
  timestamp,
  engineType,
  voiceFormat,
}) {
  const params = {
    engine_type: engineType,
    first_channel_only: 1,
    secretid: secretId,
    speaker_diarization: 1,
    timestamp,
    voice_format: voiceFormat,
    word_info: 1,
  };
  const query = Object.entries(params)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join('&');
  const pathName = `/asr/flash/v1/${appId}`;
  const signText = `POST${FLASH_HOST}${pathName}?${query}`;
  const authorization = crypto
    .createHmac('sha1', secretKey)
    .update(signText, 'utf8')
    .digest('base64');

  return {
    authorization,
    signText,
    url: `https://${FLASH_HOST}${pathName}?${query}`,
  };
}

function normalizeFlashResult(data, sourceBytes) {
  const channels = Array.isArray(data.flash_result) ? data.flash_result : [];
  const sentences = channels.flatMap((channel) => {
    const items = Array.isArray(channel.sentence_list)
      ? channel.sentence_list
      : [];

    return items.map((sentence) => ({
      channelId: Number(channel.channel_id ?? 0),
      speakerId: Number(sentence.speaker_id ?? -1),
      text: String(sentence.text || '').trim(),
      startTime: Number(sentence.start_time ?? 0),
      endTime: Number(sentence.end_time ?? 0),
    }));
  });

  return {
    requestId: String(data.request_id || ''),
    audioDuration: Number(data.audio_duration || 0),
    sourceBytes,
    text: channels
      .map((channel) => String(channel.text || '').trim())
      .filter(Boolean)
      .join('\n'),
    sentences,
  };
}

export async function recognizeAudio({ audio, voiceFormat }) {
  loadFlashEnv();

  const format = String(voiceFormat || '').trim().toLowerCase();
  if (!SUPPORTED_FORMATS.has(format)) {
    throw httpError(400, '请选择正确的音频格式。');
  }
  if (!Buffer.isBuffer(audio) || !audio.length) {
    throw httpError(400, '请选择非空音频文件。');
  }
  if (audio.length > MAX_AUDIO_BYTES) {
    throw httpError(413, '音频文件超过腾讯极速版 100MB 限制。');
  }

  const request = buildFlashRequest({
    appId: requiredEnv('TENCENT_APP_ID'),
    secretId: requiredEnv('TENCENT_SECRET_ID'),
    secretKey: requiredEnv('TENCENT_SECRET_KEY'),
    timestamp: await fetchTencentServerTime(),
    engineType: process.env.TENCENT_FLASH_ENGINE_TYPE || '16k_zh',
    voiceFormat: format,
  });

  let response;
  try {
    response = await fetch(request.url, {
      method: 'POST',
      headers: {
        Host: FLASH_HOST,
        Authorization: request.authorization,
        'Content-Type': 'application/octet-stream',
        'Content-Length': String(audio.length),
      },
      body: audio,
      signal: AbortSignal.timeout(300_000),
    });
  } catch (error) {
    throw httpError(
      502,
      error?.name === 'TimeoutError'
        ? '腾讯极速版识别超时。'
        : '调用腾讯极速版失败，请检查网络。',
    );
  }

  const responseText = await response.text();
  let data;
  try {
    data = JSON.parse(responseText);
  } catch {
    throw httpError(502, `腾讯极速版返回了非 JSON 响应：HTTP ${response.status}`);
  }

  if (!response.ok || data.code !== 0) {
    const requestId = data.request_id ? `，request_id=${data.request_id}` : '';
    throw httpError(
      502,
      `腾讯极速版识别失败（${data.code ?? response.status}）：${data.message || '未知错误'}${requestId}`,
    );
  }

  return normalizeFlashResult(data, audio.length);
}
