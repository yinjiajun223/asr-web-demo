import 'dotenv/config';
import cors from 'cors';
import express from 'express';
import { buildTencentAsrWsUrl } from './tencentAsrSign.js';
import { polishText } from './polish.js';

const app = express();
const port = Number.parseInt(process.env.PORT || '3002', 10);
const clientOrigin = process.env.CLIENT_ORIGIN || 'http://localhost:5173';

app.use(
  cors({
    origin: clientOrigin,
  }),
);
app.use(express.json({ limit: '1mb' }));

app.get('/api/health', (_req, res) => {
  res.json({ ok: true });
});

app.get('/api/tencent-asr-url', async (_req, res) => {
  try {
    const url = await buildTencentAsrWsUrl();
    res.json({ url });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

app.post('/api/polish', async (req, res) => {
  const rawText = String(req.body?.rawText || '').trim();

  if (!rawText) {
    res.status(400).json({ error: 'rawText is required' });
    return;
  }

  try {
    const result = await polishText(rawText);
    res.json(result);
  } catch (error) {
    res.json({
      text: rawText,
      polished: false,
      warning:
        error instanceof Error
          ? `智能整理失败，已返回原始识别文本：${error.message}`
          : '智能整理失败，已返回原始识别文本。',
    });
  }
});

app.listen(port, () => {
  console.log(`Tencent ASR demo server running at http://localhost:${port}`);
});
