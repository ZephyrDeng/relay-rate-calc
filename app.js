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
  discountHint: document.getElementById("discount-hint"),
  multiplierPreview: document.getElementById("multiplier-preview"),
  modeButtons: document.querySelectorAll(".mode-btn"),
  presetButtons: document.querySelectorAll(".preset-btn"),
  errorMessage: document.getElementById("error-message"),
  results: document.getElementById("results"),
  normalizedMultiplier: document.getElementById("normalized-multiplier"),
  equivalentDesc: document.getElementById("equivalent-desc"),
  cnyPerUsd: document.getElementById("cny-per-usd"),
  usdPerCny: document.getElementById("usd-per-cny"),
  marketRateValue: document.getElementById("market-rate-value"),
  marketRateMeta: document.getElementById("market-rate-meta"),
  refreshMarketRate: document.getElementById("refresh-market-rate"),
  applyMarketRate: document.getElementById("apply-market-rate"),
  marketCompare: document.getElementById("market-compare"),
  marketAdvantage: document.getElementById("market-advantage"),
  marketCompareDesc: document.getElementById("market-compare-desc"),
  pricingMeta: document.getElementById("pricing-meta"),
  costScenarios: document.getElementById("cost-scenarios"),
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
    return { text: "与官方等价（仅汇率换算）", tone: "neutral" };
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
  if (advantageMultiplier >= 1) {
    return `比市场汇率（¥${formatNumber(marketCnyPerUsd, 2)}:$1）多换 ${formatNumber(advantageMultiplier, 2)} 倍美元`;
  }
  return `比市场汇率（¥${formatNumber(marketCnyPerUsd, 2)}:$1）少换 ${formatNumber(1 / advantageMultiplier, 2)} 倍美元`;
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
  elements.discountHint.textContent = isZhe
    ? "5 折 = 支付原价的 50%"
    : "直接输入实际支付倍率，如 0.5、0.15";
  elements.multiplierPreview.classList.toggle("hidden", !isZhe);
}

function updateMultiplierPreview(paymentMultiplier) {
  if (currentMode !== "zhe") return;
  elements.multiplierPreview.textContent = `支付倍率：×${formatNumber(paymentMultiplier)}`;
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

function setMarketRateLoading(isLoading) {
  marketRateLoading = isLoading;
  elements.refreshMarketRate.disabled = isLoading;
  elements.applyMarketRate.disabled = isLoading || !marketRate;
  if (isLoading) {
    elements.marketRateMeta.textContent = "正在获取实时汇率…";
  }
}

function renderMarketRate() {
  if (!marketRate) return;

  elements.marketRateValue.textContent = formatNumber(marketRate.cnyPerUsd, 4);
  elements.marketRateMeta.textContent = `来源：${marketRate.source} · 更新：${marketRate.date}`;
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
            <p class="cost-title">${scenario.label}</p>
            <p class="cost-desc">${scenario.description}</p>
          </div>
        </div>
        <div class="cost-metrics">
          <div class="cost-metric">
            <p class="cost-metric-label">官方 API（美元）</p>
            <p class="cost-metric-value">${formatUsd(usdCost)}</p>
          </div>
          <div class="cost-metric">
            <p class="cost-metric-label">官方等价（人民币）</p>
            <p class="cost-metric-value">${
              officialCnyEquivalent === null ? "—" : formatCny(officialCnyEquivalent)
            }</p>
            <p class="cost-metric-note">按市场汇率换算</p>
          </div>
          <div class="cost-metric">
            <p class="cost-metric-label">中转实付（人民币）</p>
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
  elements.marketCompareDesc.textContent = describeMarketComparison(
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
  elements.marketRateMeta.textContent = "获取市场汇率失败，请稍后重试。";
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
  elements.equivalentDesc.textContent = describeEquivalent(
    result.normalizedMultiplier
  );
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

elements.pricingMeta.textContent = `${PRICING_META.note} 更新：${PRICING_META.updatedAt}`;

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

function parseShieldsStarCount(data) {
  const count = data?.message ?? data?.value;
  return typeof count === "string" && count.trim() ? count.trim() : null;
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
    const response = await fetch(getGithubStarShieldsUrl());
    if (!response.ok) throw new Error("shields.io request failed");

    const data = await response.json();
    const count = parseShieldsStarCount(data);
    if (!count) throw new Error("shields.io returned invalid star count");

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

setMode("zhe");
fetchMarketRate();
startGithubStarSync();
recalculate();