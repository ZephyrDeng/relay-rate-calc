const MAX_VISION_IMAGES = 6;

const VISION_SYSTEM_PROMPT =
  "你是中转站倍率计算器的参数提取助手。用户可能上传多张截图（充值页、预览页、令牌页等），请合并所有图片信息，只输出严格 JSON，不要 markdown 代码块。";

const VISION_USER_PROMPT = `分析这些 AI 中转站截图（可能来自同一渠道的不同页面），合并提取计算器需要的参数。

请只返回一个 JSON 对象，字段如下（无法识别填 null）：
{
  "baseCnyPerUsd": number | null,
  "discountZhe": number | null,
  "paymentMultiplier": number | null,
  "discountPercent": number | null,
  "rechargeCny": number | null,
  "rechargeUsd": number | null,
  "routeMultiplier": number | null,
  "inputMode": "zhe" | "multiplier" | null,
  "notes": string
}

合并规则：
- 充值页「实付 ¥70 ≈ $10」→ rechargeCny=70, rechargeUsd=10, baseCnyPerUsd=7
- 预览页「-80%」→ discountPercent=-80, discountZhe=2, paymentMultiplier=0.2, inputMode="zhe"
- 「N 折」→ discountZhe=N, paymentMultiplier=N/10
- 「倍率 1x」是线路倍率 routeMultiplier=1，通常不改变折扣
- 充值页通常只有汇率（支付倍率=1）；预览页才有模型折扣，需与充值页合并
- 多图信息冲突时，优先采用更明确、更完整的字段；notes 用中文说明合并依据`;

let visionState = {
  images: [],
  analyzing: false,
  nextId: 1,
};

function isAgnesConfigured() {
  const key = AGNES_CONFIG?.apiKey?.trim();
  return Boolean(key && !key.includes("PASTE_YOUR_AGNES"));
}

function createVisionImageId() {
  const id = visionState.nextId;
  visionState.nextId += 1;
  return id;
}

function readImageFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("读取图片失败"));
    reader.readAsDataURL(file);
  });
}

function parseVisionJson(text) {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1].trim() : trimmed;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    throw new Error("模型返回中未找到 JSON");
  }
  return JSON.parse(candidate.slice(start, end + 1));
}

function toPositiveNumber(value) {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) return null;
  return num;
}

function normalizeExtractedParams(raw) {
  const result = {
    baseCnyPerUsd: toPositiveNumber(raw.baseCnyPerUsd),
    discountZhe: toPositiveNumber(raw.discountZhe),
    paymentMultiplier: toPositiveNumber(raw.paymentMultiplier),
    rechargeCny: toPositiveNumber(raw.rechargeCny),
    rechargeUsd: toPositiveNumber(raw.rechargeUsd),
    routeMultiplier: toPositiveNumber(raw.routeMultiplier),
    inputMode: raw.inputMode === "multiplier" ? "multiplier" : "zhe",
    notes: typeof raw.notes === "string" ? raw.notes.trim() : "",
  };

  if (!result.baseCnyPerUsd && result.rechargeCny && result.rechargeUsd) {
    result.baseCnyPerUsd = result.rechargeCny / result.rechargeUsd;
  }

  if (typeof raw.discountPercent === "number" && Number.isFinite(raw.discountPercent)) {
    const payRatio = (100 + raw.discountPercent) / 100;
    if (payRatio > 0 && payRatio <= 1) {
      result.paymentMultiplier = payRatio;
      result.discountZhe = payRatio * 10;
      result.inputMode = "zhe";
    }
  }

  if (!result.paymentMultiplier && result.discountZhe) {
    result.paymentMultiplier = result.discountZhe / 10;
    result.inputMode = "zhe";
  }

  return result;
}

function describeAppliedParams(params, formatNumber) {
  const parts = [];
  if (params.baseCnyPerUsd) {
    parts.push(`基准汇率 ¥${formatNumber(params.baseCnyPerUsd)}:$1`);
  }
  if (params.inputMode === "zhe" && params.discountZhe) {
    parts.push(`${formatNumber(params.discountZhe)} 折`);
  } else if (params.paymentMultiplier) {
    parts.push(`支付倍率 ${formatNumber(params.paymentMultiplier)}`);
  }
  if (params.routeMultiplier && params.routeMultiplier !== 1) {
    parts.push(`线路倍率 ${formatNumber(params.routeMultiplier)}x`);
  }
  if (params.notes) {
    parts.push(params.notes);
  }
  return parts.join(" · ");
}

async function analyzeScreenshots(images) {
  if (!isAgnesConfigured()) {
    throw new Error("请先在 agnes-config.js 填入 Agnes 免费 API Key");
  }
  if (!images.length) {
    throw new Error("请先添加至少一张截图");
  }

  const imageBlocks = images.map((image, index) => ({
    type: "image_url",
    image_url: { url: image.dataUrl },
    _index: index + 1,
  }));

  const prompt =
    images.length > 1
      ? `${VISION_USER_PROMPT}\n\n共 ${images.length} 张截图，请按顺序综合判断。`
      : VISION_USER_PROMPT;

  const content = [{ type: "text", text: prompt }, ...imageBlocks.map(({ _index, ...block }) => block)];

  const response = await fetch(`${AGNES_CONFIG.apiBase}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${AGNES_CONFIG.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: AGNES_CONFIG.model,
      temperature: 0,
      max_tokens: 1000,
      messages: [
        { role: "system", content: VISION_SYSTEM_PROMPT },
        { role: "user", content },
      ],
    }),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message =
      payload?.error?.message || payload?.message || `Agnes API 请求失败 (${response.status})`;
    throw new Error(message);
  }

  const rawContent = payload?.choices?.[0]?.message?.content;
  if (!rawContent) {
    throw new Error("Agnes 未返回识别结果");
  }

  const text = typeof rawContent === "string" ? rawContent : JSON.stringify(rawContent);
  return normalizeExtractedParams(parseVisionJson(text));
}

function applyVisionParams(params, deps) {
  const { elements, setMode, recalculate, formatNumber } = deps;
  let applied = false;

  if (params.baseCnyPerUsd) {
    elements.baseRate.value = formatNumber(params.baseCnyPerUsd, 6);
    applied = true;
  }

  if (params.inputMode === "multiplier" && params.paymentMultiplier) {
    setMode("multiplier");
    elements.discountValue.value = formatNumber(params.paymentMultiplier, 6);
    applied = true;
  } else if (params.discountZhe) {
    setMode("zhe");
    elements.discountValue.value = formatNumber(params.discountZhe, 4);
    applied = true;
  } else if (params.paymentMultiplier) {
    setMode("multiplier");
    elements.discountValue.value = formatNumber(params.paymentMultiplier, 6);
    applied = true;
  }

  if (!applied) {
    throw new Error("未能从截图中提取有效参数，请补充更完整的截图");
  }

  recalculate();
  return describeAppliedParams(params, formatNumber);
}

function setVisionStatus(elements, message, tone = "neutral") {
  elements.visionStatus.textContent = message;
  elements.visionStatus.classList.remove("hidden", "is-error", "is-success");
  if (tone === "error") elements.visionStatus.classList.add("is-error");
  if (tone === "success") elements.visionStatus.classList.add("is-success");
}

function renderVisionGallery(elements, deps) {
  const gallery = elements.visionGallery;
  gallery.innerHTML = "";

  if (!visionState.images.length) {
    gallery.classList.add("hidden");
    return;
  }

  gallery.classList.remove("hidden");

  visionState.images.forEach((image, index) => {
    const item = document.createElement("article");
    item.className = "vision-thumb";
    item.dataset.id = String(image.id);

    const frame = document.createElement("div");
    frame.className = "vision-thumb-frame";

    const img = document.createElement("img");
    img.src = image.dataUrl;
    img.alt = image.fileName || `截图 ${index + 1}`;
    img.className = "vision-thumb-image";
    frame.append(img);

    const meta = document.createElement("div");
    meta.className = "vision-thumb-meta";

    const label = document.createElement("p");
    label.className = "vision-thumb-label";
    label.textContent = image.fileName || `截图 ${index + 1}`;
    label.title = label.textContent;

    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.className = "vision-thumb-remove";
    removeBtn.setAttribute("aria-label", `移除 ${label.textContent}`);
    removeBtn.textContent = "移除";
    removeBtn.addEventListener("click", (event) => {
      event.stopPropagation();
      removeVisionImage(image.id, deps);
    });

    meta.append(label, removeBtn);
    item.append(frame, meta);
    gallery.append(item);
  });
}

function updateVisionUi(elements) {
  const count = visionState.images.length;
  const atLimit = count >= MAX_VISION_IMAGES;

  elements.visionFileName.textContent =
    count === 0
      ? "点击、拖拽或粘贴截图"
      : atLimit
        ? `已添加 ${count} 张截图（已达上限 ${MAX_VISION_IMAGES} 张）`
        : `已添加 ${count} 张截图，可继续添加（最多 ${MAX_VISION_IMAGES} 张）`;

  elements.visionDropzone.classList.toggle("has-images", count > 0);
  elements.visionDropzone.classList.toggle("is-full", atLimit);
  elements.visionAnalyze.disabled =
    count === 0 || !isAgnesConfigured() || visionState.analyzing;
}

function clearVisionImages(elements, deps) {
  visionState.images = [];
  elements.visionFile.value = "";
  renderVisionGallery(elements, deps);
  updateVisionUi(elements);
}

function removeVisionImage(id, deps) {
  visionState.images = visionState.images.filter((image) => image.id !== id);
  renderVisionGallery(deps.elements, deps);
  updateVisionUi(deps.elements);
}

function extractPastedImages(event) {
  const files = [];
  const seen = new Set();
  const clipboard = event.clipboardData;
  if (!clipboard) return files;

  const pushFile = (file) => {
    if (!file?.type?.startsWith("image/")) return;
    const key = `${file.type}:${file.size}:${file.lastModified}`;
    if (seen.has(key)) return;
    seen.add(key);
    files.push(file);
  };

  for (const item of clipboard.items || []) {
    if (item.kind === "file" && item.type.startsWith("image/")) {
      pushFile(item.getAsFile());
    }
  }

  for (const file of clipboard.files || []) {
    pushFile(file);
  }

  return files;
}

function isTextInputTarget(target) {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

function shouldInterceptVisionPaste(event) {
  const pastedFiles = extractPastedImages(event);
  if (!pastedFiles.length) return false;

  const target = event.target;
  if (target instanceof HTMLElement && target.closest(".vision-field")) {
    return true;
  }

  return !isTextInputTarget(target);
}

async function handleVisionPaste(event, deps) {
  if (!shouldInterceptVisionPaste(event)) return false;

  const pastedFiles = extractPastedImages(event);
  if (!pastedFiles.length) return false;

  event.preventDefault();

  const { elements } = deps;
  if (visionState.images.length >= MAX_VISION_IMAGES) {
    setVisionStatus(elements, `最多添加 ${MAX_VISION_IMAGES} 张截图`, "error");
    return true;
  }

  try {
    await addVisionFiles(pastedFiles, deps, { source: "paste" });
  } catch (error) {
    setVisionStatus(elements, error.message, "error");
  }

  return true;
}

async function addVisionFiles(fileList, deps, options = {}) {
  const { elements } = deps;
  const files = Array.from(fileList || []).filter((file) => file?.type?.startsWith("image/"));

  if (!files.length) {
    setVisionStatus(elements, "请上传 PNG / JPG / WebP 截图", "error");
    return;
  }

  const remaining = MAX_VISION_IMAGES - visionState.images.length;
  if (remaining <= 0) {
    setVisionStatus(elements, `最多添加 ${MAX_VISION_IMAGES} 张截图`, "error");
    return;
  }

  const accepted = files.slice(0, remaining);
  const skipped = files.length - accepted.length;

  for (const file of accepted) {
    const dataUrl = await readImageFile(file);
    const index = visionState.images.length + 1;
    const defaultName =
      options.source === "paste" ? `粘贴截图 ${index}` : `截图 ${index}`;
    visionState.images.push({
      id: createVisionImageId(),
      dataUrl,
      fileName: file.name || defaultName,
    });
  }

  renderVisionGallery(elements, deps);
  updateVisionUi(elements);

  let message = `已添加 ${accepted.length} 张截图，共 ${visionState.images.length} 张`;
  if (skipped > 0) {
    message += `（另有 ${skipped} 张因达到上限未添加）`;
  }
  message += "，点击「识别并填参」";

  setVisionStatus(
    elements,
    isAgnesConfigured() ? message : "请先在 agnes-config.js 填入 Agnes 免费 API Key",
    isAgnesConfigured() ? "neutral" : "error"
  );
}

function initVisionCapture(deps) {
  const { elements } = deps;
  if (!elements.visionDropzone) return;

  elements.visionFile.multiple = true;

  if (!isAgnesConfigured()) {
    setVisionStatus(
      elements,
      "请在 agnes-config.js 填入 Agnes 免费 API Key 后刷新页面",
      "error"
    );
  }

  updateVisionUi(elements);

  elements.visionDropzone.addEventListener("click", () => {
    elements.visionDropzone.focus();
    if (visionState.images.length >= MAX_VISION_IMAGES) return;
    elements.visionFile.click();
  });

  elements.visionFile.addEventListener("change", async () => {
    const files = elements.visionFile.files;
    if (!files?.length) return;
    try {
      await addVisionFiles(files, deps);
    } catch (error) {
      setVisionStatus(elements, error.message, "error");
    } finally {
      elements.visionFile.value = "";
    }
  });

  elements.visionDropzone.addEventListener("dragover", (event) => {
    if (visionState.images.length >= MAX_VISION_IMAGES) return;
    event.preventDefault();
    elements.visionDropzone.classList.add("is-dragover");
  });

  elements.visionDropzone.addEventListener("dragleave", () => {
    elements.visionDropzone.classList.remove("is-dragover");
  });

  elements.visionDropzone.addEventListener("drop", async (event) => {
    event.preventDefault();
    elements.visionDropzone.classList.remove("is-dragover");
    if (visionState.images.length >= MAX_VISION_IMAGES) {
      setVisionStatus(elements, `最多添加 ${MAX_VISION_IMAGES} 张截图`, "error");
      return;
    }
    try {
      await addVisionFiles(event.dataTransfer?.files, deps);
    } catch (error) {
      setVisionStatus(elements, error.message, "error");
    }
  });

  document.addEventListener("paste", (event) => {
    handleVisionPaste(event, deps);
  });

  elements.visionClear.addEventListener("click", () => {
    clearVisionImages(elements, deps);
    setVisionStatus(elements, "已清除全部截图");
  });

  elements.visionAnalyze.addEventListener("click", async () => {
    if (!visionState.images.length || visionState.analyzing) return;

    visionState.analyzing = true;
    updateVisionUi(elements);
    setVisionStatus(
      elements,
      `正在调用 Agnes 识图（${visionState.images.length} 张）…`
    );

    try {
      const params = await analyzeScreenshots(visionState.images);
      const summary = applyVisionParams(params, deps);
      setVisionStatus(elements, `已识别：${summary}`, "success");
    } catch (error) {
      setVisionStatus(elements, error.message, "error");
    } finally {
      visionState.analyzing = false;
      updateVisionUi(elements);
    }
  });
}