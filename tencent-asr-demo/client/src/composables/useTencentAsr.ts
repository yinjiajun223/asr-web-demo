/**
 * 腾讯云实时语音识别 composable
 *
 * 使用 WebAudioSpeechRecognizer 同款协议（WebSocket + PCM），不依赖 SDK 包，
 * 仅使用 crypto-js 完成 HMAC-SHA1 签名。
 *
 * 用法 A（推荐）：由后端直接返回签名后的 wss URL，通过 options.urlFetcher 注入
 * 用法 B：前端自行用 secretId/secretKey/appId 构建签名（仅测试）
 */
import { ref } from 'vue';
import CryptoJS from 'crypto-js';

export interface AsrCredentials {
  secretId: string;
  secretKey: string;
  appId: string;
  /** 使用临时密钥时需要传入 */
  token?: string;
}

export interface UseTencentAsrOptions {
  /** 直接传入凭证（测试用），不传则使用 urlFetcher */
  credentials?: AsrCredentials;
  /** 后端签名后的 wss URL 获取函数 */
  urlFetcher?: () => Promise<string>;
}

function guid(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function to16kHz(audioData: Float32Array, sampleRate: number): Float32Array {
  const fitCount = Math.round(audioData.length * (16000 / sampleRate));
  const newData = new Float32Array(fitCount);
  const springFactor = (audioData.length - 1) / (fitCount - 1);
  newData[0] = audioData[0];
  for (let i = 1; i < fitCount - 1; i++) {
    const tmp = i * springFactor;
    const before = Math.floor(tmp);
    const after = Math.ceil(tmp);
    newData[i] =
      audioData[before] +
      (audioData[after] - audioData[before]) * (tmp - before);
  }
  if (fitCount > 1) newData[fitCount - 1] = audioData[audioData.length - 1];
  return newData;
}

function to16BitPCM(input: Float32Array): Int8Array {
  const buffer = new ArrayBuffer(input.length * 2);
  const view = new DataView(buffer);
  for (let i = 0; i < input.length; i++) {
    const s = Math.max(-1, Math.min(1, input[i]));
    view.setInt16(i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Int8Array(buffer);
}

async function fetchServerTime(): Promise<number> {
  try {
    const res = await fetch('https://asr.cloud.tencent.com/server_time');
    const text = await res.text();
    const t = parseInt(text, 10);
    return Number.isFinite(t) ? t : Math.round(Date.now() / 1000);
  } catch {
    return Math.round(Date.now() / 1000);
  }
}

async function buildWsUrl(cred: AsrCredentials): Promise<string> {
  const serverTime = await fetchServerTime();
  const localTime = Math.round(Date.now() / 1000);
  const params: Record<string, string | number> = {
    secretid: cred.secretId,
    engine_model_type: '16k_zh',
    timestamp: serverTime,
    expired: localTime + 86400,
    nonce: Math.round(localTime / 100),
    voice_id: guid(),
    voice_format: 1,
  };
  if (cred.token) params['token'] = cred.token;

  const sortedKeys = Object.keys(params).sort();
  const queryStr = sortedKeys.map((k) => `${k}=${params[k]}`).join('&');
  const signStr = `asr.cloud.tencent.com/asr/v2/${cred.appId}?${queryStr}`;

  const signature = CryptoJS.enc.Base64.stringify(
    CryptoJS.HmacSHA1(signStr, cred.secretKey)
  );

  return `wss://${signStr}&signature=${encodeURIComponent(signature)}`;
}

export function useTencentAsr(options?: UseTencentAsrOptions) {
  const isListening = ref(false);
  const isSupported = ref(!!navigator.mediaDevices?.getUserMedia);
  /** 实时累积识别结果（最终句+当前中间结果） */
  const result = ref('');
  const error = ref<{ error: string } | null>(null);

  let ws: WebSocket | null = null;
  let audioCtx: AudioContext | null = null;
  let mediaStream: MediaStream | null = null;
  let processor: ScriptProcessorNode | null = null;

  let isWsReady = false;
  let finalText = '';
  let audioChunks: Int8Array[] = [];
  let lastFlushTime = 0;
  let isStopped = false;

  function cleanup() {
    if (processor) {
      processor.disconnect();
      processor.onaudioprocess = null;
      processor = null;
    }
    if (mediaStream) {
      mediaStream.getTracks().forEach((t) => t.stop());
      mediaStream = null;
    }
    if (audioCtx) {
      audioCtx.close().catch(() => {});
      audioCtx = null;
    }
    isWsReady = false;
    audioChunks = [];
    isListening.value = false;
  }

  function sendAudioChunks() {
    const totalLen = audioChunks.reduce((s, c) => s + c.length, 0);
    const payload = new Int8Array(totalLen);
    let offset = 0;
    for (const chunk of audioChunks) {
      payload.set(chunk, offset);
      offset += chunk.length;
    }
    audioChunks = [];
    ws!.send(payload.buffer);
  }

  function flushAudio() {
    if (
      !ws ||
      ws.readyState !== WebSocket.OPEN ||
      !isWsReady ||
      audioChunks.length === 0
    )
      return;
    const now = Date.now();
    if (now - lastFlushTime < 100) return;
    lastFlushTime = now;
    sendAudioChunks();
  }

  function forceFlushAudio() {
    if (
      !ws ||
      ws.readyState !== WebSocket.OPEN ||
      !isWsReady ||
      audioChunks.length === 0
    )
      return;
    sendAudioChunks();
  }

  function connectWs(url: string): Promise<WebSocket> {
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(url);
      socket.binaryType = 'arraybuffer';

      socket.onopen = () => resolve(socket);
      socket.onerror = (e) => reject(e);

      socket.onmessage = (e) => {
        try {
          const res = JSON.parse(e.data as string);
          if (res.code !== 0) {
            error.value = {
              error: `ASR ${res.code}: ${res.message ?? '识别失败'}`,
            };
            stop();
            return;
          }
          if (!isWsReady) isWsReady = true;

          if (res.final === 1) {
            isListening.value = false;
            return;
          }
          if (res.result) {
            const text: string = res.result.voice_text_str ?? '';
            if (res.result.slice_type === 2) {
              finalText += text;
              result.value = finalText;
            } else {
              result.value = finalText + text;
            }
          }
        } catch {
          // 忽略非 JSON 消息
        }
      };

      socket.onclose = (e) => {
        if (!e.wasClean && isListening.value) {
          error.value = { error: 'WebSocket 连接异常断开' };
          cleanup();
        }
      };
    });
  }

  async function start() {
    if (isListening.value) return;
    if (!isSupported.value) return;

    isStopped = false;
    error.value = null;
    result.value = '';
    finalText = '';
    audioChunks = [];

    try {
      let urlPromise: Promise<string>;
      if (options?.credentials) {
        urlPromise = buildWsUrl(options.credentials);
      } else if (options?.urlFetcher) {
        urlPromise = options.urlFetcher();
      } else {
        throw new Error('useTencentAsr: 必须提供 credentials 或 urlFetcher');
      }

      const micPromise = navigator.mediaDevices.getUserMedia({
        audio: true,
        video: false,
      });

      const [url, stream] = await Promise.all([urlPromise, micPromise]);
      if (isStopped) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }

      mediaStream = stream;

      ws = await connectWs(url);
      if (isStopped) {
        ws.close();
        ws = null;
        mediaStream.getTracks().forEach((t) => t.stop());
        mediaStream = null;
        return;
      }

      audioCtx = new (window.AudioContext ||
        (window as any).webkitAudioContext)();
      const source = audioCtx.createMediaStreamSource(mediaStream);
      processor = audioCtx.createScriptProcessor(1024, 1, 1);

      processor.onaudioprocess = (ev) => {
        const inputData = ev.inputBuffer.getChannelData(0);
        const resampled = to16kHz(inputData, audioCtx!.sampleRate);
        audioChunks.push(to16BitPCM(resampled));
        flushAudio();
      };

      source.connect(processor);
      processor.connect(audioCtx.destination);
      isListening.value = true;
    } catch (e: any) {
      if (!isStopped) {
        error.value = { error: e?.message ?? String(e) };
      }
      cleanup();
    }
  }

  /**
   * 停止录音并等待服务端返回最终识别结果。
   * @returns 最终识别文本
   */
  async function stop(): Promise<string> {
    isStopped = true;

    if (processor) {
      processor.disconnect();
      processor.onaudioprocess = null;
      processor = null;
    }
    if (mediaStream) {
      mediaStream.getTracks().forEach((t) => t.stop());
      mediaStream = null;
    }
    if (audioCtx) {
      audioCtx.close().catch(() => {});
      audioCtx = null;
    }

    if (ws && ws.readyState === WebSocket.OPEN) {
      forceFlushAudio();
      ws.send(JSON.stringify({ type: 'end' }));

      const finalResult = await new Promise<string>((resolve) => {
        const timeout = setTimeout(() => resolve(result.value), 3000);

        const currentWs = ws!;
        currentWs.onmessage = (e) => {
          try {
            const res = JSON.parse(e.data as string);
            if (res.code !== 0) {
              clearTimeout(timeout);
              resolve(result.value);
              return;
            }
            if (res.result) {
              const text: string = res.result.voice_text_str ?? '';
              if (res.result.slice_type === 2) {
                finalText += text;
                result.value = finalText;
              } else {
                result.value = finalText + text;
              }
            }
            if (res.final === 1) {
              clearTimeout(timeout);
              resolve(result.value);
            }
          } catch {
            // 忽略非 JSON
          }
        };
        currentWs.onclose = () => {
          clearTimeout(timeout);
          resolve(result.value);
        };
        currentWs.onerror = () => {
          clearTimeout(timeout);
          resolve(result.value);
        };
      });

      if (ws) {
        ws.onmessage = null;
        ws.onclose = null;
        ws.onerror = null;
        ws.close();
        ws = null;
      }
      isWsReady = false;
      audioChunks = [];
      isListening.value = false;
      return finalResult;
    }

    if (ws) {
      ws.onmessage = null;
      ws.onclose = null;
      ws.onerror = null;
      ws.close();
      ws = null;
    }
    isWsReady = false;
    audioChunks = [];
    isListening.value = false;
    return result.value;
  }

  return { isListening, isSupported, result, error, start, stop };
}
