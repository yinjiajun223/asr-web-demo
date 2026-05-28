export async function polishText(rawText) {
  const apiKey = process.env.DASHSCOPE_API_KEY;

  if (!apiKey) {
    return {
      text: rawText,
      polished: false,
      warning: '未配置 DASHSCOPE_API_KEY，已返回原始识别文本。',
    };
  }

  const baseURL = process.env.LLM_BASE_URL || 'https://dashscope.aliyuncs.com/compatible-mode/v1';
  const model = process.env.LLM_MODEL || 'qwen-plus';

  const response = await fetch(`${baseURL}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      messages: [
        {
          role: 'system',
          content: [
            '你是一个智能语音输入整理助手。',
            '把用户口语化的语音识别文本整理成适合直接填入网页输入框的文字。',
            '要求：去掉口头禅，修正明显错字，补全标点，识别自我修正，不扩写无关内容。',
            '不要解释，不要加引号，只输出最终文本。',
          ].join('\n'),
        },
        {
          role: 'user',
          content: rawText,
        },
      ],
    }),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`LLM polish failed: ${response.status} ${detail}`);
  }

  const data = await response.json();
  const text = data?.choices?.[0]?.message?.content?.trim();

  if (!text) {
    throw new Error('LLM polish returned empty content');
  }

  return {
    text,
    polished: true,
  };
}
