# Tencent Speaker Diarization Demo

腾讯云实时说话人分离 demo。默认复用 `../tencent-asr-demo/server/.env` 里的 `TENCENT_SECRET_ID`、`TENCENT_SECRET_KEY`、`TENCENT_APP_ID`。

如果想单独配置：

```bash
cp server/.env.example server/.env
```

```bash
cd tencent-speaker-diarization-demo
npm install
npm run dev
```

打开 http://localhost:5175

这个 demo 做的是说话人分离：输出 `说话人 1 / 说话人 2`。如果要识别真实姓名，需要另接声纹注册和验证流程。
