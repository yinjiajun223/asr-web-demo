import { useEffect, useRef, useState } from "react";

function getDefaultWsUrl() {
  if (typeof window === "undefined") {
    return "ws://localhost:3001/voice";
  }

  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const hostname = window.location.hostname || "localhost";
  return `${protocol}//${hostname}:3001/voice`;
}

const WS_URL = import.meta.env.VITE_VOICE_WS_URL || getDefaultWsUrl();

function getMicErrorMessage(error) {
  const message = error?.message ? `原始错误：${error.message}` : "";

  if (!window.isSecureContext) {
    return [
      "浏览器阻止了麦克风访问：当前页面不是安全上下文。",
      "请用 http://localhost:5173 打开本机页面，或改用 HTTPS；局域网 IP 的 HTTP 页面通常不能调用麦克风。",
      message
    ]
      .filter(Boolean)
      .join(" ");
  }

  if (!navigator.mediaDevices?.getUserMedia) {
    return "当前浏览器不支持麦克风 API，或该页面没有麦克风访问权限。";
  }

  if (error?.name === "NotAllowedError") {
    return "麦克风权限被拒绝，请在浏览器地址栏权限设置中允许麦克风后重试。";
  }

  if (error?.name === "NotFoundError") {
    return "没有检测到可用麦克风，请检查系统输入设备。";
  }

  return `麦克风启动失败。${message}`;
}

const STATUS_TEXT = {
  idle: "点击按钮开始语音输入",
  connecting: "正在连接后端和阿里云实时识别服务...",
  recording: "正在听你说话...",
  stopping: "正在结束识别...",
  polishing: "识别完成，正在智能整理...",
  error: "发生错误"
};

function formatRecordTime(date = new Date()) {
  return date.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit"
  });
}

function createRecordId() {
  if (crypto.randomUUID) {
    return crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function createTranscriptRecord(type, text, durationMs = null, meta = {}) {
  return {
    id: createRecordId(),
    time: formatRecordTime(),
    type,
    text,
    durationMs,
    meta
  };
}

function createFinalizingRecord(text = "", meta = {}) {
  return createTranscriptRecord("finalizing", text, null, meta);
}

function formatDuration(durationMs) {
  if (!Number.isFinite(durationMs)) {
    return "";
  }

  if (durationMs < 1000) {
    return `${durationMs}ms`;
  }

  return `${(durationMs / 1000).toFixed(1)}s`;
}

export default function App() {
  const [value, setValue] = useState("");
  const [status, setStatus] = useState("idle");
  const [preview, setPreview] = useState("");
  const [rawFinal, setRawFinal] = useState("");
  const [error, setError] = useState("");
  const [records, setRecords] = useState([]);
  const [liveRecord, setLiveRecord] = useState(null);

  const textareaRef = useRef(null);
  const wsRef = useRef(null);
  const streamRef = useRef(null);
  const audioContextRef = useRef(null);
  const workletNodeRef = useRef(null);
  const sourceRef = useRef(null);
  const statusRef = useRef("idle");
  const connectTimeoutRef = useRef(null);
  const readyRef = useRef(false);
  const finalizingRecordIdRef = useRef(null);
  const finalizingTargetTextRef = useRef("");
  const finalizingDisplayTextRef = useRef("");
  const finalizingMetaRef = useRef({});
  const finalizingTimerRef = useRef(null);
  const pendingFinalRef = useRef(null);

  const isBusy = status === "connecting" || status === "stopping" || status === "polishing";
  const isRecording = status === "recording";

  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  useEffect(() => () => {
    clearFinalizingTimer();
  }, []);

  function clearConnectTimeout() {
    if (connectTimeoutRef.current) {
      window.clearTimeout(connectTimeoutRef.current);
      connectTimeoutRef.current = null;
    }
  }

  function clearFinalizingTimer() {
    if (finalizingTimerRef.current) {
      window.clearInterval(finalizingTimerRef.current);
      finalizingTimerRef.current = null;
    }
  }

  function resetFinalizingState() {
    clearFinalizingTimer();
    finalizingRecordIdRef.current = null;
    finalizingTargetTextRef.current = "";
    finalizingDisplayTextRef.current = "";
    finalizingMetaRef.current = {};
    pendingFinalRef.current = null;
  }

  function upsertLiveRecord(text) {
    const nextText = text.trim();

    if (!nextText) {
      return;
    }

    setLiveRecord((currentRecord) => {
      if (!currentRecord) {
        return createTranscriptRecord("live", nextText);
      }

      return {
        ...currentRecord,
        text: nextText
      };
    });
  }

  function clearLiveRecord() {
    setLiveRecord(null);
  }

  function addFinalRecord(text, durationMs, meta = {}) {
    const nextText = text.trim();

    if (!nextText) {
      return;
    }

    setRecords((currentRecords) => [
      createTranscriptRecord("final", nextText, durationMs, meta),
      ...currentRecords
    ]);
  }

  function upsertFinalizingRecord(text, meta = {}) {
    const nextText = text.trimStart();

    setRecords((currentRecords) => {
      if (!finalizingRecordIdRef.current) {
        const nextRecord = createFinalizingRecord(nextText, meta);
        finalizingRecordIdRef.current = nextRecord.id;
        return [nextRecord, ...currentRecords];
      }

      return currentRecords.map((record) =>
        record.id === finalizingRecordIdRef.current
          ? {
              ...record,
              text: nextText,
              meta: {
                ...record.meta,
                ...meta
              }
            }
          : record
      );
    });
  }

  function completeFinalizingRecord(text, durationMs, meta = {}) {
    const nextText = text.trim();

    if (!nextText) {
      finalizingRecordIdRef.current = null;
      return;
    }

    setRecords((currentRecords) => {
      if (!finalizingRecordIdRef.current) {
        return [
          createTranscriptRecord("final", nextText, durationMs, meta),
          ...currentRecords
        ];
      }

      const nextRecords = currentRecords.map((record) =>
        record.id === finalizingRecordIdRef.current
          ? {
              ...record,
              type: "final",
              text: nextText,
              durationMs,
              meta: {
                ...record.meta,
                ...meta
              }
            }
          : record
      );

      finalizingRecordIdRef.current = null;
      return nextRecords;
    });
  }

  function finishPendingFinalIfReady() {
    const pendingFinal = pendingFinalRef.current;

    if (!pendingFinal) {
      return;
    }

    if (finalizingDisplayTextRef.current !== finalizingTargetTextRef.current) {
      return;
    }

    pendingFinalRef.current = null;
    clearFinalizingTimer();
    completeFinalizingRecord(
      pendingFinal.text,
      pendingFinal.durationMs,
      pendingFinal.meta
    );
    insertAtCursor(pendingFinal.text);
    setPreview("");
    setStatus("idle");

    if (pendingFinal.warning) {
      setError(pendingFinal.warning);
    }

    finalizingTargetTextRef.current = "";
    finalizingDisplayTextRef.current = "";
    finalizingMetaRef.current = {};
    cleanupWebSocket();
  }

  function revealNextFinalizingChunk() {
    const currentText = finalizingDisplayTextRef.current;
    const targetText = finalizingTargetTextRef.current;

    if (currentText === targetText) {
      finishPendingFinalIfReady();
      return;
    }

    const remainingLength = targetText.length - currentText.length;
    const step = remainingLength > 80 ? 4 : remainingLength > 30 ? 2 : 1;
    const nextText = targetText.slice(0, currentText.length + step);

    finalizingDisplayTextRef.current = nextText;
    upsertFinalizingRecord(nextText, finalizingMetaRef.current);
  }

  function startFinalizingReveal() {
    if (finalizingTimerRef.current) {
      return;
    }

    revealNextFinalizingChunk();
    finalizingTimerRef.current = window.setInterval(
      revealNextFinalizingChunk,
      35
    );
  }

  function queueFinalizingText(text, meta = {}) {
    const nextText = text.trimStart();

    if (!nextText) {
      return;
    }

    finalizingTargetTextRef.current = nextText;
    finalizingMetaRef.current = {
      ...finalizingMetaRef.current,
      ...meta
    };
    startFinalizingReveal();
  }

  function queueFinalResult(data) {
    const text = data.text || data.rawText || "";

    if (!text.trim()) {
      cleanupWebSocket();
      setStatus("idle");
      return;
    }

    const meta = {
      finalizeMs: data.finalizeMs ?? data.polishMs,
      llmMs: data.llmMs ?? data.polishMs,
      model: data.polishModel,
      chunkCount: data.chunkCount
    };

    pendingFinalRef.current = {
      text,
      durationMs: data.llmMs ?? data.polishMs,
      meta,
      warning: data.warning
    };
    finalizingMetaRef.current = {
      ...finalizingMetaRef.current,
      ...meta
    };
    finalizingTargetTextRef.current = text.trimStart();
    startFinalizingReveal();
    finishPendingFinalIfReady();
  }

  async function start() {
    setError("");
    setPreview("");
    setRawFinal("");
    setStatus("connecting");
    setLiveRecord(null);
    resetFinalizingState();

    const ws = new WebSocket(WS_URL);
    ws.binaryType = "arraybuffer";
    wsRef.current = ws;
    readyRef.current = false;

    clearConnectTimeout();
    connectTimeoutRef.current = window.setTimeout(async () => {
      if (readyRef.current || wsRef.current !== ws) {
        return;
      }

      setError("后端已连接，但阿里云实时识别服务长时间没有返回 ready。请检查 server/.env、ASR 模型配置和后端日志。");
      setStatus("error");
      await stopMicOnly();
      resetFinalizingState();
      cleanupWebSocket();
    }, 10000);

    ws.onmessage = async (event) => {
      const data = JSON.parse(event.data);

      if (data.type === "ready") {
        readyRef.current = true;
        clearConnectTimeout();

        try {
          await startMic();
          setStatus("recording");
        } catch (error) {
          setError(getMicErrorMessage(error));
          setStatus("error");
          await stopMicOnly();
          resetFinalizingState();
          cleanupWebSocket();
        }
      }

      if (data.type === "session_finished") {
        clearConnectTimeout();
        cleanupWebSocket();

        if (pendingFinalRef.current) {
          return;
        }

        if (statusRef.current === "stopping" || statusRef.current === "polishing") {
          setError("语音会话已结束，但没有收到最终识别结果。请查看后端 [asr] 日志中的 audioChunkCount、audioByteCount 和阿里云 event.type。");
          setStatus("error");
        } else if (statusRef.current !== "idle" && statusRef.current !== "error") {
          setStatus("idle");
        }
      }

      if (data.type === "speech_started") {
        setStatus("recording");
      }

      if (data.type === "preview") {
        const text = data.text || "";
        setPreview(text);
        upsertLiveRecord(text);
      }

      if (data.type === "raw_final") {
        const text = data.text || "";
        setRawFinal(text);
        clearLiveRecord();
        setStatus("polishing");
        await stopMicOnly();
      }

      if (data.type === "final_delta") {
        const text = data.text || `${finalizingTargetTextRef.current}${data.delta || ""}`;
        queueFinalizingText(text, {
          model: data.polishModel,
          chunkCount: data.chunkCount
        });
        setStatus("polishing");
      }

      if (data.type === "final") {
        queueFinalResult(data);
      }

      if (data.type === "error") {
        clearConnectTimeout();
        setError(data.message || "未知错误");
        setStatus("error");
        await stopMicOnly();
        resetFinalizingState();
        cleanupWebSocket();
      }
    };

    ws.onerror = async () => {
      clearConnectTimeout();
      setError("WebSocket 连接失败，请确认后端已启动。");
      setStatus("error");
      await stopMicOnly();
      resetFinalizingState();
      cleanupWebSocket();
    };

    ws.onclose = async () => {
      clearConnectTimeout();

      if (wsRef.current !== ws) {
        return;
      }

      if (!readyRef.current && statusRef.current === "connecting") {
        setError("与语音后端的连接在收到 ready 之前就关闭了。请检查后端日志和阿里云实时识别配置。");
        setStatus("error");
      } else if (pendingFinalRef.current) {
        return;
      } else if (statusRef.current !== "idle" && statusRef.current !== "error") {
        setStatus("idle");
      }

      await stopMicOnly();
      cleanupWebSocket();
    };
  }

  async function startMic() {
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      throw new Error("getUserMedia is unavailable in the current browser context");
    }

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      }
    });

    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    const audioContext = new AudioContextClass();

    await audioContext.audioWorklet.addModule("/pcm-worklet.js");

    const source = audioContext.createMediaStreamSource(stream);
    const workletNode = new AudioWorkletNode(audioContext, "pcm-worklet");

    workletNode.port.onmessage = (event) => {
      const ws = wsRef.current;

      if (!ws || ws.readyState !== WebSocket.OPEN) {
        return;
      }

      ws.send(event.data);
    };

    const silentGain = audioContext.createGain();
    silentGain.gain.value = 0;

    source.connect(workletNode);
    workletNode.connect(silentGain);
    silentGain.connect(audioContext.destination);

    streamRef.current = stream;
    audioContextRef.current = audioContext;
    workletNodeRef.current = workletNode;
    sourceRef.current = source;
  }

  async function stop() {
    setStatus("stopping");
    await stopMicOnly();

    const ws = wsRef.current;

    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "stop" }));
    } else {
      setStatus("idle");
    }
  }

  async function stopMicOnly() {
    if (workletNodeRef.current) {
      workletNodeRef.current.disconnect();
      workletNodeRef.current = null;
    }

    if (sourceRef.current) {
      sourceRef.current.disconnect();
      sourceRef.current = null;
    }

    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }

    if (audioContextRef.current) {
      await audioContextRef.current.close();
      audioContextRef.current = null;
    }
  }

  function cleanupWebSocket() {
    clearConnectTimeout();

    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
  }

  function insertAtCursor(text) {
    const textarea = textareaRef.current;

    if (!textarea) {
      setValue((prev) => `${prev}${text}`);
      return;
    }

    const start = textarea.selectionStart ?? value.length;
    const end = textarea.selectionEnd ?? value.length;

    const nextValue = `${value.slice(0, start)}${text}${value.slice(end)}`;
    setValue(nextValue);

    window.requestAnimationFrame(() => {
      textarea.focus();
      const cursor = start + text.length;
      textarea.selectionStart = cursor;
      textarea.selectionEnd = cursor;
    });
  }

  return (
    <main className="page">
      <section className="card">
        <div className="header">
          <div>
            <h1>智能语音输入 Demo</h1>
            <p>网页按钮版 Typeless-like 输入：实时识别 + AI 整理。</p>
          </div>

          <span className={`badge ${isRecording ? "live" : ""}`}>
            {isRecording ? "录音中" : "待机"}
          </span>
        </div>

        <textarea
          ref={textareaRef}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          placeholder="点击下面按钮开始说话，最终整理后的文本会插入这里。"
        />

        <div className="actions">
          <button
            type="button"
            className={isRecording ? "danger" : "primary"}
            disabled={isBusy}
            onClick={isRecording ? stop : start}
          >
            {isRecording ? "停止语音输入" : "开始语音输入"}
          </button>

          <button
            type="button"
            className="secondary"
            disabled={isRecording || isBusy}
            onClick={() => {
              setValue("");
              setPreview("");
              setRawFinal("");
              setError("");
              setRecords([]);
              setLiveRecord(null);
              resetFinalizingState();
            }}
          >
            清空
          </button>
        </div>

        <div className="panel">
          <div className="label">状态</div>
          <div>{STATUS_TEXT[status] || status}</div>
        </div>

        {(liveRecord || records.length > 0) && (
          <div className="transcript-list" aria-label="语音转写记录">
            {liveRecord && (
              <div className="transcript-row live">
                <div className="transcript-meta">
                  <span>{liveRecord.time}</span>
                  <span>实时语音</span>
                </div>
                <div className="transcript-text">{liveRecord.text}</div>
              </div>
            )}

            {records.map((record) => (
              <div className={`transcript-row ${record.type}`} key={record.id}>
                <div className="transcript-meta">
                  <span>{record.time}</span>
                  <span>
                    {record.type === "finalizing" && "最终整理中"}
                    {record.type === "final" && (
                      <>
                        最终整理
                        {record.durationMs !== null && (
                          <span className="duration">
                            LLM {formatDuration(record.durationMs)}
                          </span>
                        )}
                      </>
                    )}
                    {record.type === "finalizing" && record.meta?.chunkCount && (
                      <span className="duration">
                        {record.meta.chunkCount} chunks
                      </span>
                    )}
                  </span>
                </div>
                <div className="transcript-text">{record.text}</div>
              </div>
            ))}
          </div>
        )}

        {error && (
          <div className="panel error">
            <div className="label">错误/提示</div>
            <div>{error}</div>
          </div>
        )}
      </section>
    </main>
  );
}
