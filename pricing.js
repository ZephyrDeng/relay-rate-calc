// Official API pricing references (USD). Update when providers change rates.
// Sources:
// - https://platform.claude.com/docs/en/about-claude/pricing
// - https://developers.openai.com/api/docs/pricing
// - https://costgoat.com/pricing/openai-images (gpt-image-2 per-image tiers)

const PRICING_META = {
  updatedAt: "2026-06-15",
  note: "按官方 API 标价估算，不含缓存折扣、Batch、工具调用等附加费用。",
};

const REFERENCE_SCENARIOS = [
  {
    id: "claude-sonnet-chat",
    provider: "Anthropic",
    label: "Claude Sonnet 4.6 · 普通对话",
    description: "约 3,000 输入 + 800 输出 tokens",
    type: "token",
    inputTokens: 3000,
    outputTokens: 800,
    inputPerM: 3,
    outputPerM: 15,
  },
  {
    id: "claude-opus-chat",
    provider: "Anthropic",
    label: "Claude Opus 4.8 · 复杂 Agent",
    description: "约 8,000 输入 + 2,000 输出 tokens",
    type: "token",
    inputTokens: 8000,
    outputTokens: 2000,
    inputPerM: 5,
    outputPerM: 25,
  },
  {
    id: "gpt-5-4-chat",
    provider: "OpenAI",
    label: "GPT-5.4 · 普通对话",
    description: "约 3,000 输入 + 800 输出 tokens（<272K 上下文）",
    type: "token",
    inputTokens: 3000,
    outputTokens: 800,
    inputPerM: 2.5,
    outputPerM: 15,
  },
  {
    id: "gpt-5-5-chat",
    provider: "OpenAI",
    label: "GPT-5.5 · 高质量对话",
    description: "约 3,000 输入 + 800 输出 tokens（<272K 上下文）",
    type: "token",
    inputTokens: 3000,
    outputTokens: 800,
    inputPerM: 5,
    outputPerM: 30,
  },
  {
    id: "gpt-image-2-medium",
    provider: "OpenAI",
    label: "GPT Image 2 · 生图 1 张",
    description: "1024×1024 · Medium 质量",
    type: "fixed",
    usd: 0.053,
  },
  {
    id: "gpt-image-2-high",
    provider: "OpenAI",
    label: "GPT Image 2 · 高清生图 1 张",
    description: "1024×1024 · High 质量",
    type: "fixed",
    usd: 0.211,
  },
];

function calcScenarioUsdCost(scenario) {
  if (scenario.type === "fixed") {
    return scenario.usd;
  }

  const inputCost = (scenario.inputTokens * scenario.inputPerM) / 1_000_000;
  const outputCost = (scenario.outputTokens * scenario.outputPerM) / 1_000_000;
  return inputCost + outputCost;
}

function calcRelayCnyCost({ usdCost, normalizedMultiplier }) {
  return usdCost * normalizedMultiplier;
}

function calcMarketCnyCost({ usdCost, marketCnyPerUsd }) {
  return usdCost * marketCnyPerUsd;
}