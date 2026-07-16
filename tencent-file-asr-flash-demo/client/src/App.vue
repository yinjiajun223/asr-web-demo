<script setup lang="ts">
import { computed, ref, shallowRef } from 'vue';

type UiState = 'idle' | 'recognizing' | 'done' | 'error';

interface RecognitionSentence {
  channelId: number;
  speakerId: number;
  text: string;
  startTime: number;
  endTime: number;
}

interface RecognitionResult {
  requestId: string;
  audioDuration: number;
  sourceBytes: number;
  text: string;
  sentences: RecognitionSentence[];
}

interface SpeakerGroup {
  speakerId: number;
  texts: string[];
}

const MAX_AUDIO_BYTES = 100_000_000;
const formatByExtension: Record<string, string> = {
  wav: 'wav',
  pcm: 'pcm',
  ogg: 'ogg-opus',
  opus: 'ogg-opus',
  speex: 'speex',
  spx: 'speex',
  silk: 'silk',
  mp3: 'mp3',
  m4a: 'm4a',
  aac: 'aac',
  amr: 'amr',
};

const fileInput = ref<HTMLInputElement | null>(null);
const selectedFile = shallowRef<File | null>(null);
const voiceFormat = ref('mp3');
const uiState = ref<UiState>('idle');
const errorText = ref('');
const result = shallowRef<RecognitionResult | null>(null);

const isRecognizing = computed(() => uiState.value === 'recognizing');
const canClear = computed(() => Boolean(selectedFile.value || result.value || errorText.value));
const statusText = computed(() => {
  if (uiState.value === 'recognizing') return '正在上传音频并等待腾讯云识别结果...';
  if (uiState.value === 'done') return '识别完成。';
  if (uiState.value === 'error') {
    return selectedFile.value ? '识别失败，请检查错误提示。' : '文件选择失败，请重新选择。';
  }
  if (selectedFile.value) return `已选择 ${selectedFile.value.name}，点击开始识别。`;
  return '选择本地音频文件后开始识别。';
});
const previewText = computed(() => {
  if (result.value) return result.value.text || '腾讯云未返回识别文本。';
  if (isRecognizing.value) return '正在识别...';
  return '识别完成后，这里会显示完整文本。';
});
const stateLabel = computed(() => {
  if (uiState.value === 'recognizing') return '识别中';
  if (uiState.value === 'done') return '已完成';
  if (uiState.value === 'error') return '失败';
  return selectedFile.value ? '文件已选' : '等待上传';
});
const speakerGroups = computed<SpeakerGroup[]>(() => {
  const groups = new Map<number, string[]>();

  for (const sentence of result.value?.sentences || []) {
    const texts = groups.get(sentence.speakerId) || [];
    texts.push(sentence.text);
    groups.set(sentence.speakerId, texts);
  }

  return [...groups.entries()]
    .sort(([a], [b]) => a - b)
    .map(([speakerId, texts]) => ({ speakerId, texts }));
});

function speakerLabel(speakerId: number) {
  return speakerId >= 0 ? `说话人 ${speakerId + 1}` : '未区分说话人';
}

function formatTime(milliseconds: number) {
  const seconds = Math.max(0, Math.round(milliseconds / 1000));
  const minutes = Math.floor(seconds / 60);
  return `${String(minutes).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

function formatBytes(bytes: number) {
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

function handleFileChange(event: Event) {
  const input = event.currentTarget as HTMLInputElement;
  const file = input.files?.[0] || null;

  selectedFile.value = file;
  result.value = null;
  errorText.value = '';
  uiState.value = 'idle';

  if (!file) return;

  const extension = file.name.split('.').pop()?.toLowerCase() || '';
  const inferredFormat = formatByExtension[extension];
  let validationError = '';
  if (!inferredFormat) validationError = '不支持该文件扩展名，请选择页面列出的音频格式。';
  else if (!file.size) validationError = '不能上传空文件。';
  else if (file.size > MAX_AUDIO_BYTES) {
    validationError = '音频文件超过腾讯极速版 100MB 限制。';
  }

  if (validationError || !inferredFormat) {
    selectedFile.value = null;
    input.value = '';
    uiState.value = 'error';
    errorText.value = validationError;
    return;
  }
  voiceFormat.value = inferredFormat;
}

async function recognize() {
  const audio = selectedFile.value;
  if (isRecognizing.value) return;
  if (!audio) {
    errorText.value = '请先选择本地音频文件。';
    return;
  }

  uiState.value = 'recognizing';
  errorText.value = '';
  result.value = null;

  try {
    const response = await fetch('/api/recognize-file', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/octet-stream',
        'X-Audio-Format': voiceFormat.value,
      },
      body: audio,
    });
    const data = (await response.json()) as RecognitionResult & {
      error?: string;
    };

    if (!response.ok) throw new Error(data.error || '识别失败。');

    result.value = data;
    uiState.value = 'done';
  } catch (error) {
    errorText.value = error instanceof Error ? error.message : String(error);
    uiState.value = 'error';
  }
}

function clearAll() {
  selectedFile.value = null;
  if (fileInput.value) fileInput.value.value = '';
  result.value = null;
  errorText.value = '';
  uiState.value = 'idle';
}
</script>

<template>
  <main class="page">
    <section class="shell">
      <header class="topbar">
        <div>
          <p class="eyebrow">Tencent Cloud ASR Flash</p>
          <h1>录音文件识别极速版 Demo</h1>
          <p class="desc">
            浏览器上传本地音频文件，后端直接把原始二进制提交腾讯云极速版。
          </p>
        </div>
        <span class="badge" :class="uiState">{{ stateLabel }}</span>
      </header>

      <form class="form" :aria-busy="isRecognizing" @submit.prevent="recognize">
        <div class="field upload-field">
          <span>本地音频文件</span>
          <label
            class="upload-zone"
            :class="{ selected: selectedFile, disabled: isRecognizing }"
          >
            <input
              ref="fileInput"
              class="file-input"
              type="file"
              required
              :disabled="isRecognizing"
              accept=".wav,.pcm,.ogg,.opus,.speex,.spx,.silk,.mp3,.m4a,.aac,.amr"
              aria-label="选择本地音频文件"
              aria-describedby="file-constraints"
              @change="handleFileChange"
            />
            <span class="upload-icon" aria-hidden="true">↑</span>
            <span class="upload-copy">
              <strong>{{ selectedFile?.name || '点击选择或拖拽音频文件到这里' }}</strong>
              <span v-if="selectedFile">
                {{ formatBytes(selectedFile.size) }} · {{ voiceFormat.toUpperCase() }} · 点击更换
              </span>
              <span v-else>支持 MP3、WAV、M4A 等格式，最大 100MB</span>
            </span>
          </label>
        </div>

        <label class="field format-field">
          <span>识别格式</span>
          <select v-model="voiceFormat" :disabled="isRecognizing || !selectedFile">
            <option value="mp3">MP3</option>
            <option value="wav">WAV</option>
            <option value="m4a">M4A</option>
            <option value="aac">AAC</option>
            <option value="ogg-opus">OGG-OPUS</option>
            <option value="pcm">PCM</option>
            <option value="amr">AMR</option>
            <option value="speex">SPEEX</option>
            <option value="silk">SILK</option>
          </select>
          <small>已根据扩展名自动选择，可手动修正。</small>
        </label>

        <div class="actions">
          <button class="primary" type="submit" :disabled="isRecognizing || !selectedFile">
            {{ isRecognizing ? '识别中...' : '开始识别' }}
          </button>
          <button
            class="secondary"
            type="button"
            :disabled="isRecognizing || !canClear"
            @click="clearAll"
          >
            清空
          </button>
        </div>
      </form>

      <p id="file-constraints" class="hint">
        文件直接从浏览器上传后端，不经过云盘；支持 100MB、2 小时以内的音频。
      </p>
      <div class="status" role="status" aria-live="polite">{{ statusText }}</div>
      <div v-if="errorText" class="error" role="alert">{{ errorText }}</div>

      <section v-if="result" class="summary">
        <span>时长 {{ formatTime(result.audioDuration) }}</span>
        <span>大小 {{ formatBytes(result.sourceBytes) }}</span>
        <span>request_id {{ result.requestId }}</span>
      </section>

      <section class="panel">
        <h2>完整识别文本</h2>
        <pre>{{ previewText }}</pre>
      </section>

      <section class="panel">
        <h2>每个人说话内容</h2>
        <div v-if="speakerGroups.length" class="speaker-grid">
          <article v-for="group in speakerGroups" :key="group.speakerId" class="speaker-card">
            <strong>{{ speakerLabel(group.speakerId) }}</strong>
            <p>{{ group.texts.join('') }}</p>
          </article>
        </div>
        <p v-else class="empty">
          {{ result ? '没有返回带 speaker_id 的分句结果。' : '识别完成后，这里会按说话人汇总内容。' }}
        </p>
      </section>

      <section class="panel">
        <h2>对话流水</h2>
        <div v-if="result?.sentences.length" class="rows">
          <article
            v-for="(sentence, index) in result.sentences"
            :key="`${sentence.channelId}-${sentence.startTime}-${index}`"
            class="row"
          >
            <span class="time">{{ formatTime(sentence.startTime) }}–{{ formatTime(sentence.endTime) }}</span>
            <strong>{{ speakerLabel(sentence.speakerId) }}</strong>
            <p>{{ sentence.text }}</p>
          </article>
        </div>
        <p v-else class="empty">
          {{ result ? '腾讯云未返回分句结果。' : '识别完成后，这里会按时间展示对话。' }}
        </p>
      </section>
    </section>
  </main>
</template>

<style>
:root {
  color: #1f2937;
  background: #f6f7fb;
  font-family:
    Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI",
    sans-serif;
}

* {
  box-sizing: border-box;
}

body {
  min-width: 320px;
  margin: 0;
}

button,
input,
select {
  font: inherit;
}

.page {
  min-height: 100vh;
  padding: 32px 16px;
}

.shell {
  width: min(960px, 100%);
  margin: 0 auto;
}

.topbar {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 20px;
  margin-bottom: 22px;
}

.eyebrow,
h1,
h2,
p {
  margin: 0;
}

.eyebrow {
  margin-bottom: 8px;
  color: #2563eb;
  font-size: 13px;
  font-weight: 700;
}

h1 {
  font-size: clamp(28px, 4vw, 42px);
}

h2 {
  margin-bottom: 12px;
  font-size: 18px;
}

.desc {
  max-width: 680px;
  margin-top: 10px;
  color: #6b7280;
  line-height: 1.7;
}

.badge {
  flex: none;
  border: 1px solid #d1d5db;
  border-radius: 999px;
  padding: 7px 12px;
  background: white;
  color: #4b5563;
  font-size: 13px;
  font-weight: 700;
}

.badge.recognizing {
  border-color: #93c5fd;
  color: #1d4ed8;
}

.badge.done {
  border-color: #86efac;
  color: #15803d;
}

.badge.error {
  border-color: #fecaca;
  color: #b91c1c;
}

.form,
.status,
.error,
.panel,
.summary {
  border: 1px solid #e5e7eb;
  border-radius: 10px;
  background: white;
}

.form {
  display: grid;
  grid-template-columns: 180px minmax(0, 1fr);
  gap: 14px;
  padding: 18px;
}

.field {
  display: grid;
  gap: 8px;
  color: #374151;
  font-size: 14px;
  font-weight: 700;
}

.field select {
  min-height: 44px;
  width: 100%;
  border: 1px solid #d1d5db;
  border-radius: 8px;
  padding: 0 12px;
  outline: none;
  background: white;
  color: #111827;
}

.field small {
  color: #6b7280;
  font-size: 12px;
  font-weight: 400;
}

.field select:focus {
  border-color: #2563eb;
  box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.12);
}

.upload-field {
  grid-column: 1 / -1;
}

.upload-zone {
  position: relative;
  display: flex;
  align-items: center;
  gap: 14px;
  min-height: 112px;
  overflow: hidden;
  border: 1px dashed #93c5fd;
  border-radius: 10px;
  padding: 20px;
  background: #f8fbff;
  cursor: pointer;
}

.upload-zone:not(.disabled):hover,
.upload-zone:focus-within {
  border-color: #2563eb;
  box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.1);
}

.upload-zone.selected {
  border-style: solid;
  background: #eff6ff;
}

.upload-zone.disabled {
  cursor: not-allowed;
  opacity: 0.7;
}

.file-input {
  position: absolute;
  z-index: 1;
  inset: 0;
  width: 100%;
  height: 100%;
  opacity: 0;
  cursor: pointer;
}

.file-input:disabled {
  cursor: not-allowed;
}

.upload-icon {
  display: grid;
  flex: none;
  width: 44px;
  height: 44px;
  place-items: center;
  border-radius: 50%;
  background: #dbeafe;
  color: #1d4ed8;
  font-size: 24px;
}

.upload-copy {
  display: grid;
  min-width: 0;
  gap: 6px;
}

.upload-copy strong {
  overflow: hidden;
  color: #111827;
  font-size: 15px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.upload-copy span {
  color: #6b7280;
  font-size: 13px;
  font-weight: 400;
}

.actions {
  display: flex;
  align-items: flex-end;
  justify-content: flex-end;
  gap: 12px;
}

button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  min-height: 44px;
  border: 0;
  border-radius: 8px;
  padding: 0 18px;
  cursor: pointer;
  font-weight: 700;
}

button:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}

.primary {
  min-width: 132px;
  background: #2563eb;
  color: white;
}

.secondary {
  border: 1px solid #d1d5db;
  background: white;
  color: #374151;
}

.hint {
  margin: 10px 2px 0;
  color: #6b7280;
  font-size: 13px;
}

.status,
.error {
  margin-top: 12px;
  padding: 12px 14px;
}

.error {
  border-color: #fecaca;
  background: #fef2f2;
  color: #991b1b;
}

.summary {
  display: flex;
  flex-wrap: wrap;
  gap: 10px 20px;
  margin-top: 14px;
  padding: 12px 14px;
  color: #4b5563;
  font-size: 14px;
}

.panel {
  margin-top: 14px;
  padding: 18px;
}

pre {
  min-height: 64px;
  margin: 0;
  overflow-wrap: anywhere;
  white-space: pre-wrap;
  color: #111827;
  font-family: inherit;
  line-height: 1.7;
}

.speaker-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 12px;
}

.speaker-card {
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  padding: 14px;
  background: #f9fafb;
}

.speaker-card strong,
.row strong {
  color: #2563eb;
}

.speaker-card p,
.row p {
  margin-top: 8px;
  overflow-wrap: anywhere;
  line-height: 1.7;
}

.summary span {
  overflow-wrap: anywhere;
}

.rows {
  display: grid;
  gap: 12px;
}

.row {
  display: grid;
  grid-template-columns: 100px 100px 1fr;
  gap: 12px;
  align-items: start;
  border-top: 1px solid #f3f4f6;
  padding-top: 12px;
}

.row:first-child {
  border-top: 0;
  padding-top: 0;
}

.time,
.empty {
  color: #6b7280;
}

@media (max-width: 640px) {
  .topbar,
  .actions {
    flex-direction: column;
  }

  .form,
  .row {
    grid-template-columns: 1fr;
  }

  .actions {
    grid-column: auto;
    align-items: stretch;
  }

  .actions button {
    width: 100%;
  }
}
</style>
