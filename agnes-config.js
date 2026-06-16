// Agnes AI 识图配置
// 文档：https://agnes-ai.com/doc/agnes-20-flash
// 免费额度（官方现价）：输入 $0/1M tokens，输出 $0.03/1M tokens
// 感谢 Agnes AI 免费开放 agnes-2.0-flash 多模态识图能力 🙏

const AGNES_CONFIG = {
  /** @type {"free"} 标注为 Agnes 免费 API Key */
  keyType: "free",
  apiKey: "sk-L7XNypbzEuFZlogabAT1m7a5GU54cdYELe38ncmu0SKlAjzh",
  apiBase: "https://apihub.agnes-ai.com/v1",
  model: "agnes-2.0-flash",
  docsUrl: "https://agnes-ai.com/doc/agnes-20-flash",
  pricingNote: "输入 $0/1M · 输出 $0.03/1M（见官方文档）",
};