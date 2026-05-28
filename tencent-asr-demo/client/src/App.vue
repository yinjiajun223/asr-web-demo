<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useTencentAsr } from './composables/useTencentAsr';

type UiState =
  | 'idle'
  | 'connecting'
  | 'recording'
  | 'stopping'
  | 'polishing'
  | 'done'
  | 'error';

const API_BASE = import.meta.env.VITE_API_BASE || '';

const textareaRef = ref<HTMLTextAreaElement | null>(null);
const textValue = ref('');
const rawFinalText = ref('');
const polishedText = ref('');
const uiState = ref<UiState>('idle');
const statusText = ref('点击按钮开始语音输入。');
const warningText = ref('');

const asr = useTencentAsr({
  urlFetcher: async () => {
    const res = await fetch(`${API_BASE}/api/tencent-asr-url`);
    const data = await res.json();

    if (!res.ok || !data.url) {
      throw new Error(data.error || '获取腾讯云 ASR 签名 URL 失败');
    }

    return data.url;
  },
});

const buttonText = computed(() => {
  if (uiState.value === 'connecting') return '连接中...';
  if (uiState.value === 'recording') return '停止并整理';
  if (uiState.value === 'stopping') return '结束识别中...';
  if (uiState.value === 'polishing') return '智能整理中...';
  return '开始语音输入';
});

const buttonDisabled = computed(() => {
  return ['connecting', 'stopping', 'polishing'].includes(uiState.value);
});

const previewText = computed(() => {
  if (asr.result.value) return asr.result.value;
  if (uiState.value === 'recording') return '正在听你说话...';
  return '这里会显示腾讯云 ASR 的实时识别结果。';
});

watch(asr.error, (value) => {
  if (!value) return;
  uiState.value = 'error';
  statusText.value = value.error;
});

async function toggleVoiceInput() {
  warningText.value = '';

  if (!asr.isSupported.value) {
    uiState.value = 'error';
    statusText.value = '当前浏览器不支持麦克风录音，请使用最新版 Chrome / Edge。';
    return;
  }

  if (asr.isListening.value || uiState.value === 'recording') {
    await stopAndInsert();
    return;
  }

  await startVoiceInput();
}

async function startVoiceInput() {
  uiState.value = 'connecting';
  statusText.value = '正在获取麦克风权限和腾讯云 ASR 签名 URL...';
  rawFinalText.value = '';
  polishedText.value = '';

  await asr.start();

  if (asr.error.value) {
    uiState.value = 'error';
    statusText.value = asr.error.value.error;
    return;
  }

  uiState.value = 'recording';
  statusText.value = '正在录音，腾讯云 ASR 会实时返回识别内容。';
}

async function stopAndInsert() {
  uiState.value = 'stopping';
  statusText.value = '正在停止录音并等待最终识别结果...';

  const rawText = (await asr.stop()).trim();
  rawFinalText.value = rawText;

  if (!rawText) {
    uiState.value = 'idle';
    statusText.value = '没有识别到有效内容，请重新尝试。';
    return;
  }

  uiState.value = 'polishing';
  statusText.value = '识别完成，正在进行智能整理...';

  const finalText = await polishText(rawText);
  polishedText.value = finalText;
  insertAtCursor(finalText);

  uiState.value = 'done';
  statusText.value = '已插入整理后的文本。';
}

async function polishText(rawText: string): Promise<string> {
  try {
    const res = await fetch(`${API_BASE}/api/polish`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ rawText }),
    });

    const data = await res.json();

    if (!res.ok || !data.text) {
      warningText.value = data.error || '智能整理失败，已使用原始识别文本。';
      return rawText;
    }

    if (data.warning) {
      warningText.value = data.warning;
    } else if (!data.polished) {
      warningText.value = '未配置智能整理模型，已使用原始识别文本。';
    }

    return String(data.text).trim() || rawText;
  } catch (error) {
    warningText.value =
      error instanceof Error
        ? `智能整理请求失败，已使用原始识别文本：${error.message}`
        : '智能整理请求失败，已使用原始识别文本。';
    return rawText;
  }
}

function insertAtCursor(insertText: string) {
  const textarea = textareaRef.value;

  if (!textarea) {
    textValue.value += insertText;
    return;
  }

  const start = textarea.selectionStart ?? textValue.value.length;
  const end = textarea.selectionEnd ?? textValue.value.length;
  const before = textValue.value.slice(0, start);
  const after = textValue.value.slice(end);
  const separator = before && !before.endsWith('\n') ? '\n' : '';
  const nextValue = `${before}${separator}${insertText}${after}`;

  textValue.value = nextValue;

  requestAnimationFrame(() => {
    const cursor = before.length + separator.length + insertText.length;
    textarea.focus();
    textarea.selectionStart = cursor;
    textarea.selectionEnd = cursor;
  });
}

function clearAll() {
  textValue.value = '';
  rawFinalText.value = '';
  polishedText.value = '';
  warningText.value = '';
  statusText.value = '已清空。';
  uiState.value = 'idle';
}
</script>

<template>
  <main class="page">
    <section class="card">
      <div class="header">
        <div>
          <p class="eyebrow">Tencent Cloud ASR Demo</p>
          <h1>网页按钮智能语音输入</h1>
          <p class="desc">
            点击按钮录音，腾讯云实时识别；停止后可调用大模型整理，再插入输入框。
          </p>
        </div>
        <span class="badge" :class="uiState">{{ uiState }}</span>
      </div>

      <textarea
        ref="textareaRef"
        v-model="textValue"
        class="editor"
        placeholder="整理后的文本会插入到这里。也可以先手动输入内容，再把光标放到需要插入的位置。"
      />

      <div class="actions">
        <button
          class="primary"
          :class="{ recording: uiState === 'recording' }"
          :disabled="buttonDisabled"
          @click="toggleVoiceInput"
        >
          {{ buttonText }}
        </button>
        <button class="secondary" :disabled="buttonDisabled" @click="clearAll">
          清空
        </button>
      </div>

      <div class="status">{{ statusText }}</div>
      <div v-if="warningText" class="warning">{{ warningText }}</div>

      <section class="panel">
        <h2>实时识别预览</h2>
        <p>{{ previewText }}</p>
      </section>

      <section v-if="rawFinalText || polishedText" class="grid">
        <div class="panel">
          <h2>原始识别</h2>
          <p>{{ rawFinalText || '暂无' }}</p>
        </div>
        <div class="panel">
          <h2>智能整理后</h2>
          <p>{{ polishedText || '暂无' }}</p>
        </div>
      </section>
    </section>
  </main>
</template>
