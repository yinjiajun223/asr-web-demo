# ASR Web Demo

基于主流云平台语音识别的**网页端语音能力**示例集，包含智能语音输入、说话人分离和音频文件识别。

A collection of **browser-based speech** demos using mainstream cloud ASR services, covering smart voice input, speaker diarization, and audio file transcription.

---

[中文说明](#中文说明) | [English](#english)

---

## 中文说明

本仓库包含四个独立 Demo：阿里云百炼智能语音输入、腾讯云智能语音输入、腾讯云实时说话人分离、腾讯云录音文件识别极速版。

### Demo 对比

| | [阿里云百炼 Demo](aliyun-asr-demo/) | [腾讯云 Demo](tencent-asr-demo/) | [腾讯云说话人分离 Demo](tencent-speaker-diarization-demo/) | [腾讯云文件识别极速版 Demo](tencent-file-asr-flash-demo/) |
|---|---|---|---|---|
| **云平台** | 阿里云百炼 (DashScope) | 腾讯云 (Tencent Cloud) | 腾讯云 (Tencent Cloud) | 腾讯云 (Tencent Cloud) |
| **前端框架** | React 18 (JSX) | Vue 3 + TypeScript | Vue 3 + TypeScript | Vue 3 + TypeScript |
| **核心能力** | 智能语音输入 | 智能语音输入 | 实时说话人分离 | 本地音频文件识别 |
| **语音识别** | Qwen-ASR Realtime WebSocket | 腾讯云实时 ASR WebSocket | 腾讯云实时 ASR WebSocket | 腾讯云录音文件识别极速版 HTTPS |
| **ASR 模型** | `qwen3-asr-flash-realtime` | `16k_zh` | `16k_zh_en_speaker` | `16k_zh` |
| **音频处理** | AudioWorklet | ScriptProcessorNode | ScriptProcessorNode | 浏览器上传本地文件 |
| **ASR 连接方式** | 后端 WebSocket 代理 | 前端直连（后端签名 URL） | 前端直连（后端签名 URL） | 后端 HTTPS 二进制上传 |
| **AI 润色** | 流式输出 (final_delta 逐字动画) | 非流式 (POST /api/polish) | 无 | 无 |
| **润色模型** | qwen-plus (DashScope) | 可选，兼容 OpenAI API | 无 | 无 |
| **后端端口** | 3001 | 3002 | 3003 | 3004 |
| **前端端口** | 5173 | 5174 | 5175 | 5176 |

### 共同特性

- 实时 Demo 使用浏览器麦克风采集并预览识别结果
- 文件 Demo 由浏览器上传本地音频，后端直接提交腾讯极速版
- 语音输入 Demo 停止录音后自动调用大模型整理文本，并插入页面输入框光标位置
- 说话人分离 Demo 按腾讯云返回的 `speaker_id` 汇总多人对话内容
- API Key 仅存于后端，不暴露到浏览器
- 麦克风 Demo 仅在 `localhost` 可直接运行，线上部署需 HTTPS

### 快速开始

#### 阿里云百炼 Demo

```bash
cd aliyun-asr-demo
npm install
cp server/.env.example server/.env
# 编辑 server/.env，填入 DASHSCOPE_API_KEY
npm run dev
# 打开 http://localhost:5173
```

#### 腾讯云 Demo

```bash
cd tencent-asr-demo
npm install
cp server/.env.example server/.env
# 编辑 server/.env，填入 TENCENT_SECRET_ID / TENCENT_SECRET_KEY / TENCENT_APP_ID
npm run dev
# 打开 http://localhost:5174
```

#### 腾讯云说话人分离 Demo

```bash
cd tencent-speaker-diarization-demo
npm install
cp server/.env.example server/.env
# 编辑 server/.env，填入 TENCENT_SECRET_ID / TENCENT_SECRET_KEY / TENCENT_APP_ID
npm run dev
# 打开 http://localhost:5175
```

#### 腾讯云录音文件识别极速版 Demo

```bash
cd tencent-file-asr-flash-demo
npm install
# 优先复用 server/src/.env 中已有的腾讯云凭证
npm run dev
# 打开 http://localhost:5176
```

---

## English

This repository contains four independent demos: Alibaba Bailian smart voice input, Tencent Cloud smart voice input, Tencent Cloud real-time speaker diarization, and Tencent Cloud flash file transcription.

### Demo Comparison

| | [Alibaba Bailian Demo](aliyun-asr-demo/) | [Tencent Cloud Demo](tencent-asr-demo/) | [Tencent Speaker Diarization Demo](tencent-speaker-diarization-demo/) | [Tencent Flash File ASR Demo](tencent-file-asr-flash-demo/) |
|---|---|---|---|---|
| **Cloud Platform** | Alibaba Bailian (DashScope) | Tencent Cloud | Tencent Cloud | Tencent Cloud |
| **Frontend** | React 18 (JSX) | Vue 3 + TypeScript | Vue 3 + TypeScript | Vue 3 + TypeScript |
| **Core Feature** | Smart voice input | Smart voice input | Real-time speaker diarization | Local audio file transcription |
| **ASR** | Qwen-ASR Realtime WebSocket | Tencent Realtime ASR WebSocket | Tencent Realtime ASR WebSocket | Tencent Flash File ASR HTTPS |
| **ASR Model** | `qwen3-asr-flash-realtime` | `16k_zh` | `16k_zh_en_speaker` | `16k_zh` |
| **Audio** | AudioWorklet | ScriptProcessorNode | ScriptProcessorNode | Browser uploads a local file |
| **ASR Connection** | Backend WebSocket proxy | Frontend direct (backend signs URL) | Frontend direct (backend signs URL) | Backend binary HTTPS upload |
| **Polish** | Streaming (typewriter animation) | Non-streaming (POST /api/polish) | None | None |
| **Polish Model** | qwen-plus (DashScope) | Optional, OpenAI-compatible | None | None |
| **Backend Port** | 3001 | 3002 | 3003 | 3004 |
| **Frontend Port** | 5173 | 5174 | 5175 | 5176 |

### Common Features

- Real-time demos capture the browser microphone and preview ASR results
- The file demo uploads local audio from the browser and submits it to Tencent Flash ASR through the backend
- Voice input demos auto-polish text after stopping and insert it at the cursor position
- Speaker diarization demo groups dialogue by Tencent Cloud `speaker_id`
- API keys stay server-side, never exposed to browser
- Microphone demos use `getUserMedia`, which requires `localhost` or HTTPS

### Quick Start

#### Alibaba Bailian Demo

```bash
cd aliyun-asr-demo
npm install
cp server/.env.example server/.env
# Edit server/.env, set DASHSCOPE_API_KEY
npm run dev
# Open http://localhost:5173
```

#### Tencent Cloud Demo

```bash
cd tencent-asr-demo
npm install
cp server/.env.example server/.env
# Edit server/.env, set TENCENT_SECRET_ID / TENCENT_SECRET_KEY / TENCENT_APP_ID
npm run dev
# Open http://localhost:5174
```

#### Tencent Speaker Diarization Demo

```bash
cd tencent-speaker-diarization-demo
npm install
cp server/.env.example server/.env
# Edit server/.env, set TENCENT_SECRET_ID / TENCENT_SECRET_KEY / TENCENT_APP_ID
npm run dev
# Open http://localhost:5175
```

#### Tencent Flash File ASR Demo

```bash
cd tencent-file-asr-flash-demo
npm install
# Reuses existing Tencent credentials from server/src/.env first
npm run dev
# Open http://localhost:5176
```

---

## License

MIT
