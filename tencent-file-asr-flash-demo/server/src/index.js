import http from 'node:http';
import {
  loadFlashEnv,
  readAudioBody,
  recognizeAudio,
} from './tencentFlash.js';

loadFlashEnv();

const port = Number.parseInt(process.env.TENCENT_FLASH_PORT || '3004', 10);
const clientOrigin =
  process.env.TENCENT_FLASH_CLIENT_ORIGIN || 'http://localhost:5176';

function json(res, status, payload) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'access-control-allow-origin': clientOrigin,
  });
  res.end(JSON.stringify(payload));
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'access-control-allow-origin': clientOrigin,
      'access-control-allow-methods': 'GET, POST, OPTIONS',
      'access-control-allow-headers': 'content-type, x-audio-format',
    });
    res.end();
    return;
  }

  const pathname = new URL(req.url || '/', 'http://localhost').pathname;

  if (req.method === 'GET' && pathname === '/api/health') {
    json(res, 200, { ok: true });
    return;
  }

  if (req.method === 'POST' && pathname === '/api/recognize-file') {
    try {
      if (req.headers['content-type'] !== 'application/octet-stream') {
        const error = new Error('请以 application/octet-stream 上传音频文件。');
        error.statusCode = 415;
        throw error;
      }

      const audio = await readAudioBody(req);
      const result = await recognizeAudio({
        audio,
        voiceFormat: req.headers['x-audio-format'],
      });
      json(res, 200, result);
    } catch (error) {
      const statusCode = Number(error?.statusCode);
      json(res, Number.isInteger(statusCode) ? statusCode : 500, {
        error: error instanceof Error ? error.message : String(error),
      });
    }
    return;
  }

  json(res, 404, { error: 'Not found' });
});

server.listen(port, '127.0.0.1', () => {
  console.log(`Tencent file ASR flash demo server running at http://localhost:${port}`);
});
