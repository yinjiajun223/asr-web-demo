import OpenAI from "openai";

let client;

function getDashScopeBaseUrl() {
  const region = process.env.DASHSCOPE_REGION || "cn";

  if (region === "intl") {
    return "https://dashscope-intl.aliyuncs.com/compatible-mode/v1";
  }

  if (region === "us") {
    return "https://dashscope-us.aliyuncs.com/compatible-mode/v1";
  }

  return "https://dashscope.aliyuncs.com/compatible-mode/v1";
}

function getClient() {
  const apiKey = process.env.DASHSCOPE_API_KEY;

  if (!apiKey) {
    throw new Error("Missing DASHSCOPE_API_KEY in server/.env");
  }

  if (!client) {
    client = new OpenAI({
      apiKey,
      baseURL: getDashScopeBaseUrl()
    });
  }

  return client;
}

export function getPolishModel() {
  return process.env.LLM_MODEL || "qwen-plus";
}

export async function polishText(rawText) {
  const model = getPolishModel();
  const openaiClient = getClient();

  const completion = await openaiClient.chat.completions.create({
    model,
    temperature: 0.2,
    messages: [
      {
        role: "system",
        content: [
          "你是一个网页端智能语音输入整理助手。",
          "任务：把语音识别得到的口语化文本，整理成适合直接放入网页输入框的文字。",
          "要求：",
          "1. 保留原意，不要扩写无关内容。",
          "2. 删除口头禅，例如：嗯、啊、呃、那个、就是。",
          "3. 自动补充标点。",
          "4. 修正明显错别字。",
          "5. 识别自我修正，例如“不是明天，是后天”，最终只保留“后天”。",
          "6. 不要解释，不要加标题，不要加引号，只输出最终文本。"
        ].join("\n")
      },
      {
        role: "user",
        content: rawText
      }
    ]
  });

  return completion.choices?.[0]?.message?.content?.trim() || rawText;
}

export async function polishTextStream(rawText, onDelta) {
  const model = getPolishModel();
  const openaiClient = getClient();
  let text = "";
  let chunkCount = 0;

  const stream = await openaiClient.chat.completions.create({
    model,
    temperature: 0.2,
    stream: true,
    messages: [
      {
        role: "system",
        content: [
          "你是一个网页端智能语音输入整理助手。",
          "任务：把语音识别得到的口语化文本，整理成适合直接放入网页输入框的文字。",
          "要求：",
          "1. 保留原意，不要扩写无关内容。",
          "2. 删除口头禅，例如：嗯、啊、呃、那个、就是。",
          "3. 自动补充标点。",
          "4. 修正明显错别字。",
          "5. 识别自我修正，例如“不是明天，是后天”，最终只保留“后天”。",
          "6. 不要解释，不要加标题，不要加引号，只输出最终文本。"
        ].join("\n")
      },
      {
        role: "user",
        content: rawText
      }
    ]
  });

  for await (const chunk of stream) {
    const delta = chunk.choices?.[0]?.delta?.content || "";

    if (!delta) {
      continue;
    }

    text += delta;
    chunkCount += 1;
    onDelta(delta, text, chunkCount);
  }

  return {
    text: text.trim() || rawText,
    chunkCount
  };
}
