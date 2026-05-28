# ASR Web Demo

基于主流云平台实时语音识别的**网页端智能语音输入**示例集。录音 → 实时转写 → AI 润色 → 填入输入框。

A collection of **browser-based smart voice input** demos using mainstream cloud ASR services. Record → real-time transcription → AI polish → insert into textarea.

---

[中文说明](#中文说明) | [English](#english)

---

## 中文说明

本仓库包含两个独立的语音输入 Demo，分别基于阿里云百炼和腾讯云实时语音识别。

### Demo 对比

| | [阿里云百炼 Demo](aliyun-asr-demo/) | [腾讯云 Demo](tencent-asr-demo/) |
|---|---|---|
| **云平台** | 阿里云百炼 (DashScope) | 腾讯云 (Tencent Cloud) |
| **前端框架** | React 18 (JSX) | Vue 3 + TypeScript |
| **语音识别** | Qwen-ASR Realtime WebSocket | 腾讯云实时 ASR WebSocket |
| **ASR 模型** | `qwen3-asr-flash-realtime` | `16k_zh` |
| **音频处理** | AudioWorklet | ScriptProcessorNode |
| **ASR 连接方式** | 后端 WebSocket 代理 | 前端直连（后端签名 URL） |
| **AI 润色** | 流式输出 (final_delta 逐字动画) | 非流式 (POST /api/polish) |
| **润色模型** | qwen-plus (DashScope) | 可选，兼容 OpenAI API |
| **后端端口** | 3001 | 3002 |
| **前端端口** | 5173 | 5174 |

### 共同特性

- 浏览器麦克风采集 → 实时语音识别预览
- 停止录音后自动调用大模型整理文本（去口语化、补标点、修正错别字、识别自我修正）
- 整理结果自动插入页面输入框光标位置
- API Key 仅存于后端，不暴露到浏览器
- 仅 `localhost` 可直接使用麦克风，线上部署需 HTTPS

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

---

## English

This repository contains two independent voice input demos powered by Alibaba Cloud Bailian and Tencent Cloud real-time ASR respectively.

### Demo Comparison

| | [Alibaba Bailian Demo](aliyun-asr-demo/) | [Tencent Cloud Demo](tencent-asr-demo/) |
|---|---|---|
| **Cloud Platform** | Alibaba Bailian (DashScope) | Tencent Cloud |
| **Frontend** | React 18 (JSX) | Vue 3 + TypeScript |
| **ASR** | Qwen-ASR Realtime WebSocket | Tencent Realtime ASR WebSocket |
| **ASR Model** | `qwen3-asr-flash-realtime` | `16k_zh` |
| **Audio** | AudioWorklet | ScriptProcessorNode |
| **ASR Connection** | Backend WebSocket proxy | Frontend direct (backend signs URL) |
| **Polish** | Streaming (typewriter animation) | Non-streaming (POST /api/polish) |
| **Polish Model** | qwen-plus (DashScope) | Optional, OpenAI-compatible |
| **Backend Port** | 3001 | 3002 |
| **Frontend Port** | 5173 | 5174 |

### Common Features

- Browser mic capture with real-time ASR preview
- Auto text polish after stopping (removes filler words, fixes punctuation/typos, resolves self-corrections)
- Polished text auto-inserted at cursor position
- API keys stay server-side, never exposed to browser
- getUserMedia works on `localhost`; HTTPS required for production deployments

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

---

## License

MIT
