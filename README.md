# 中转站倍率计算器

轻量静态页面，用于计算 AI 中转站的实际换汇倍率。

统一按 **¥1 : $1** 基准，将任意「标价汇率 + 支付折扣」归一化，方便横向比较不同渠道谁更划算。

支持自动获取 **USD/CNY 市场汇率**（Frankfurter / open.er-api.com），可一键填入基准汇率，并显示相对市场的划算倍数。

内置 **OpenAI / Claude 官方 API 参考成本**（对话一轮、GPT Image 2 生图等），按当前中转倍率换算成人民币实付。

## 公式

```text
支付倍率 = 折扣倍率（N 折 = N ÷ 10）
归一化倍率 = 基准汇率（¥/美元）× 支付倍率
买 1 美元实付 = 归一化倍率（元）
1 元人民币可换美元 = 1 ÷ 归一化倍率
```

## 示例

| 渠道 | 基准 | 折扣 | 归一化倍率 | 1 元 → 美元 |
|------|------|------|------------|-------------|
| 渠道一 | ¥1:$1 | 5折 | 0.5 | 2.00 |
| 渠道二 | ¥7:$1 | 1.5折 | 1.05 | 0.95 |

## 本地预览

```bash
cd relay-rate-calc
python3 -m http.server 8080
```

浏览器打开 <http://localhost:8080>。

## 在线访问

https://zephyrdeng.github.io/relay-rate-calc/

## GitHub Pages 部署

仓库使用 GitHub Actions 自动部署（见 [`.github/workflows/deploy-pages.yml`](.github/workflows/deploy-pages.yml)）。

1. 推送代码到 `main` 分支
2. Actions 工作流 `Deploy to GitHub Pages` 会自动运行
3. 也可在 Actions 页手动触发 `workflow_dispatch`

首次启用时，在仓库 **Settings → Pages** 中将 **Source** 设为 **GitHub Actions**。

## 文件结构

```text
relay-rate-calc/
├── index.html                      # 页面
├── styles.css                      # 样式
├── app.js                          # 计算逻辑
├── pricing.js                      # 官方定价与参考场景
├── .github/workflows/deploy-pages.yml
├── README.md
├── LICENSE
└── .nojekyll
```

## License

MIT