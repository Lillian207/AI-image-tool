const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = Number(process.env.PORT || 8787);
const ENV_API_KEY = process.env.DEEPSEEK_API_KEY;
const ENV_MODEL = process.env.DEEPSEEK_MODEL || "deepseek-chat";
const ENV_QWEN_IMAGE_API_KEY = process.env.QWEN_IMAGE_API_KEY || process.env.DASHSCOPE_API_KEY;
const ENV_QWEN_IMAGE_MODEL = process.env.QWEN_IMAGE_MODEL || "qwen-image-2.0-pro";
const HTML_FILE = path.join(__dirname, "教育现实评论图文生成器V1.html");
const IMAGE_CREATE_INTERVAL_MS = 35000;
let lastImageCreateAt = 0;

function sendJson(res, status, payload) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  });
  res.end(JSON.stringify(payload));
}

function collectBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1024 * 1024) {
        req.destroy();
        reject(new Error("请求内容过大"));
      }
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

function lengthText(value) {
  if (value === "short") return "短文，约 800 字";
  if (value === "long") return "长文，约 1800 字";
  return "中等篇幅，约 1200 字";
}

function toneText(value) {
  if (value === "sharp") return "犀利一点，但不要极端煽动";
  if (value === "warm") return "温情一点，但不要鸡汤化";
  return "现实但温和";
}

const HUMANIZER_RULES = `
去除 AI 写作痕迹的规则：
1. 删除填充短语和客套话，例如“值得注意的是”“此外”“总而言之”“希望这对你有帮助”。
2. 打破过于工整的公式结构，不要所有段落都像“三点分析”。必要时用两点或四点，句子长短要变化。
3. 少用“不是……而是……”“不仅……而且……”这类否定式排比。
4. 删除空泛金句。听起来像海报文案、可引用语录的句子，要改得更具体。
5. 避免“标志着、彰显了、体现了、至关重要、关键作用、深刻影响、持续赋能、复杂格局”等 AI 腔词汇。
6. 不要模糊归因。没有来源时，不写“专家认为”“数据显示”。
7. 少用破折号、粗体、表情符号和机械列表。
8. 信任读者，不要过度解释。能直接说“是/有/会”，就别绕成“作为/充当/具备能力”。
9. 保留一点真人写作的犹豫、判断和节奏变化，允许短句，也允许有锋芒。
10. 保持原意、事实和结构，但让文字更像真人编辑后的中文稿。
`;

function buildPrompt(input) {
  return `请按照“教育现实评论文章”范式，基于用户输入生成一篇原创图文内容。

用户输入：
- 选题主题：${input.topic || ""}
- 目标读者：${input.audience || "家长"}
- 文章立场：${input.stance || "理性避坑"}
- 关键信息/素材：${input.facts || "无"}
- 语气强度：${toneText(input.tone)}
- 篇幅要求：${lengthText(input.length)}
- 配图方向：${input.imageStyle || "教育现实场景"}

写作范式：
1. 选题：一个普通人高度关心的现实痛点。
2. 标题：强冲突 + 强情绪 + 明确人群。
3. 开头：具体场景、对话、事件或数字反差切入，不要上来讲大道理。
4. 第一部分：把个体案例写扎心，让读者代入。
5. 第二部分：把个案扩大成普遍现象，说明不是偶然。
6. 第三部分：拆解背后原因，讲规则、成本、趋势变化，建议拆成 3 点。
7. 第四部分：给普通人建议，落到选择、避坑、判断。
8. 结尾：用一句有温度、有判断、有转发感的话收束。

风格要求：
- 中文输出。
- 口语化，有家长群/朋友圈评论感。
- 多用短段落，适合手机阅读。
- 有案例、有冲突、有现实判断。
- 焦虑但不煽动，犀利但不极端，现实但保留温情。
- 不要复用或模仿任何具体作者的原句。
- 不要声称文章由某位创作者写作。
- 不要编造具体政策、学校、地区、分数、金额；如果用户没有给事实，请用“有家长说”“一个朋友提到”“类似讨论里”这类弱化表达。
- 对真实个人和机构保持谨慎，不做未经证实的负面定性。

${HUMANIZER_RULES}
生成时就要主动去 AI 味：减少模板腔、少用工整排比、减少空泛金句，增加自然的句子节奏。

请严格按下面 Markdown 格式输出，便于前端解析：

# 标题
这里写最终标题

## 标题候选
1. 候选标题一
2. 候选标题二
3. 候选标题三
4. 候选标题四
5. 候选标题五

## 封面文案
这里写一句适合放在封面副标题上的文案

## 正文
### 开头
正文段落……

### 一、最扎心的，不是选择本身
正文段落……

### 二、这不是个例，而是很多人的现实
正文段落……

### 三、真正变了的，是背后的规则
正文段落……

### 四、普通人最该算清楚这三笔账
正文段落……

### 结尾
正文段落……

## 配图提示
1. 封面图提示词
2. 正文配图提示词
3. 信息图提示词

## 发布摘要
这里写 100 字以内摘要。`;
}

function buildHumanizePrompt(input) {
  return `请把下面这篇中文文章做“去 AI 味”编辑。

要求：
- 保留原文事实、观点、标题和基本结构。
- 不要扩写成新文章，不要增加未经提供的新事实。
- 删除填充词、空泛金句、机械总结、过度排比和模糊归因。
- 减少“不是……而是……”“真正……”“这背后……”这类重复句式。
- 打破过于整齐的三段式节奏，让句子长短更自然。
- 口语化一点，但不要变低俗。
- 适合教育/升学/家长/教师议题自媒体文章。
- 只输出改写后的文章，不要解释修改过程。

${HUMANIZER_RULES}

原文：
${input.text || ""}`;
}

async function callDeepSeek({ apiKey, model, messages, temperature = 0.78, max_tokens = 4200 }) {
  const response = await fetch("https://api.deepseek.com/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ model, messages, temperature, max_tokens }),
  });
  const data = await response.json();
  if (!response.ok) {
    const error = new Error(data.error?.message || data.message || "DeepSeek API 调用失败");
    error.status = response.status;
    error.detail = data;
    throw error;
  }
  return data.choices?.[0]?.message?.content || "";
}

function getApiConfig(input) {
  return {
    apiKey: String(input.apiKey || ENV_API_KEY || "").trim(),
    model: String(input.model || ENV_MODEL || "deepseek-chat").trim(),
  };
}

function validateApiConfig(res, apiKey) {
  if (!apiKey) {
    sendJson(res, 400, { error: "请先在页面里填写 DeepSeek API Key" });
    return false;
  }
  return true;
}

function getQwenImageConfig(input) {
  return {
    apiKey: String(input.qwenImageApiKey || ENV_QWEN_IMAGE_API_KEY || "").trim(),
    model: String(input.qwenImageModel || ENV_QWEN_IMAGE_MODEL || "qwen-image-2.0-pro").trim(),
    size: String(input.imageSize || "1280*720").trim(),
    protocol: String(input.imageProtocol || "dashscope").trim(),
    baseUrl: String(input.imageBaseUrl || "").trim(),
  };
}

function validateQwenImageConfig(res, apiKey) {
  if (!apiKey) {
    sendJson(res, 400, { error: "请先在页面里填写通义千问图片 API Key" });
    return false;
  }
  return true;
}

function friendlyQwenError(message) {
  const text = String(message || "");
  if (/rate limit|Requests rate limit|Throttl|Too Many Requests|429/i.test(text)) {
    return "通义千问图片接口被服务端限流了。这通常是账号、模型或地域额度限制，不是图片张数问题；请稍后再手动尝试，或先使用页面里的本地封面和配图提示词。";
  }
  if (/quota|insufficient|balance|额度|余额/i.test(text)) {
    return "通义千问图片额度或余额不足，请检查阿里云百炼/DashScope 账号额度。";
  }
  if (/InvalidApiKey|Invalid API-key|apikey|api key|Unauthorized|401/i.test(text)) {
    return "通义千问图片 API Key 无效，请检查 Key 是否正确、是否已开通百炼服务。";
  }
  return text || "通义千问图片接口调用失败";
}

function normalizeQwenImagePrompt(prompt, topic) {
  return `${prompt || "教育现实类文章配图"}\n\n要求：横向构图，适合公众号/百家号图文配图；真实纪实摄影风或高级信息图风；画面干净，有留白；不要出现可读文字、水印、Logo；主题：${topic || "教育现实评论"}`;
}

async function waitForImageCreateSlot() {
  const waitMs = Math.max(0, IMAGE_CREATE_INTERVAL_MS - (Date.now() - lastImageCreateAt));
  if (waitMs > 0) {
    await new Promise((resolve) => setTimeout(resolve, waitMs));
  }
  lastImageCreateAt = Date.now();
}

function normalizeBaseUrl(baseUrl) {
  return String(baseUrl || "").replace(/\/+$/, "");
}

function normalizeOpenAiImageSize(size) {
  if (size === "1280*720") return "1792x1024";
  if (size === "720*1280") return "1024x1792";
  return String(size || "1024*1024").replace("*", "x");
}

function getImageUrlFromObject(value) {
  if (!value || typeof value !== "object") return "";
  if (typeof value.url === "string") return value.url;
  if (typeof value.image_url === "string") return value.image_url;
  if (typeof value.orig_url === "string") return value.orig_url;
  if (typeof value.image === "string") return value.image;
  if (typeof value.b64_json === "string") return `data:image/png;base64,${value.b64_json}`;
  for (const nested of Object.values(value)) {
    if (Array.isArray(nested)) {
      for (const item of nested) {
        const url = getImageUrlFromObject(item);
        if (url) return url;
      }
    } else if (nested && typeof nested === "object") {
      const url = getImageUrlFromObject(nested);
      if (url) return url;
    }
  }
  return "";
}

async function readJsonResponse(response) {
  const rawText = await response.text();
  if (!rawText) return { data: {}, rawText };
  try {
    return { data: JSON.parse(rawText), rawText };
  } catch (parseError) {
    const error = new Error(`接口返回的不是 JSON：${rawText.slice(0, 300)}`);
    error.status = response.status;
    error.detail = { rawText, parseError: parseError.message };
    throw error;
  }
}

async function callQwenMultimodalImage({ apiKey, model, prompt, size }) {
  await waitForImageCreateSlot();
  const response = await fetch("https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      input: {
        messages: [
          {
            role: "user",
            content: [{ text: prompt }],
          },
        ],
      },
      parameters: {
        negative_prompt: "低分辨率，低画质，肢体畸形，手指畸形，画面过饱和，蜡像感，人脸无细节，过度光滑，画面具有AI感，构图混乱，文字模糊，扭曲。",
        prompt_extend: true,
        watermark: false,
        size,
      },
    }),
  });

  const { data, rawText } = await readJsonResponse(response);
  const url = getImageUrlFromObject(data);
  if (!response.ok || !url) {
    const error = new Error(friendlyQwenError(data.message || data.error?.message || rawText || "通义多模态图片接口调用失败"));
    error.status = response.status;
    error.detail = { ...data, rawText };
    throw error;
  }

  return { url, taskId: data.request_id || data.output?.task_id || "qwen-multimodal-sync", raw: data };
}

function shouldUseQwenMultimodalImage(model, protocol) {
  return protocol === "qwen-multimodal" || /^qwen-image-2\.0/i.test(String(model || ""));
}

async function createImage({ apiKey, model, prompt, size, protocol, baseUrl }) {
  if (shouldUseQwenMultimodalImage(model, protocol)) {
    return callQwenMultimodalImage({ apiKey, model, prompt, size });
  }
  if (protocol === "openai-compatible") {
    return callOpenAiCompatibleImage({ apiKey, model, prompt, size, baseUrl });
  }
  const taskId = await callQwenImage({ apiKey, model, prompt, size });
  return pollQwenImage({ apiKey, taskId });
}

async function callOpenAiCompatibleImage({ apiKey, model, prompt, size, baseUrl }) {
  await waitForImageCreateSlot();
  const endpoint = `${normalizeBaseUrl(baseUrl || "https://dashscope.aliyuncs.com/compatible-mode/v1")}/images/generations`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      prompt,
      n: 1,
      size: normalizeOpenAiImageSize(size),
    }),
  });

  const { data, rawText } = await readJsonResponse(response);
  const item = data.data?.[0] || data.output?.results?.[0] || {};
  const url = item.url || item.b64_json || item.image_url;
  if (!response.ok || !url) {
    const error = new Error(friendlyQwenError(data.error?.message || data.message || rawText || "OpenAI 兼容图片接口调用失败"));
    error.status = response.status;
    error.detail = { ...data, endpoint, rawText };
    throw error;
  }

  return { url: item.b64_json ? `data:image/png;base64,${item.b64_json}` : url, taskId: data.id || "openai-compatible-sync", raw: data };
}

async function callQwenImage({ apiKey, model, prompt, size }) {
  await waitForImageCreateSlot();
  const response = await fetch("https://dashscope.aliyuncs.com/api/v1/services/aigc/text2image/image-synthesis", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
      "X-DashScope-Async": "enable",
    },
    body: JSON.stringify({
      model,
      input: { prompt },
      parameters: {
        size,
        n: 1,
      },
    }),
  });

  const { data, rawText } = await readJsonResponse(response);
  if (!response.ok || !data.output?.task_id) {
    const error = new Error(friendlyQwenError(data.message || data.error?.message || rawText || "通义千问图片任务创建失败"));
    error.status = response.status;
    error.detail = { ...data, rawText };
    throw error;
  }

  return data.output.task_id;
}

async function pollQwenImage({ apiKey, taskId }) {
  const deadline = Date.now() + 120000;
  while (Date.now() < deadline) {
    const response = await fetch(`https://dashscope.aliyuncs.com/api/v1/tasks/${taskId}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    const { data, rawText } = await readJsonResponse(response);
    if (!response.ok) {
      const error = new Error(friendlyQwenError(data.message || data.error?.message || rawText || "通义千问图片任务查询失败"));
      error.status = response.status;
      error.detail = { ...data, rawText };
      throw error;
    }

    const status = data.output?.task_status;
    if (status === "SUCCEEDED") {
      const result = data.output?.results?.[0];
      const url = result?.url || result?.orig_url || result?.image_url;
      if (!url) throw new Error("图片生成成功，但没有返回图片 URL");
      return { url, taskId, raw: data };
    }
    if (status === "FAILED" || status === "CANCELED" || status === "UNKNOWN") {
      throw new Error(friendlyQwenError(data.output?.message || `图片生成失败：${status}`));
    }

    await new Promise((resolve) => setTimeout(resolve, 2500));
  }
  throw new Error("图片生成超时，请稍后重试");
}

async function handleTestQwenImage(req, res) {
  try {
    const raw = await collectBody(req);
    const input = JSON.parse(raw || "{}");
    const { apiKey, model, size, protocol, baseUrl } = getQwenImageConfig(input);

    if (!validateQwenImageConfig(res, apiKey)) return;

    const prompt = normalizeQwenImagePrompt("教育类文章封面，普通家庭书桌场景，干净留白", "接口测试");
    const result = await createImage({ apiKey, model, prompt, size, protocol, baseUrl });

    sendJson(res, 200, {
      ok: true,
      step: "finished",
      message: "图片接口测试成功，已返回图片 URL",
      model,
      size,
      protocol,
      baseUrl,
      taskId: result.taskId,
      url: result.url,
    });
  } catch (error) {
    const status = error.status || 500;
    const rawMessage = error.detail?.message || error.detail?.error?.message || error.message || "千问图片接口测试失败";
    const step = /rate limit|Requests rate limit|Throttl|Too Many Requests|429/i.test(rawMessage)
      ? "create_task_rate_limited"
      : error.detail?.output?.task_status
        ? "poll_task_failed"
        : "create_task_failed";
    sendJson(res, status, {
      ok: false,
      step,
      error: error.message || "千问图片接口测试失败",
      httpStatus: status,
      detail: error.detail,
    });
  }
}

async function handleGenerateImages(req, res) {
  try {
    const raw = await collectBody(req);
    const input = JSON.parse(raw || "{}");
    const { apiKey, model, size, protocol, baseUrl } = getQwenImageConfig(input);

    if (!validateQwenImageConfig(res, apiKey)) return;

    const prompts = Array.isArray(input.prompts) ? input.prompts.filter(Boolean).slice(0, 3) : [];
    if (!prompts.length) {
      sendJson(res, 400, { error: "没有可用的配图提示词" });
      return;
    }

    const images = [];
    for (let index = 0; index < prompts.length; index += 1) {
      const prompt = normalizeQwenImagePrompt(prompts[index], input.topic);
      const result = await createImage({ apiKey, model, prompt, size, protocol, baseUrl });
      images.push({
        index,
        label: index === 0 ? "封面图" : `正文配图 ${index}`,
        prompt,
        taskId: result.taskId,
        url: result.url,
      });
    }

    sendJson(res, 200, { images, model, size, protocol, baseUrl });
  } catch (error) {
    sendJson(res, error.status || 500, { error: error.message || "生成配图失败", detail: error.detail });
  }
}

async function handleHumanize(req, res) {
  try {
    const raw = await collectBody(req);
    const input = JSON.parse(raw || "{}");
    const { apiKey, model } = getApiConfig(input);

    if (!validateApiConfig(res, apiKey)) return;

    if (!input.text || !String(input.text).trim()) {
      sendJson(res, 400, { error: "没有可优化的文章内容" });
      return;
    }

    const text = await callDeepSeek({
      apiKey,
      model,
      messages: [
        {
          role: "system",
          content: "你是一位中文编辑，专门去除 AI 写作痕迹，让文章更自然、更像真人写作。",
        },
        {
          role: "user",
          content: buildHumanizePrompt(input),
        },
      ],
      temperature: 0.62,
      max_tokens: 4200,
    });

    sendJson(res, 200, { text, model });
  } catch (error) {
    sendJson(res, error.status || 500, { error: error.message || "去 AI 味失败", detail: error.detail });
  }
}

async function handleGenerate(req, res) {
  try {
    const raw = await collectBody(req);
    const input = JSON.parse(raw || "{}");
    const { apiKey, model } = getApiConfig(input);

    if (!validateApiConfig(res, apiKey)) return;

    if (!input.topic || !String(input.topic).trim()) {
      sendJson(res, 400, { error: "请先输入选题主题" });
      return;
    }

    const text = await callDeepSeek({
      apiKey,
      model,
      messages: [
        {
          role: "system",
          content: "你是一个擅长中文教育、升学、家长、教师议题的自媒体图文写作助手。你只生成原创内容，不模仿任何具体作者原句。",
        },
        {
          role: "user",
          content: buildPrompt(input),
        },
      ],
      temperature: 0.78,
      max_tokens: 4200,
    });

    sendJson(res, 200, { text, model });
  } catch (error) {
    sendJson(res, 500, { error: error.message || "生成失败" });
  }
}

function serveHtml(res) {
  fs.readFile(HTML_FILE, (error, html) => {
    if (error) {
      res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("无法读取 教育现实评论图文生成器V1.html");
      return;
    }
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(html);
  });
}

const server = http.createServer((req, res) => {
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    });
    res.end();
    return;
  }

  if (req.url === "/" && req.method === "GET") {
    serveHtml(res);
    return;
  }

  if (req.url === "/api/generate" && req.method === "POST") {
    handleGenerate(req, res);
    return;
  }

  if (req.url === "/api/humanize" && req.method === "POST") {
    handleHumanize(req, res);
    return;
  }

  if (req.url === "/api/generate-images" && req.method === "POST") {
    handleGenerateImages(req, res);
    return;
  }

  if (req.url === "/api/test-qwen-image" && req.method === "POST") {
    handleTestQwenImage(req, res);
    return;
  }

  sendJson(res, 404, { error: "Not found" });
});

server.listen(PORT, () => {
  console.log(`DeepSeek local proxy running at http://localhost:${PORT}`);
  console.log(`Default model: ${ENV_MODEL}`);
  console.log("Open the page, paste your DeepSeek API Key, then generate.");
});
