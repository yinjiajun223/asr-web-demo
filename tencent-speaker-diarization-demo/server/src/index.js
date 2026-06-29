import http from 'node:http';
import { buildTencentSpeakerWsUrl } from './tencentSpeakerSign.js';

const port = Number.parseInt(process.env.PORT || '3003', 10);

function json(res, status, payload) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'access-control-allow-origin': '*',
  });
  res.end(JSON.stringify(payload));
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET, OPTIONS',
    });
    res.end();
    return;
  }

  if (req.method === 'GET' && req.url === '/api/health') {
    json(res, 200, { ok: true });
    return;
  }

  if (req.method === 'GET' && req.url === '/api/tencent-speaker-url') {
    try {
      json(res, 200, { url: await buildTencentSpeakerWsUrl() });
    } catch (error) {
      json(res, 500, {
        error: error instanceof Error ? error.message : String(error),
      });
    }
    return;
  }

  json(res, 404, { error: 'Not found' });
});

server.listen(port, () => {
  console.log(`Tencent speaker demo server running at http://localhost:${port}`);
});
