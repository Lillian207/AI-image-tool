const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = Number(process.env.PORT || 8788);
const ENV_API_KEY = process.env.DEEPSEEK_API_KEY;
const ENV_MODEL = process.env.DEEPSEEK_MODEL || "deepseek-chat";
const ENV_QWEN_IMAGE_API_KEY = process.env.QWEN_IMAGE_API_KEY || process.env.DASHSCOPE_API_KEY;
const ENV_QWEN_IMAGE_MODEL = process.env.QWEN_IMAGE_MODEL || "qwen-image-2.0-pro";
const HTML_FILE = [
  "教育现实评论图文生成器V2.html",
  "教育现实评论图文生成器V1.html",
].map((filename) => path.join(__dirname, filename)).find((filePath) => fs.existsSync(filePath));
const EXPORT_DIR = path.join(__dirname, "导出文章");
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
1. 封面图：提取正文开头或核心案例里的具体人物、地点、动作和冲突，写成一条可直接生图的提示词；不要只写“教育场景/家庭场景”。
2. 正文配图：对应正文中最有画面感的一段，包含具体物件、环境、人物状态和情绪，例如家长群截图感、书桌账单、校门口等待、机构咨询室等；不得与封面图重复。
3. 信息图：把文章里的规则、成本、时间、选择压力等抽象问题转成具体视觉隐喻或版式画面；不要使用可读文字、Logo、水印。

配图提示要求：
- 三条都必须紧扣本文的选题和事实素材，至少包含一个来自用户输入或正文的具体细节。
- 每条 40-80 字，包含画面主体、环境、情绪、构图和风格。
- 避免重复使用“普通家庭”“教育消费场景”“真实自然”“干净留白”这类泛词，除非正文确有对应细节。

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

function normalizeChatBaseUrl(baseUrl) {
  const normalized = String(baseUrl || "https://api.deepseek.com").replace(/\/+$/, "");
  return normalized.endsWith("/chat/completions") ? normalized : `${normalized}/chat/completions`;
}

async function callChatModel({ apiKey, model, baseUrl, messages, temperature = 0.78, max_tokens = 4200 }) {
  const response = await fetch(normalizeChatBaseUrl(baseUrl), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ model, messages, temperature, max_tokens }),
  });
  const data = await response.json();
  if (!response.ok) {
    const error = new Error(data.error?.message || data.message || "文本模型 API 调用失败");
    error.status = response.status;
    error.detail = data;
    throw error;
  }
  return data.choices?.[0]?.message?.content || "";
}

function getApiConfig(input) {
  const textProvider = String(input.textProvider || "deepseek").trim();
  return {
    apiKey: String(input.apiKey || ENV_API_KEY || "").trim(),
    model: String(input.model || (textProvider === "custom" ? "" : ENV_MODEL || "deepseek-chat")).trim(),
    baseUrl: String(input.apiBaseUrl || (textProvider === "custom" ? "" : "https://api.deepseek.com")).trim(),
    textProvider,
  };
}

function validateApiConfig(res, { apiKey, model, baseUrl }) {
  if (!apiKey) {
    sendJson(res, 400, { error: "请先在页面里填写文本 API Key" });
    return false;
  }
  if (!model) {
    sendJson(res, 400, { error: "请先在页面里填写文本模型名" });
    return false;
  }
  if (!baseUrl) {
    sendJson(res, 400, { error: "请先在页面里填写文本 API Base URL" });
    return false;
  }
  return true;
}

function getQwenImageConfig(input) {
  const provider = String(input.imageProvider || "dashscope").trim();
  return {
    apiKey: String(input.qwenImageApiKey || ENV_QWEN_IMAGE_API_KEY || "").trim(),
    model: String(input.qwenImageModel || (provider === "custom" ? "" : ENV_QWEN_IMAGE_MODEL || "qwen-image-2.0-pro")).trim(),
    size: String(input.imageSize || "1280*720").trim(),
    protocol: provider === "custom" ? "openai-compatible" : String(input.imageProtocol || "dashscope").trim(),
    baseUrl: String(input.imageBaseUrl || (provider === "custom" ? "" : "")).trim(),
    provider,
  };
}

function validateQwenImageConfig(res, { apiKey, model, baseUrl, provider }) {
  if (!apiKey) {
    sendJson(res, 400, { error: "请先在页面里填写图片 API Key" });
    return false;
  }
  if (!model) {
    sendJson(res, 400, { error: "请先在页面里填写图片模型名" });
    return false;
  }
  if (provider === "custom" && !baseUrl) {
    sendJson(res, 400, { error: "请先在页面里填写图片 API Base URL" });
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
  if (/InvalidApiKey|Invalid API-key|Invalid token|apikey|api key|token|Unauthorized|401/i.test(text)) {
    return "图片 API Key/Token 无效，请检查 Key 是否正确、是否属于当前图片服务商，以及账号是否已开通对应生图模型。";
  }
  return text || "图片接口调用失败";
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

function normalizeImageGenerationBaseUrl(baseUrl) {
  const normalized = normalizeBaseUrl(baseUrl || "https://dashscope.aliyuncs.com/compatible-mode/v1");
  return normalized.endsWith("/images/generations") ? normalized : `${normalized}/images/generations`;
}

function normalizeOpenAiImageSize(size) {
  if (size === "1280*720") return "1792x1024";
  if (size === "720*1280") return "1024x1792";
  return String(size || "1024*1024").replace("*", "x");
}

function normalizeWanImageSize(size) {
  if (size === "1280*720") return "1696*960";
  if (size === "720*1280") return "960*1696";
  return "1280*1280";
}

function getImageUrlFromObject(value) {
  if (!value || typeof value !== "object") return "";
  if (typeof value.image === "string") return value.image;
  if (typeof value.url === "string") return value.url;
  if (typeof value.image_url === "string") return value.image_url;
  if (typeof value.orig_url === "string") return value.orig_url;
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

function isWanImageModel(model) {
  return /^wan/i.test(String(model || ""));
}

function shouldUseQwenMultimodalImage(model, protocol) {
  return !isWanImageModel(model) && (protocol === "qwen-multimodal" || /^qwen-image-2\.0/i.test(String(model || "")));
}

async function createImage({ apiKey, model, prompt, size, protocol, baseUrl, provider }) {
  if (provider === "custom") {
    return callOpenAiCompatibleImage({ apiKey, model, prompt, size, baseUrl });
  }
  if (isWanImageModel(model)) {
    const taskId = await callWanImage({ apiKey, model, prompt, size });
    return pollQwenImage({ apiKey, taskId });
  }
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
  const endpoint = normalizeImageGenerationBaseUrl(baseUrl);
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

async function callWanImage({ apiKey, model, prompt, size }) {
  await waitForImageCreateSlot();
  const response = await fetch("https://dashscope.aliyuncs.com/api/v1/services/aigc/image-generation/generation", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
      "X-DashScope-Async": "enable",
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
        size: normalizeWanImageSize(size),
        n: 1,
      },
    }),
  });

  const { data, rawText } = await readJsonResponse(response);
  if (!response.ok || !data.output?.task_id) {
    const error = new Error(friendlyQwenError(data.message || data.error?.message || rawText || "通义万相图片任务创建失败"));
    error.status = response.status;
    error.detail = { ...data, rawText };
    throw error;
  }

  return data.output.task_id;
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
      const url = getImageUrlFromObject(data);
      if (!url) {
        const error = new Error("图片生成成功，但没有解析到图片 URL");
        error.status = 502;
        error.detail = { output: data.output, rawText };
        throw error;
      }
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
    const { apiKey, model, size, protocol, baseUrl, provider } = getQwenImageConfig(input);

    if (!validateQwenImageConfig(res, { apiKey, model, baseUrl, provider })) return;

    const prompt = normalizeQwenImagePrompt("教育类文章封面，普通家庭书桌场景，干净留白", "接口测试");
    const result = await createImage({ apiKey, model, prompt, size, protocol, baseUrl, provider });

    sendJson(res, 200, {
      ok: true,
      step: "finished",
      message: "图片接口测试成功，已返回图片 URL",
      model,
      size,
      protocol,
      baseUrl,
      provider,
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
    const { apiKey, model, size, protocol, baseUrl, provider } = getQwenImageConfig(input);

    if (!validateQwenImageConfig(res, { apiKey, model, baseUrl, provider })) return;

    const prompts = Array.isArray(input.prompts) ? input.prompts.filter(Boolean).slice(0, 3) : [];
    if (!prompts.length) {
      sendJson(res, 400, { error: "没有可用的配图提示词" });
      return;
    }

    const images = [];
    const failures = [];
    for (let index = 0; index < prompts.length; index += 1) {
      const prompt = normalizeQwenImagePrompt(prompts[index], input.topic);
      try {
        const result = await createImage({ apiKey, model, prompt, size, protocol, baseUrl, provider });
        images.push({
          index,
          label: index === 0 ? "封面图" : `正文配图 ${index}`,
          prompt,
          taskId: result.taskId,
          url: result.url,
        });
      } catch (error) {
        failures.push({
          index,
          label: index === 0 ? "封面图" : `正文配图 ${index}`,
          prompt,
          error: error.message || "生成配图失败",
          httpStatus: error.status || 500,
          detail: error.detail,
        });
      }
    }

    if (!images.length) {
      const firstFailure = failures[0] || {};
      sendJson(res, firstFailure.httpStatus || 500, {
        error: firstFailure.error || "生成配图失败",
        images,
        failures,
        model,
        size,
        protocol,
        baseUrl,
        provider,
      });
      return;
    }

    sendJson(res, failures.length ? 207 : 200, { images, failures, model, size, protocol, baseUrl, provider });
  } catch (error) {
    sendJson(res, error.status || 500, { error: error.message || "生成配图失败", detail: error.detail });
  }
}

async function handleHumanize(req, res) {
  try {
    const raw = await collectBody(req);
    const input = JSON.parse(raw || "{}");
    const { apiKey, model, baseUrl } = getApiConfig(input);

    if (!validateApiConfig(res, { apiKey, model, baseUrl })) return;

    if (!input.text || !String(input.text).trim()) {
      sendJson(res, 400, { error: "没有可优化的文章内容" });
      return;
    }

    const text = await callChatModel({
      apiKey,
      model,
      baseUrl,
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
    const { apiKey, model, baseUrl } = getApiConfig(input);

    if (!validateApiConfig(res, { apiKey, model, baseUrl })) return;

    if (!input.topic || !String(input.topic).trim()) {
      sendJson(res, 400, { error: "请先输入选题主题" });
      return;
    }

    const text = await callChatModel({
      apiKey,
      model,
      baseUrl,
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

function escapeHtml(str) {
  return String(str || "").replace(/[&<>"]/g, (s) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;" }[s]));
}

function cleanArticleTitle(value) {
  return String(value || "文章")
    .replace(/^【?标题】?\s*[:：]?\s*/, "")
    .replace(/^标题\s*[:：]\s*/, "")
    .trim() || "文章";
}

function safeFileName(value) {
  return cleanArticleTitle(value)
    .replace(/[\\/:*?"<>|]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 60) || "文章";
}

function sanitizeWordParagraphHtml(html, fallbackText) {
  return String(html || escapeHtml(fallbackText || ""))
    .replace(/<(?!\/?(?:strong|b)\b)[^>]*>/gi, "")
    .replace(/<b\b[^>]*>/gi, "<strong>")
    .replace(/<\/b>/gi, "</strong>")
    .replace(/<strong\b[^>]*>/gi, "<strong>");
}

async function getUniqueExportPath(title) {
  const baseName = safeFileName(title);
  let filename = `${baseName}.docx`;
  let filePath = path.join(EXPORT_DIR, filename);
  let index = 2;
  while (true) {
    try {
      await fs.promises.access(filePath);
      filename = `${baseName}-${index}.docx`;
      filePath = path.join(EXPORT_DIR, filename);
      index += 1;
    } catch {
      return { filename, filePath };
    }
  }
}

function escapeXml(str) {
  return String(str || "").replace(/[&<>"']/g, (s) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&apos;" }[s]));
}

function decodeHtmlEntities(str) {
  return String(str || "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(parseInt(code, 10)));
}

function paragraphHtmlToRuns(html, fallbackText) {
  const safeHtml = sanitizeWordParagraphHtml(html, fallbackText);
  const runs = [];
  let bold = false;
  let cursor = 0;
  const tagPattern = /<\/?strong>|<[^>]+>/gi;
  let match;
  while ((match = tagPattern.exec(safeHtml))) {
    const text = decodeHtmlEntities(safeHtml.slice(cursor, match.index));
    if (text) runs.push({ text, bold });
    const tag = match[0].toLowerCase();
    if (tag === "<strong>") bold = true;
    if (tag === "</strong>") bold = false;
    cursor = tagPattern.lastIndex;
  }
  const tail = decodeHtmlEntities(safeHtml.slice(cursor));
  if (tail) runs.push({ text: tail, bold });
  return runs.length ? runs : [{ text: cleanArticleTitle(fallbackText || ""), bold: false }];
}

function buildDocxTextRun(text, bold = false, size = "24") {
  const parts = String(text || "").split(/\n/);
  const textXml = parts.map((part, index) => `${index ? "<w:br/>" : ""}${part ? `<w:t xml:space="preserve">${escapeXml(part)}</w:t>` : ""}`).join("");
  if (!textXml) return "";
  return `<w:r><w:rPr>${bold ? "<w:b/>" : ""}<w:sz w:val="${size}"/><w:szCs w:val="${size}"/></w:rPr>${textXml}</w:r>`;
}

function buildDocxParagraph(runs, options = {}) {
  const spacing = options.title ? "<w:spacing w:after=\"360\"/>" : "<w:spacing w:after=\"240\"/>";
  const props = `<w:pPr>${spacing}</w:pPr>`;
  const runXml = runs.map((run) => buildDocxTextRun(run.text, run.bold || options.title, options.title ? "28" : "24")).join("");
  return `<w:p>${props}${runXml}</w:p>`;
}

function buildDocxImageParagraph(rId, index) {
  const cx = 5486400;
  const cy = 3086100;
  return `<w:p><w:pPr><w:spacing w:before="180" w:after="180"/></w:pPr><w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:effectExtent l="0" t="0" r="0" b="0"/><wp:docPr id="${index}" name="Picture ${index}" descr="插图"/><wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="1"/></wp:cNvGraphicFramePr><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="${index}" name="image${index}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${rId}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`;
}

function getImageExtensionFromMime(mime) {
  const normalized = String(mime || "").toLowerCase();
  if (normalized.includes("jpeg") || normalized.includes("jpg")) return "jpg";
  if (normalized.includes("gif")) return "gif";
  if (normalized.includes("bmp")) return "bmp";
  if (normalized.includes("webp")) return "webp";
  return "png";
}

function getImageContentType(extension) {
  if (extension === "jpg") return "image/jpeg";
  return `image/${extension}`;
}

async function loadImagePart(url) {
  const source = String(url || "");
  const dataUrl = source.match(/^data:([^;,]+)?(;base64)?,(.*)$/i);
  if (dataUrl) {
    const mime = dataUrl[1] || "image/png";
    const data = dataUrl[2] ? Buffer.from(dataUrl[3], "base64") : Buffer.from(decodeURIComponent(dataUrl[3] || ""));
    return { data, extension: getImageExtensionFromMime(mime) };
  }

  const response = await fetch(source);
  if (!response.ok) throw new Error(`图片下载失败：${response.status}`);
  const mime = response.headers.get("content-type") || "image/png";
  const data = Buffer.from(await response.arrayBuffer());
  return { data, extension: getImageExtensionFromMime(mime) };
}

const CRC32_TABLE = Array.from({ length: 256 }, (_, index) => {
  let crc = index;
  for (let bit = 0; bit < 8; bit += 1) crc = (crc & 1) ? (0xedb88320 ^ (crc >>> 1)) : (crc >>> 1);
  return crc >>> 0;
});

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = CRC32_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function createZip(entries) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  const dosTime = 0;
  const dosDate = ((2024 - 1980) << 9) | (1 << 5) | 1;

  entries.forEach((entry) => {
    const name = Buffer.from(entry.name, "utf8");
    const data = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(String(entry.data), "utf8");
    const checksum = crc32(data);
    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0x0800, 6);
    localHeader.writeUInt16LE(0, 8);
    localHeader.writeUInt16LE(dosTime, 10);
    localHeader.writeUInt16LE(dosDate, 12);
    localHeader.writeUInt32LE(checksum, 14);
    localHeader.writeUInt32LE(data.length, 18);
    localHeader.writeUInt32LE(data.length, 22);
    localHeader.writeUInt16LE(name.length, 26);
    localHeader.writeUInt16LE(0, 28);
    localParts.push(localHeader, name, data);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0x0800, 8);
    centralHeader.writeUInt16LE(0, 10);
    centralHeader.writeUInt16LE(dosTime, 12);
    centralHeader.writeUInt16LE(dosDate, 14);
    centralHeader.writeUInt32LE(checksum, 16);
    centralHeader.writeUInt32LE(data.length, 20);
    centralHeader.writeUInt32LE(data.length, 24);
    centralHeader.writeUInt16LE(name.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(0, 38);
    centralHeader.writeUInt32LE(offset, 42);
    centralParts.push(centralHeader, name);
    offset += localHeader.length + name.length + data.length;
  });

  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat([...localParts, centralDirectory, end]);
}

async function buildDocxBuffer({ title, blocks }) {
  const bodyParts = [buildDocxParagraph([{ text: title, bold: true }], { title: true })];
  const relationships = [];
  const imageParts = [];
  let imageIndex = 1;

  for (const block of blocks) {
    if (block.type === "image" && block.url) {
      try {
        const image = await loadImagePart(block.url);
        const rId = `rId${imageIndex}`;
        const fileName = `image${imageIndex}.${image.extension}`;
        relationships.push({ id: rId, target: `media/${fileName}` });
        imageParts.push({ name: `word/media/${fileName}`, data: image.data, extension: image.extension });
        bodyParts.push(buildDocxImageParagraph(rId, imageIndex));
        imageIndex += 1;
      } catch {
        bodyParts.push(buildDocxParagraph([{ text: `插图：${block.url}`, bold: false }]));
      }
      continue;
    }
    bodyParts.push(buildDocxParagraph(paragraphHtmlToRuns(block.html, block.text)));
  }

  const imageDefaults = [...new Set(imageParts.map((part) => part.extension))]
    .map((extension) => `<Default Extension="${extension}" ContentType="${getImageContentType(extension)}"/>`)
    .join("");
  const documentRelationships = relationships
    .map((rel) => `<Relationship Id="${rel.id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="${rel.target}"/>`)
    .join("");

  return createZip([
    {
      name: "[Content_Types].xml",
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>${imageDefaults}<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`,
    },
    {
      name: "_rels/.rels",
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`,
    },
    {
      name: "word/_rels/document.xml.rels",
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${documentRelationships}</Relationships>`,
    },
    {
      name: "word/document.xml",
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><w:body>${bodyParts.join("")}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr></w:body></w:document>`,
    },
    ...imageParts,
  ]);
}

async function handleSaveArticle(req, res) {
  try {
    const raw = await collectBody(req);
    const input = JSON.parse(raw || "{}");
    const title = cleanArticleTitle(input.title);
    const blocks = Array.isArray(input.blocks) ? input.blocks : [];
    if (!title) {
      sendJson(res, 400, { error: "没有可保存的文章标题" });
      return;
    }
    if (!blocks.length) {
      sendJson(res, 400, { error: "没有可保存的正文内容" });
      return;
    }

    await fs.promises.mkdir(EXPORT_DIR, { recursive: true });
    const { filename, filePath } = await getUniqueExportPath(title);
    const docxBuffer = await buildDocxBuffer({ title, blocks });
    await fs.promises.writeFile(filePath, docxBuffer);
    sendJson(res, 200, { ok: true, filename, path: filePath });
  } catch (error) {
    sendJson(res, 500, { error: error.message || "保存到本地失败" });
  }
}

function serveHtml(res) {
  fs.readFile(HTML_FILE, (error, html) => {
    if (error) {
      res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("无法读取图文生成器 HTML 文件");
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

  if (req.url === "/api/save-article" && req.method === "POST") {
    handleSaveArticle(req, res);
    return;
  }

  sendJson(res, 404, { error: "Not found" });
});

server.listen(PORT, () => {
  console.log(`DeepSeek local proxy running at http://localhost:${PORT}`);
  console.log(`Default model: ${ENV_MODEL}`);
  console.log("Open the page, paste your DeepSeek API Key, then generate.");
});
