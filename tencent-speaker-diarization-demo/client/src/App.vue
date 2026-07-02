<script setup lang="ts">
import { computed, ref } from 'vue';

type UiState = 'idle' | 'connecting' | 'recording' | 'stopping' | 'error';

interface Sentence {
  id: string;
  speakerId: string;
  text: string;
  final: boolean;
}

interface SpeakerGroup {
  speakerId: string;
  texts: string[];
}

const uiState = ref<UiState>('idle');
const statusText = ref('点击开始录音，腾讯云会实时返回说话人分离结果。');
const errorText = ref('');
const liveText = ref('');
const sentences = ref<Sentence[]>([]);

let ws: WebSocket | null = null;
let audioCtx: AudioContext | null = null;
let stream: MediaStream | null = null;
let processor: ScriptProcessorNode | null = null;
let audioChunks: Int8Array[] = [];
let lastFlushTime = 0;

const isRecording = computed(() => uiState.value === 'recording');
const buttonText = computed(() => {
  if (uiState.value === 'connecting') return '连接中...';
  if (uiState.value === 'stopping') return '结束中...';
  if (isRecording.value) return '停止录音';
  return '开始录音';
});
const speakerGroups = computed<SpeakerGroup[]>(() => {
  const groups = new Map<string, string[]>();

  for (const sentence of sentences.value) {
    const texts = groups.get(sentence.speakerId) || [];
    texts.push(sentence.text);
    groups.set(sentence.speakerId, texts);
  }

  return [...groups.entries()]
    .sort(([a], [b]) => Number(a) - Number(b))
    .map(([speakerId, texts]) => ({ speakerId, texts }));
});

function to16kHz(audioData: Float32Array, sampleRate: number) {
  const fitCount = Math.max(1, Math.round(audioData.length * (16000 / sampleRate)));
  const newData = new Float32Array(fitCount);
  const springFactor = (audioData.length - 1) / Math.max(1, fitCount - 1);

  for (let i = 0; i < fitCount; i += 1) {
    const tmp = i * springFactor;
    const before = Math.floor(tmp);
    const after = Math.min(Math.ceil(tmp), audioData.length - 1);
    newData[i] = audioData[before] + (audioData[after] - audioData[before]) * (tmp - before);
  }

  return newData;
}

function to16BitPCM(input: Float32Array) {
  const buffer = new ArrayBuffer(input.length * 2);
  const view = new DataView(buffer);

  for (let i = 0; i < input.length; i += 1) {
    const sample = Math.max(-1, Math.min(1, input[i]));
    view.setInt16(i * 2, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
  }

  return new Int8Array(buffer);
}

function cleanupAudio() {
  if (processor) {
    processor.disconnect();
    processor.onaudioprocess = null;
    processor = null;
  }
  if (stream) {
    stream.getTracks().forEach((track) => track.stop());
    stream = null;
  }
  if (audioCtx) {
    audioCtx.close().catch(() => {});
    audioCtx = null;
  }
  audioChunks = [];
}

function cleanup() {
  cleanupAudio();
  if (ws) {
    ws.close();
    ws = null;
  }
}

function sendAudioChunks() {
  if (!ws || ws.readyState !== WebSocket.OPEN || audioChunks.length === 0) return;

  const payload = new Int8Array(audioChunks.reduce((sum, chunk) => sum + chunk.length, 0));
  let offset = 0;
  for (const chunk of audioChunks) {
    payload.set(chunk, offset);
    offset += chunk.length;
  }
  audioChunks = [];
  ws.send(payload.buffer);
}

function flushAudio() {
  if (Date.now() - lastFlushTime < 80) return;
  lastFlushTime = Date.now();
  sendAudioChunks();
}

function speakerLabel(id: string | number) {
  const speakerId = Number(id);

  if (!Number.isFinite(speakerId) || speakerId < 0) {
    return '说话人识别中';
  }

  return `说话人 ${speakerId + 1}`;
}

function sentenceText(item: any) {
  return String(item.sentence || item.text || item.voice_text_str || item.final_text || '').trim();
}

function sentenceItems(data: any): any[] {
  if (Array.isArray(data.sentences?.sentence_list)) return data.sentences.sentence_list;
  if (data.sentences?.sentence) return [data.sentences];
  return [];
}

function selfCheckSentenceText() {
  const sample = {
    sentence: '可以听到我说话吗？',
  };
  console.assert(sentenceText(sample) === '可以听到我说话吗？');
  console.assert(sentenceItems({ sentences: sample }).length === 1);
}

if (import.meta.env.DEV) selfCheckSentenceText();

function sentenceSpeaker(item: any) {
  return String(item.speaker_id ?? item.speakerId ?? item.speaker ?? '0');
}

function upsertSentence(item: any, index: number, final: boolean) {
  const text = sentenceText(item);
  if (!text) return;

  const speakerId = sentenceSpeaker(item);
  const id = String(item.sentence_id ?? item.slice_id ?? item.index ?? item.start_time ?? `${speakerId}-${index}`);
  const next: Sentence = { id, speakerId, text, final };
  const currentIndex = sentences.value.findIndex((sentence) => sentence.id === id);

  if (currentIndex >= 0) {
    sentences.value[currentIndex] = next;
  } else {
    sentences.value.push(next);
  }
}

function handleAsrMessage(data: any) {
  if (data.code !== 0) {
    throw new Error(`ASR ${data.code}: ${data.message || '识别失败'}`);
  }

  const list = sentenceItems(data);
  if (list.length) {
    list.forEach((item, index) => upsertSentence(item, index, data.final === 1));
    liveText.value = list.map((item) => `${speakerLabel(sentenceSpeaker(item))}: ${sentenceText(item)}`).join('\n');
    return;
  }

  const text = data.result?.voice_text_str || '';
  if (!text) return;

  const speakerId = String(data.result?.speaker_id ?? '0');
  if (data.result?.slice_type === 2) {
    sentences.value.push({
      id: `${speakerId}-${sentences.value.length}`,
      speakerId,
      text,
      final: true,
    });
  } else {
    liveText.value = `${speakerLabel(speakerId)}: ${text}`;
  }
}

async function start() {
  if (isRecording.value || uiState.value === 'connecting') return;

  uiState.value = 'connecting';
  statusText.value = '正在获取腾讯云签名 URL 和麦克风权限...';
  errorText.value = '';
  liveText.value = '';
  sentences.value = [];

  try {
    const [urlRes, mediaStream] = await Promise.all([
      fetch('/api/tencent-speaker-url'),
      navigator.mediaDevices.getUserMedia({ audio: true, video: false }),
    ]);
    const data = await urlRes.json();
    if (!urlRes.ok || !data.url) throw new Error(data.error || '获取签名 URL 失败');

    stream = mediaStream;
    ws = new WebSocket(data.url);
    ws.binaryType = 'arraybuffer';

    await new Promise<void>((resolve, reject) => {
      if (!ws) return reject(new Error('WebSocket 创建失败'));
      ws.onopen = () => resolve();
      ws.onerror = () => reject(new Error('腾讯云 WebSocket 连接失败'));
    });

    ws.onmessage = (event) => {
      try {
        handleAsrMessage(JSON.parse(String(event.data)));
      } catch (error) {
        errorText.value = error instanceof Error ? error.message : String(error);
        uiState.value = 'error';
        cleanup();
      }
    };
    ws.onclose = () => {
      if (uiState.value === 'recording') {
        uiState.value = 'idle';
        statusText.value = '连接已关闭。';
      }
    };

    audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
    const source = audioCtx.createMediaStreamSource(stream);
    processor = audioCtx.createScriptProcessor(1024, 1, 1);
    processor.onaudioprocess = (event) => {
      if (!audioCtx) return;
      audioChunks.push(to16BitPCM(to16kHz(event.inputBuffer.getChannelData(0), audioCtx.sampleRate)));
      flushAudio();
    };

    source.connect(processor);
    processor.connect(audioCtx.destination);
    uiState.value = 'recording';
    statusText.value = '录音中，多人轮流说话时会显示不同 speaker_id。';
  } catch (error) {
    errorText.value = error instanceof Error ? error.message : String(error);
    uiState.value = 'error';
    statusText.value = '启动失败。';
    cleanup();
  }
}

function stop() {
  uiState.value = 'stopping';
  statusText.value = '正在结束识别...';
  cleanupAudio();

  if (ws && ws.readyState === WebSocket.OPEN) {
    sendAudioChunks();
    ws.send(JSON.stringify({ type: 'end' }));
    setTimeout(() => {
      cleanup();
      uiState.value = 'idle';
      statusText.value = '已停止。';
    }, 1500);
    return;
  }

  cleanup();
  uiState.value = 'idle';
  statusText.value = '已停止。';
}

function toggle() {
  if (isRecording.value) stop();
  else start();
}

function clearAll() {
  liveText.value = '';
  sentences.value = [];
  errorText.value = '';
  statusText.value = '已清空。';
}
</script>

<template>
  <main class="page">
    <section class="shell">
      <header class="topbar">
        <div>
          <p class="eyebrow">Tencent Cloud ASR</p>
          <h1>实时说话人分离 Demo</h1>
        </div>
        <span class="badge" :class="uiState">{{ isRecording ? '录音中' : uiState }}</span>
      </header>

      <div class="actions">
        <button class="primary" :class="{ recording: isRecording }" :disabled="uiState === 'connecting' || uiState === 'stopping'" @click="toggle">
          {{ buttonText }}
        </button>
        <button class="secondary" :disabled="isRecording" @click="clearAll">清空</button>
      </div>

      <div class="status">{{ statusText }}</div>
      <div v-if="errorText" class="error">{{ errorText }}</div>

      <section class="panel">
        <h2>实时预览</h2>
        <pre>{{ liveText || '等待语音输入...' }}</pre>
      </section>

      <section class="panel">
        <h2>每个人说话内容</h2>
        <p class="hint">说话人编号来自腾讯云 speaker_id，是本次录音里的临时分组，不是固定用户身份。</p>
        <div v-if="speakerGroups.length" class="speaker-grid">
          <article v-for="group in speakerGroups" :key="group.speakerId" class="speaker-card">
            <strong>{{ speakerLabel(group.speakerId) }}</strong>
            <p>{{ group.texts.join('') }}</p>
          </article>
        </div>
        <p v-else class="empty">多人轮流说话后，这里会按说话人汇总内容。</p>
      </section>

      <section class="panel">
        <h2>对话流水</h2>
        <div v-if="sentences.length" class="rows">
          <article v-for="sentence in sentences" :key="sentence.id" class="row">
            <strong>{{ speakerLabel(sentence.speakerId) }}</strong>
            <p>{{ sentence.text }}</p>
          </article>
        </div>
        <p v-else class="empty">多人轮流说话后，这里会按 speaker_id 汇总句子。</p>
      </section>
    </section>
  </main>
</template>
