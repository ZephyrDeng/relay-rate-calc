const GITHUB_REPO = {
  owner: "ZephyrDeng",
  repo: "relay-rate-calc",
};

const GITHUB_STAR_CACHE_KEY = "relay-rate-calc:github-stars";
const GITHUB_STAR_CACHE_TTL_MS = 30 * 60 * 1000;
const GITHUB_STAR_SYNC_INTERVAL_MS = GITHUB_STAR_CACHE_TTL_MS;

let githubStarRefreshTimer = null;
let githubStarSyncStarted = false;
let githubStarHiddenAt = null;

const PRESETS = {
  channel1: { baseCnyPerUsd: 1, mode: "zhe", discountValue: 5 },
  channel2: { baseCnyPerUsd: 7, mode: "zhe", discountValue: 1.5 },
};

const MARKET_RATE_PROVIDERS = [
  {
    name: "Frankfurter",
    fetchRate: async () => {
      const response = await fetch(
        "https://api.frankfurter.dev/v1/latest?from=USD&to=CNY"
      );
      if (!response.ok) throw new Error("Frankfurter request failed");
      const data = await response.json();
      const rate = data?.rates?.CNY;
      if (!Number.isFinite(rate) || rate <= 0) {
        throw new Error("Frankfurter returned invalid rate");
      }
      return {
        cnyPerUsd: rate,
        source: "Frankfurter (ECB)",
        date: data.date,
      };
    },
  },
  {
    name: "open.er-api.com",
    fetchRate: async () => {
      const response = await fetch("https://open.er-api.com/v6/latest/USD");
      if (!response.ok) throw new Error("open.er-api request failed");
      const data = await response.json();
      const rate = data?.rates?.CNY;
      if (!Number.isFinite(rate) || rate <= 0) {
        throw new Error("open.er-api returned invalid rate");
      }
      return {
        cnyPerUsd: rate,
        source: "open.er-api.com",
        date: data.time_last_update_utc,
      };
    },
  },
];

const elements = {
  baseRate: document.getElementById("base-rate"),
  discountValue: document.getElementById("discount-value"),
  discountLabel: document.getElementById("discount-label"),
  discountSuffix: document.getElementById("discount-suffix"),
  discountTip: document.getElementById("discount-tip"),
  multiplierPreview: document.getElementById("multiplier-preview"),
  modeButtons: document.querySelectorAll(".mode-btn"),
  presetButtons: document.querySelectorAll(".preset-btn"),
  errorMessage: document.getElementById("error-message"),
  results: document.getElementById("results"),
  normalizedMultiplier: document.getElementById("normalized-multiplier"),
  equivalentTip: document.getElementById("equivalent-tip"),
  cnyPerUsd: document.getElementById("cny-per-usd"),
  usdPerCny: document.getElementById("usd-per-cny"),
  marketRateValue: document.getElementById("market-rate-value"),
  marketRateMeta: document.getElementById("market-rate-meta"),
  refreshMarketRate: document.getElementById("refresh-market-rate"),
  applyMarketRate: document.getElementById("apply-market-rate"),
  marketCompare: document.getElementById("market-compare"),
  marketAdvantage: document.getElementById("market-advantage"),
  marketCompareTip: document.getElementById("market-compare-tip"),
  marketRateTip: document.getElementById("market-rate-tip"),
  pricingTip: document.getElementById("pricing-tip"),
  costScenarios: document.getElementById("cost-scenarios"),
  visionGallery: document.getElementById("vision-gallery"),
  visionDropzone: document.getElementById("vision-dropzone"),
  visionFileName: document.getElementById("vision-file-name"),
  visionFile: document.getElementById("vision-file"),
  visionAnalyze: document.getElementById("vision-analyze"),
  visionClear: document.getElementById("vision-clear"),
  visionStatus: document.getElementById("vision-status"),
};

let currentMode = "zhe";
let marketRate = null;
let marketRateLoading = false;

function zheToMultiplier(zhe) {
  return zhe / 10;
}

function calcRelayRate({ baseCnyPerUsd, paymentMultiplier }) {
  const normalizedMultiplier = baseCnyPerUsd * paymentMultiplier;
  const usdPerCny = 1 / normalizedMultiplier;
  const cnyPerUsd = normalizedMultiplier;
  return { normalizedMultiplier, usdPerCny, cnyPerUsd };
}

function calcMarketAdvantage({ relayUsdPerCny, marketCnyPerUsd }) {
  const marketUsdPerCny = 1 / marketCnyPerUsd;
  return relayUsdPerCny / marketUsdPerCny;
}

function formatNumber(value, maxDecimals = 4) {
  if (!Number.isFinite(value)) return "—";
  const fixed = value.toFixed(maxDecimals);
  return fixed.replace(/\.?0+$/, "");
}

function formatUsd(value) {
  if (!Number.isFinite(value)) return "—";
  if (value >= 0.01) return `$${formatNumber(value, 4)}`;
  return `$${formatNumber(value, 6)}`;
}

function formatCny(value) {
  if (!Number.isFinite(value)) return "—";
  if (value >= 0.01) return `¥${formatNumber(value, 4)}`;
  return `¥${formatNumber(value, 6)}`;
}

function describeRelayVsOfficial(relayCny, officialCnyEquivalent) {
  if (!Number.isFinite(relayCny) || !Number.isFinite(officialCnyEquivalent)) {
    return { text: "—", tone: "neutral" };
  }

  const ratio = relayCny / officialCnyEquivalent;
  if (Math.abs(ratio - 1) < 0.005) {
    return { text: "与官方等价（按市场汇率换算）", tone: "neutral" };
  }
  if (ratio < 1) {
    return {
      text: `比官方便宜 ${formatNumber((1 - ratio) * 100, 1)}%`,
      tone: "cheaper",
    };
  }
  return {
    text: `比官方贵 ${formatNumber((ratio - 1) * 100, 1)}%`,
    tone: "expensive",
  };
}

function multiplierToZhe(multiplier) {
  return multiplier * 10;
}

function describeEquivalent(normalizedMultiplier) {
  const zhe = multiplierToZhe(normalizedMultiplier);
  if (Math.abs(zhe - 10) < 0.0001) {
    return "相当于原价（10 折）";
  }
  if (zhe > 10) {
    return `相当于 ${formatNumber(zhe, 2)} 折（溢价 ${formatNumber(zhe - 10, 2)}%）`;
  }
  return `相当于 ${formatNumber(zhe, 2)} 折`;
}

function describeMarketComparison(advantageMultiplier, marketCnyPerUsd) {
  const marketLabel = `¥${formatNumber(marketCnyPerUsd, 2)}:$1`;
  if (advantageMultiplier >= 1) {
    return `同样花 1 元，比市场汇率（${marketLabel}）能多换约 ${formatNumber(advantageMultiplier, 2)} 倍美元`;
  }
  return `同样花 1 元，只能换到市场汇率（${marketLabel}）水平的约 ${formatNumber(advantageMultiplier * 100, 1)}%`;
}

function parsePositiveNumber(raw) {
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    return null;
  }
  return value;
}

function getPaymentMultiplier() {
  const discountValue = parsePositiveNumber(elements.discountValue.value);
  if (discountValue === null) return null;

  if (currentMode === "zhe") {
    return zheToMultiplier(discountValue);
  }
  return discountValue;
}

function setMode(mode) {
  currentMode = mode;
  const isZhe = mode === "zhe";

  elements.modeButtons.forEach((button) => {
    const active = button.dataset.mode === mode;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", String(active));
  });

  elements.discountLabel.textContent = isZhe ? "折扣（折）" : "支付倍率";
  elements.discountSuffix.textContent = isZhe ? "折" : "";
  elements.discountTip.textContent = isZhe
    ? "5 折 = 支付原价的 50%。"
    : "直接输入支付倍率，如 0.5、0.15。";
  elements.multiplierPreview.classList.toggle("hidden", !isZhe);
}

function updateMultiplierPreview(paymentMultiplier) {
  if (currentMode !== "zhe") return;
  elements.multiplierPreview.textContent = `×${formatNumber(paymentMultiplier)}`;
}

function showError(message) {
  elements.errorMessage.textContent = message;
  elements.errorMessage.classList.remove("hidden");
  elements.results.classList.add("disabled");
}

function clearError() {
  elements.errorMessage.textContent = "";
  elements.errorMessage.classList.add("hidden");
  elements.results.classList.remove("disabled");
}

function setMarketRateMeta(message, visible = true) {
  elements.marketRateMeta.textContent = message;
  elements.marketRateMeta.classList.toggle("is-visible", visible);
}

function setMarketRateLoading(isLoading) {
  marketRateLoading = isLoading;
  elements.refreshMarketRate.disabled = isLoading;
  elements.applyMarketRate.disabled = isLoading || !marketRate;
  if (isLoading) {
    setMarketRateMeta("获取中…", true);
  }
}

function renderMarketRate() {
  if (!marketRate) return;

  elements.marketRateValue.textContent = formatNumber(marketRate.cnyPerUsd, 4);
  elements.marketRateTip.textContent = `来源：${marketRate.source} · 更新：${marketRate.date}。可一键填入基准汇率。`;
  setMarketRateMeta("", false);
  elements.applyMarketRate.disabled = false;
}

function hideMarketComparison() {
  elements.marketCompare.classList.add("hidden");
}

function renderCostScenarios({ normalizedMultiplier, hasValidRate }) {
  if (!hasValidRate) {
    elements.costScenarios.innerHTML =
      '<p class="hint">请先输入有效的基准汇率与折扣。</p>';
    return;
  }

  elements.costScenarios.innerHTML = REFERENCE_SCENARIOS.map((scenario) => {
    const usdCost = calcScenarioUsdCost(scenario);
    const relayCny = calcRelayCnyCost({ usdCost, normalizedMultiplier });
    const officialCnyEquivalent = marketRate
      ? calcMarketCnyCost({ usdCost, marketCnyPerUsd: marketRate.cnyPerUsd })
      : null;
    const compareDesc = describeRelayVsOfficial(relayCny, officialCnyEquivalent);
    const compareClass = `cost-metric-note compare compare-${compareDesc.tone}`;

    return `
      <article class="cost-item">
        <div class="cost-item-top">
          <div>
            <p class="cost-provider">${scenario.provider}</p>
            <p class="cost-title" title="${scenario.description}">${scenario.label}</p>
          </div>
        </div>
        <div class="cost-metrics">
          <div class="cost-metric">
            <p class="cost-metric-label">官方 API</p>
            <p class="cost-metric-value">${formatUsd(usdCost)}</p>
          </div>
          <div class="cost-metric">
            <p class="cost-metric-label" title="按市场汇率换算">官方等价</p>
            <p class="cost-metric-value">${
              officialCnyEquivalent === null ? "—" : formatCny(officialCnyEquivalent)
            }</p>
          </div>
          <div class="cost-metric">
            <p class="cost-metric-label">中转实付</p>
            <p class="cost-metric-value relay">${formatCny(relayCny)}</p>
            <p class="${compareClass}">${compareDesc.text}</p>
          </div>
        </div>
      </article>
    `;
  }).join("");
}

function updateMarketComparison(relayUsdPerCny) {
  if (!marketRate) {
    hideMarketComparison();
    return;
  }

  const advantageMultiplier = calcMarketAdvantage({
    relayUsdPerCny,
    marketCnyPerUsd: marketRate.cnyPerUsd,
  });

  elements.marketAdvantage.textContent = formatNumber(advantageMultiplier, 2);
  elements.marketCompareTip.textContent = describeMarketComparison(
    advantageMultiplier,
    marketRate.cnyPerUsd
  );
  elements.marketCompare.classList.remove("hidden");
}

async function fetchMarketRate() {
  setMarketRateLoading(true);
  let lastError = null;

  for (const provider of MARKET_RATE_PROVIDERS) {
    try {
      marketRate = await provider.fetchRate();
      renderMarketRate();
      setMarketRateLoading(false);
      recalculate();
      return;
    } catch (error) {
      lastError = error;
    }
  }

  elements.marketRateValue.textContent = "—";
  setMarketRateMeta("获取失败，请重试", true);
  elements.applyMarketRate.disabled = true;
  hideMarketComparison();
  setMarketRateLoading(false);
  console.error("Market rate fetch failed:", lastError);
}

function recalculate() {
  const baseCnyPerUsd = parsePositiveNumber(elements.baseRate.value);
  const paymentMultiplier = getPaymentMultiplier();

  if (baseCnyPerUsd === null) {
    showError("请输入大于 0 的基准汇率。");
    hideMarketComparison();
    renderCostScenarios({ normalizedMultiplier: null, hasValidRate: false });
    return;
  }

  if (paymentMultiplier === null) {
    showError(
      currentMode === "zhe"
        ? "请输入大于 0 的折扣（折）。"
        : "请输入大于 0 的支付倍率。"
    );
    hideMarketComparison();
    renderCostScenarios({ normalizedMultiplier: null, hasValidRate: false });
    return;
  }

  clearError();
  updateMultiplierPreview(paymentMultiplier);

  const result = calcRelayRate({ baseCnyPerUsd, paymentMultiplier });

  elements.normalizedMultiplier.textContent = formatNumber(
    result.normalizedMultiplier
  );
  elements.equivalentTip.textContent = `按 ¥1:$1 基准换算；${describeEquivalent(
    result.normalizedMultiplier
  )}。`;
  elements.cnyPerUsd.textContent = formatNumber(result.cnyPerUsd);
  elements.usdPerCny.textContent = formatNumber(result.usdPerCny);
  updateMarketComparison(result.usdPerCny);
  renderCostScenarios({
    normalizedMultiplier: result.normalizedMultiplier,
    hasValidRate: true,
  });
}

function applyPreset(presetKey) {
  const preset = PRESETS[presetKey];
  if (!preset) return;

  elements.baseRate.value = String(preset.baseCnyPerUsd);
  setMode(preset.mode);
  elements.discountValue.value = String(preset.discountValue);
  recalculate();
}

function applyMarketRateToBase() {
  if (!marketRate) return;
  elements.baseRate.value = formatNumber(marketRate.cnyPerUsd, 6);
  recalculate();
}

elements.modeButtons.forEach((button) => {
  button.addEventListener("click", () => {
    setMode(button.dataset.mode);
    recalculate();
  });
});

elements.presetButtons.forEach((button) => {
  button.addEventListener("click", () => {
    applyPreset(button.dataset.preset);
  });
});

[elements.baseRate, elements.discountValue].forEach((input) => {
  input.addEventListener("input", recalculate);
});

elements.refreshMarketRate.addEventListener("click", fetchMarketRate);
elements.applyMarketRate.addEventListener("click", applyMarketRateToBase);

if (elements.pricingTip) {
  elements.pricingTip.textContent = `${PRICING_META.note} 更新：${PRICING_META.updatedAt}。官方按美元计费，中转按人民币实付；请用「官方等价」对比，勿直接比 $ 与 ¥ 数值。`;
}

function getGithubStarShieldsUrl() {
  return `https://img.shields.io/github/stars/${GITHUB_REPO.owner}/${GITHUB_REPO.repo}.json`;
}

function readGithubStarCache() {
  try {
    const raw = localStorage.getItem(GITHUB_STAR_CACHE_KEY);
    if (!raw) return null;

    const cache = JSON.parse(raw);
    if (!cache?.count || !Number.isFinite(cache.fetchedAt)) return null;
    return cache;
  } catch {
    return null;
  }
}

function writeGithubStarCache(count) {
  try {
    localStorage.setItem(
      GITHUB_STAR_CACHE_KEY,
      JSON.stringify({ count, fetchedAt: Date.now() })
    );
  } catch {
    // Ignore quota or privacy mode errors.
  }
}

function isGithubStarCacheFresh(cache) {
  return Date.now() - cache.fetchedAt < GITHUB_STAR_CACHE_TTL_MS;
}

function renderGithubStarCount(starCountEl, count) {
  starCountEl.textContent = count || "—";
}

function isValidStarCountDisplay(value) {
  return /^\d+(\.\d+)?k?$/i.test(String(value).trim());
}

function formatGithubApiStarCount(count) {
  if (!Number.isFinite(count) || count < 0) return null;
  if (count >= 10000) {
    return `${(count / 1000).toFixed(1).replace(/\.0$/, "")}k`;
  }
  if (count >= 1000) {
    return `${(count / 1000).toFixed(1)}k`;
  }
  return String(count);
}

function parseShieldsStarCount(data) {
  const count = data?.message ?? data?.value;
  if (typeof count !== "string") return null;

  const trimmed = count.trim();
  return isValidStarCountDisplay(trimmed) ? trimmed : null;
}

async function fetchGithubStarCountFromApi() {
  const response = await fetch(
    `https://api.github.com/repos/${GITHUB_REPO.owner}/${GITHUB_REPO.repo}`,
    { headers: { Accept: "application/vnd.github+json" } }
  );
  if (!response.ok) throw new Error("GitHub API request failed");

  const data = await response.json();
  const count = formatGithubApiStarCount(data.stargazers_count);
  if (!count) throw new Error("GitHub API returned invalid star count");
  return count;
}

async function fetchGithubStarCountFromShields() {
  const response = await fetch(getGithubStarShieldsUrl());
  if (!response.ok) throw new Error("shields.io request failed");

  const data = await response.json();
  const count = parseShieldsStarCount(data);
  if (!count) throw new Error("shields.io returned invalid star count");
  return count;
}

async function resolveGithubStarCount() {
  try {
    return await fetchGithubStarCountFromShields();
  } catch {
    return fetchGithubStarCountFromApi();
  }
}

async function fetchGithubStarCount({ force = false, showLoading = false } = {}) {
  const starCountEl = document.getElementById("github-star-count");
  if (!starCountEl) return;

  const cache = readGithubStarCache();
  if (cache && isGithubStarCacheFresh(cache) && !force) {
    renderGithubStarCount(starCountEl, cache.count);
    return;
  }

  if (cache && !force) {
    renderGithubStarCount(starCountEl, cache.count);
  }

  if (showLoading && !cache) {
    starCountEl.classList.add("is-loading");
  }

  try {
    const count = await resolveGithubStarCount();
    writeGithubStarCache(count);
    renderGithubStarCount(starCountEl, count);
  } catch {
    if (cache) {
      renderGithubStarCount(starCountEl, cache.count);
      return;
    }

    if (showLoading || starCountEl.textContent === "—") {
      renderGithubStarCount(starCountEl, "—");
    }
  } finally {
    starCountEl.classList.remove("is-loading");
  }
}

function refreshGithubStarCountIfStale() {
  const cache = readGithubStarCache();
  if (!cache || !isGithubStarCacheFresh(cache)) {
    fetchGithubStarCount();
  }
}

function startGithubStarSync() {
  if (githubStarSyncStarted) return;
  githubStarSyncStarted = true;

  fetchGithubStarCount({ showLoading: true });

  githubStarRefreshTimer = window.setInterval(() => {
    if (document.visibilityState === "visible") {
      refreshGithubStarCountIfStale();
    }
  }, GITHUB_STAR_SYNC_INTERVAL_MS);

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      githubStarHiddenAt = Date.now();
      return;
    }

    const hiddenFor = githubStarHiddenAt ? Date.now() - githubStarHiddenAt : 0;
    if (hiddenFor >= 60 * 1000) {
      fetchGithubStarCount({ force: true });
      return;
    }

    refreshGithubStarCountIfStale();
  });
}

const TIP_GAP = 8;
const TIP_VIEWPORT_PADDING = 8;
const TIP_HIDE_DELAY_MS = 80;

let activeTipControl = null;

function clampTipPosition(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function getTipPlacement(trigger, popRect) {
  const triggerRect = trigger.getBoundingClientRect();
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const preferAbove = Boolean(trigger.closest(".footer"));

  let left = triggerRect.left;
  if (trigger.classList.contains("vision-badge")) {
    left = triggerRect.right - popRect.width;
  } else if (trigger.closest(".main-panel, .footer, .output-card, .cost-card")) {
    left = triggerRect.left + triggerRect.width / 2 - popRect.width / 2;
  }

  left = clampTipPosition(
    left,
    TIP_VIEWPORT_PADDING,
    viewportWidth - popRect.width - TIP_VIEWPORT_PADDING
  );

  const belowTop = triggerRect.bottom + TIP_GAP;
  const aboveTop = triggerRect.top - popRect.height - TIP_GAP;
  const fitsBelow = belowTop + popRect.height <= viewportHeight - TIP_VIEWPORT_PADDING;
  const fitsAbove = aboveTop >= TIP_VIEWPORT_PADDING;

  let top = belowTop;
  let placement = "below";

  if (preferAbove && fitsAbove) {
    top = aboveTop;
    placement = "above";
  } else if (!preferAbove && fitsBelow) {
    top = belowTop;
  } else if (fitsAbove) {
    top = aboveTop;
    placement = "above";
  } else if (fitsBelow) {
    top = belowTop;
  } else {
    top = clampTipPosition(
      belowTop,
      TIP_VIEWPORT_PADDING,
      viewportHeight - popRect.height - TIP_VIEWPORT_PADDING
    );
    placement = "below";
  }

  return { left: Math.round(left), top: Math.round(top), placement };
}

function measureFloatingTip(trigger, popover) {
  popover.classList.add("is-floating", "is-measuring");
  popover.style.visibility = "hidden";
  popover.style.opacity = "1";
  popover.style.pointerEvents = "none";
  popover.style.left = "-9999px";
  popover.style.top = "0";

  const popRect = popover.getBoundingClientRect();
  const placement = getTipPlacement(trigger, popRect);

  popover.classList.remove("is-measuring");
  popover.style.left = `${placement.left}px`;
  popover.style.top = `${placement.top}px`;
  popover.dataset.placement = placement.placement;
  popover.style.visibility = "";
  popover.style.opacity = "";
  popover.style.pointerEvents = "";
}

function mountFloatingTip(trigger, popover) {
  if (!popover._tipHome) {
    popover._tipHome = {
      parent: trigger,
      nextSibling: popover.nextSibling,
    };
  }

  if (popover.parentElement !== document.body) {
    document.body.appendChild(popover);
  }
}

function restoreFloatingTip(trigger, popover) {
  const home = popover._tipHome;
  if (!home || popover.parentElement !== document.body) return;

  if (home.nextSibling) {
    home.parent.insertBefore(popover, home.nextSibling);
  } else {
    home.parent.appendChild(popover);
  }
}

function resetFloatingTip(trigger, popover) {
  popover.classList.remove("is-floating", "is-measuring", "is-open");
  popover.style.left = "";
  popover.style.top = "";
  popover.style.visibility = "";
  popover.style.opacity = "";
  popover.style.pointerEvents = "";
  delete popover.dataset.placement;
  restoreFloatingTip(trigger, popover);
}

function resolveTipPopover(trigger, popover) {
  return (
    popover ||
    activeTipControl?.popover ||
    trigger.querySelector(".tip-popover")
  );
}

function positionFloatingTip(trigger, popover) {
  const tip = resolveTipPopover(trigger, popover);
  if (!tip) return;

  mountFloatingTip(trigger, tip);
  measureFloatingTip(trigger, tip);
}

function hideActiveTip() {
  if (!activeTipControl) return;

  const { trigger, popover, hideTimer } = activeTipControl;
  if (hideTimer) {
    window.clearTimeout(hideTimer);
  }

  resetFloatingTip(trigger, popover);
  activeTipControl = null;
}

function scheduleHideActiveTip() {
  if (!activeTipControl) return;

  if (activeTipControl.hideTimer) {
    window.clearTimeout(activeTipControl.hideTimer);
  }

  activeTipControl.hideTimer = window.setTimeout(() => {
    if (!activeTipControl) return;
    const { trigger, popover } = activeTipControl;
    if (trigger.matches(":hover, :focus-within") || popover.matches(":hover")) {
      return;
    }
    hideActiveTip();
  }, TIP_HIDE_DELAY_MS);
}

function showFloatingTip(trigger) {
  const popover = trigger.querySelector(".tip-popover");
  if (!popover) return;

  if (activeTipControl && activeTipControl.trigger !== trigger) {
    hideActiveTip();
  }

  if (activeTipControl?.hideTimer) {
    window.clearTimeout(activeTipControl.hideTimer);
    activeTipControl.hideTimer = null;
  }

  activeTipControl = { trigger, popover, hideTimer: null };
  popover.classList.add("is-open");
  positionFloatingTip(trigger, popover);
}

function initFloatingTips() {
  const triggers = document.querySelectorAll(".tip-trigger");

  triggers.forEach((trigger) => {
    const popover = trigger.querySelector(".tip-popover");
    if (!popover) return;

    trigger.addEventListener("mouseenter", () => showFloatingTip(trigger));
    trigger.addEventListener("focusin", () => showFloatingTip(trigger));
    trigger.addEventListener("mouseleave", scheduleHideActiveTip);
    trigger.addEventListener("focusout", (event) => {
      if (!trigger.contains(event.relatedTarget) && !popover.contains(event.relatedTarget)) {
        scheduleHideActiveTip();
      }
    });

    popover.addEventListener("mouseenter", () => {
      if (activeTipControl?.trigger === trigger && activeTipControl.hideTimer) {
        window.clearTimeout(activeTipControl.hideTimer);
        activeTipControl.hideTimer = null;
      }
    });
    popover.addEventListener("mouseleave", scheduleHideActiveTip);
  });

  window.addEventListener(
    "resize",
    () => {
      if (activeTipControl) {
        positionFloatingTip(activeTipControl.trigger, activeTipControl.popover);
      }
    },
    { passive: true }
  );

  window.addEventListener(
    "scroll",
    () => {
      if (activeTipControl) {
        positionFloatingTip(activeTipControl.trigger, activeTipControl.popover);
      }
    },
    { capture: true, passive: true }
  );
}

setMode("zhe");
fetchMarketRate();
startGithubStarSync();
recalculate();
initFloatingTips();

if (typeof initVisionCapture === "function") {
  initVisionCapture({
    elements,
    setMode,
    recalculate,
    formatNumber,
  });
}