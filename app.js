const PRESETS = {
  channel1: { baseCnyPerUsd: 1, mode: "zhe", discountValue: 5 },
  channel2: { baseCnyPerUsd: 7, mode: "zhe", discountValue: 1.5 },
};

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
};

let currentMode = "zhe";

function zheToMultiplier(zhe) {
  return zhe / 10;
}

function calcRelayRate({ baseCnyPerUsd, paymentMultiplier }) {
  const normalizedMultiplier = baseCnyPerUsd * paymentMultiplier;
  const usdPerCny = 1 / normalizedMultiplier;
  const cnyPerUsd = normalizedMultiplier;
  return { normalizedMultiplier, usdPerCny, cnyPerUsd };
}

function formatNumber(value, maxDecimals = 4) {
  if (!Number.isFinite(value)) return "—";
  const fixed = value.toFixed(maxDecimals);
  return fixed.replace(/\.?0+$/, "");
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

function recalculate() {
  const baseCnyPerUsd = parsePositiveNumber(elements.baseRate.value);
  const paymentMultiplier = getPaymentMultiplier();

  if (baseCnyPerUsd === null) {
    showError("请输入大于 0 的基准汇率。");
    return;
  }

  if (paymentMultiplier === null) {
    showError(
      currentMode === "zhe"
        ? "请输入大于 0 的折扣（折）。"
        : "请输入大于 0 的支付倍率。"
    );
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
}

function applyPreset(presetKey) {
  const preset = PRESETS[presetKey];
  if (!preset) return;

  elements.baseRate.value = String(preset.baseCnyPerUsd);
  setMode(preset.mode);
  elements.discountValue.value = String(preset.discountValue);
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

setMode("zhe");
recalculate();