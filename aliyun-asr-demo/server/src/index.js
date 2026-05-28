import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { WebSocketServer } from "ws";
import { createAsrProxy } from "./asrProxy.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({
  path: path.resolve(__dirname, "../.env")
});

const app = express();
const port = Number(process.env.PORT || 3001);

app.use(cors());
app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    service: "typeless-web-demo-server"
  });
});

const server = http.createServer(app);

const wss = new WebSocketServer({
  server,
  path: "/voice"
});

wss.on("connection", (clientWs) => {
  createAsrProxy(clientWs);
});

server.listen(port, () => {
  console.log(`Voice server running at http://localhost:${port}`);
  console.log(`WebSocket endpoint: ws://localhost:${port}/voice`);
});
