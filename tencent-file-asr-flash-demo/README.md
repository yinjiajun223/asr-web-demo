# Tencent File ASR Flash Demo

腾讯云录音文件识别极速版 Demo：用户在浏览器选择本地音频，浏览器把文件原始二进制上传到 Node 后端，后端直接提交腾讯云并返回识别文本和 `speaker_id`。

```text
本地音频文件 → 浏览器上传 → Node 后端 → 腾讯极速版 → 文本与说话人分组
```

不接收云盘地址，不经过云盘，也不使用 URL、Base64 或 multipart 表单。

## 启动

服务默认按以下顺序读取环境变量，已有腾讯云凭证无需复制：

1. `server/src/.env`
2. `server/.env`
3. `../tencent-speaker-diarization-demo/server/.env`
4. `../tencent-asr-demo/server/.env`

```bash
cd tencent-file-asr-flash-demo
npm install
npm run dev
```

打开 http://localhost:5176，选择本地音频文件并开始识别。

## 接口

前端直接把 `File` 作为请求 Body：

```http
POST /api/recognize-file
Content-Type: application/octet-stream
X-Audio-Format: mp3

<音频文件原始二进制>
```

后端不会解析文件路径或 URL，只接收本次请求上传的音频内容。

## 限制

- 支持 `wav`、`pcm`、`ogg-opus`、`speex`、`silk`、`mp3`、`m4a`、`aac`、`amr`。
- 文件最大 100MB，音频时长不超过 2 小时。
- 说话人分离使用 `speaker_diarization=1`，默认引擎为 `16k_zh`。
- 页面会根据扩展名推断格式，也可以手动修正；选择的格式必须与文件真实编码一致。
- Demo 为了保持实现简单，会在内存中缓存单个音频；高并发生产环境应改成临时文件或受控流式管道。

腾讯云接口说明：https://cloud.tencent.com/document/product/1093/52097
