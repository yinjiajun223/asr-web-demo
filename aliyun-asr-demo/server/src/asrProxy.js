import { WebSocket } from "ws";
import crypto from "node:crypto";
import { getPolishModel, polishTextStream } from "./polish.js";

function uuid() {
  return crypto.randomUUID();
}

function sendJson(ws, payload) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(payload));
  }
}

function isDebugEnabled() {
  return process.env.DEBUG_ASR_EVENTS !== "false";
}

function logAsr(message, data = {}) {
  if (!isDebugEnabled()) {
    return;
  }

  console.log("[asr]", message, data);
}

function getDashScopeWsBase() {
  const region = process.env.DASHSCOPE_REGION || "cn";

  if (region === "intl") {
    return "wss://dashscope-intl.aliyuncs.com/api-ws/v1/realtime";
  }

  if (region === "us") {
    return "wss://dashscope-us.aliyuncs.com/api-ws/v1/realtime";
  }

  return "wss://dashscope.aliyuncs.com/api-ws/v1/realtime";
}

function safeClose(ws) {
  try {
    if (
      ws &&
      (ws.readyState === WebSocket.OPEN ||
        ws.readyState === WebSocket.CONNECTING)
    ) {
      ws.close();
    }
  } catch {
    // ignore close errors
  }
}

function closeSoon(ws) {
  setTimeout(() => {
    safeClose(ws);
  }, 50);
}

export function createAsrProxy(clientWs) {
  const apiKey = process.env.DASHSCOPE_API_KEY;

  if (!apiKey) {
    sendJson(clientWs, {
      type: "error",
      message: "Missing DASHSCOPE_API_KEY in server/.env"
    });
    safeClose(clientWs);
    return;
  }

  const model = process.env.ASR_MODEL || "qwen3-asr-flash-realtime";
  const language = process.env.DEFAULT_LANGUAGE || "zh";

  if (!model.includes("realtime")) {
    sendJson(clientWs, {
      type: "error",
      message: `ASR_MODEL must be a realtime ASR model, got "${model}". Use qwen3-asr-flash-realtime for this WebSocket demo.`
    });
    safeClose(clientWs);
    return;
  }

  const aliyunUrl = `${getDashScopeWsBase()}?model=${encodeURIComponent(model)}`;

  const asrWs = new WebSocket(aliyunUrl, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "OpenAI-Beta": "realtime=v1",
      "user-agent": "typeless-web-demo/0.1"
    }
  });

  let asrReady = false;
  let clientClosed = false;
  let lastAsrError = "";
  let lastAsrClose = "";
  let isFinalizing = false;
  let stopRequested = false;
  let receivedCompleted = false;
  let finishSent = false;
  let audioChunkCount = 0;
  let audioByteCount = 0;
  let clientSessionFinishedSent = false;

  function finishClientSession() {
    if (clientSessionFinishedSent) {
      return;
    }

    clientSessionFinishedSent = true;
    sendJson(clientWs, {
      type: "session_finished"
    });
    closeSoon(asrWs);

    if (!clientClosed) {
      closeSoon(clientWs);
    }
  }

  function sendSessionFinish() {
    if (finishSent || asrWs.readyState !== WebSocket.OPEN) {
      return;
    }

    finishSent = true;
    logAsr("send session.finish", {
      audioChunkCount,
      audioByteCount
    });

    asrWs.send(
      JSON.stringify({
        event_id: uuid(),
        type: "session.finish"
      })
    );
  }

  asrWs.on("open", () => {
    const sessionUpdate = {
      event_id: uuid(),
      type: "session.update",
      session: {
        modalities: ["text"],
        input_audio_format: "pcm",
        sample_rate: 16000,
        turn_detection: null
      }
    };

    logAsr("send session.update", {
      model,
      language,
      turnDetection: sessionUpdate.session.turn_detection
    });

    asrWs.send(JSON.stringify(sessionUpdate));
  });

  asrWs.on("message", async (raw) => {
    let event;

    try {
      event = JSON.parse(raw.toString());

    } catch {
      return;
    }

    logAsr("recv event", {
      type: event.type,
      stopRequested,
      receivedCompleted,
      finishSent,
      textLength: (event.text || event.transcript || "").length
    });

    switch (event.type) {
      case "session.created": {
        break;
      }

      case "session.updated": {
        asrReady = true;
        sendJson(clientWs, {
          type: "ready"
        });
        break;
      }

      case "input_audio_buffer.speech_started": {
        sendJson(clientWs, {
          type: "speech_started"
        });
        break;
      }

      case "input_audio_buffer.committed": {
        break;
      }

      case "conversation.item.input_audio_transcription.text": {
        const text = `${event.text || ""}${event.stash || ""}`;

        sendJson(clientWs, {
          type: "preview",
          text
        });
        break;
      }

      case "conversation.item.input_audio_transcription.completed": {
        if (!stopRequested) {
          break;
        }

        if (isFinalizing) {
          break;
        }

        isFinalizing = true;
        receivedCompleted = true;
        const finalizeStart = performance.now();
        const rawText = (event.transcript || event.text || "").trim();

        if (!rawText) {
          sendJson(clientWs, {
            type: "raw_final",
            text: ""
          });
          sendJson(clientWs, {
            type: "final",
            rawText: "",
            text: "",
            polishMs: Math.round(performance.now() - finalizeStart),
            finalizeMs: Math.round(performance.now() - finalizeStart),
            llmMs: 0,
            polishModel: getPolishModel()
          });
          finishClientSession();
          break;
        }

        sendJson(clientWs, {
          type: "raw_final",
          text: rawText
        });

        try {
          const llmStart = performance.now();
          const streamResult = await polishTextStream(rawText, (delta, text, chunkCount) => {
            logAsr("send final_delta", {
              chunkCount,
              deltaLength: delta.length,
              textLength: text.length
            });

            sendJson(clientWs, {
              type: "final_delta",
              rawText,
              delta,
              text,
              chunkCount,
              polishModel: getPolishModel()
            });
          });
          const polished = streamResult.text;
          const llmMs = Math.round(performance.now() - llmStart);
          const finalizeMs = Math.round(performance.now() - finalizeStart);

          sendJson(clientWs, {
            type: "final",
            rawText,
            text: polished,
            polishMs: finalizeMs,
            finalizeMs,
            llmMs,
            chunkCount: streamResult.chunkCount,
            polishModel: getPolishModel()
          });
          finishClientSession();
        } catch (error) {
          const finalizeMs = Math.round(performance.now() - finalizeStart);

          sendJson(clientWs, {
            type: "final",
            rawText,
            text: rawText,
            polishMs: finalizeMs,
            finalizeMs,
            llmMs: finalizeMs,
            polishModel: getPolishModel(),
            warning: `Polish failed, returned raw text. ${error.message}`
          });
          finishClientSession();
        }

        break;
      }

      case "session.finished": {
        if (isFinalizing) {
          break;
        }

        if (stopRequested && !receivedCompleted) {
          sendJson(clientWs, {
            type: "error",
            message: "阿里云已结束会话，但本轮没有返回最终识别结果。请确认停止前已说话，并检查 Manual 模式下音频是否已成功发送。"
          });
        }

        finishClientSession();
        break;
      }

      case "error": {
        lastAsrError = [
          event.error?.message || "Qwen-ASR returned an error",
          event.error?.code ? `code=${event.error.code}` : "",
          event.error?.param ? `param=${event.error.param}` : ""
        ]
          .filter(Boolean)
          .join(" | ");

        sendJson(clientWs, {
          type: "error",
          message: lastAsrError,
          detail: event
        });
        break;
      }

      default:
        // Keep unknown ASR events silent for the MVP.
        break;
    }
  });

  asrWs.on("error", (error) => {
    lastAsrError = `Qwen-ASR WebSocket error: ${error.message}`;

    sendJson(clientWs, {
      type: "error",
      message: lastAsrError
    });
  });

  asrWs.on("unexpected-response", (_req, response) => {
    lastAsrError = `Qwen-ASR handshake failed: HTTP ${response.statusCode || "unknown"}`;

    sendJson(clientWs, {
      type: "error",
      message: lastAsrError
    });
  });

  asrWs.on("close", (code, reasonBuffer) => {
    const reason = reasonBuffer?.toString?.() || "";
    lastAsrClose = `close_code=${code}${reason ? `, reason=${reason}` : ""}`;

    if (!clientClosed && !clientSessionFinishedSent) {
      if (!asrReady) {
        sendJson(clientWs, {
          type: "error",
          message: [
            "阿里云实时识别连接在返回 ready 前关闭了。",
            lastAsrError,
            lastAsrClose
          ]
            .filter(Boolean)
            .join(" ")
        });
      }

      sendJson(clientWs, {
        type: "session_finished"
      });
      safeClose(clientWs);
    }
  });

  clientWs.on("message", (message, isBinary) => {
    if (isBinary) {
      if (!asrReady || isFinalizing || asrWs.readyState !== WebSocket.OPEN) {
        return;
      }

      const audioBuffer = Buffer.from(message);
      audioChunkCount += 1;
      audioByteCount += audioBuffer.byteLength;
      const audio = audioBuffer.toString("base64");

      asrWs.send(
        JSON.stringify({
          event_id: uuid(),
          type: "input_audio_buffer.append",
          audio
        })
      );

      return;
    }

    let payload;

    try {
      payload = JSON.parse(message.toString());
    } catch {
      return;
    }

    if (payload.type === "stop") {
      stopRequested = true;

      if (asrWs.readyState === WebSocket.OPEN) {
        logAsr("send input_audio_buffer.commit", {
          audioChunkCount,
          audioByteCount
        });

        asrWs.send(
          JSON.stringify({
            event_id: uuid(),
            type: "input_audio_buffer.commit"
          })
        );

        sendSessionFinish();
      }
    }
  });

  clientWs.on("close", () => {
    clientClosed = true;
    safeClose(asrWs);
  });

  clientWs.on("error", () => {
    clientClosed = true;
    safeClose(asrWs);
  });
}
