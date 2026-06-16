# 中转站倍率计算器

<p align="center">
  <strong>Relay Rate Calculator</strong><br />
  将 AI 中转站的「标价汇率 + 支付折扣」归一化到 <strong>¥1 : $1</strong> 基准，横向对比渠道、市场汇率与官方 API 参考成本。
</p>

<p align="center">
  <a href="https://zephyrdeng.github.io/relay-rate-calc/"><img src="https://img.shields.io/badge/demo-live-1f6b4f?style=flat-square" alt="Live Demo" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue?style=flat-square" alt="License: MIT" /></a>
  <img src="https://img.shields.io/badge/build-GitHub%20Actions-2088FF?style=flat-square" alt="GitHub Actions" />
  <img src="https://img.shields.io/badge/deps-zero-brightgreen?style=flat-square" alt="Zero Dependencies" />
  <img src="https://img.shields.io/badge/stack-HTML%20%2B%20CSS%20%2B%20JS-f7df1e?style=flat-square" alt="HTML + CSS + JS" />
</p>

<p align="center">
  <a href="https://zephyrdeng.github.io/relay-rate-calc/"><strong>在线体验</strong></a>
  ·
  <a href="#快速开始">快速开始</a>
  ·
  <a href="#计算模型">计算模型</a>
  ·
  <a href="#项目结构">项目结构</a>
</p>

---

## 背景

AI API 中转站常用「¥N : $1 标价 + X 折」的组合报价，不同渠道的标价和折扣口径并不一致，直接比较很容易失真。

本项目把所有报价统一换算到 **¥1 : $1** 基准下的**归一化倍率**，让你可以：

- 用同一套标尺比较多个中转渠道
- 对照实时 **USD/CNY** 市场汇率，判断相对市场的划算倍数
- 结合 **OpenAI / Anthropic** 官方 API 标价，估算典型场景的人民币实付成本

纯静态实现，无构建步骤、无 npm 依赖，适合 fork 后快速部署到自己的 Pages。

## 功能特性

| 能力 | 说明 |
|------|------|
| **归一化倍率计算** | 支持「折」与「倍率」两种输入方式，输出 ¥1:$1 下的实际支付倍率 |
| **市场汇率对比** | 自动拉取 Frankfurter / open.er-api.com 实时汇率，一键填入基准汇率 |
| **官方 API 参考成本** | 内置 Claude Sonnet/Opus、GPT-5.4/5.5 对话与 GPT Image 2 生图等参考场景 |
| **语义化成本对比** | 区分「官方等价（按市场汇率）」与「中转实付（按归一化倍率）」，避免 $ 与 ¥ 直接混比 |
| **快捷预设** | 内置常见渠道示例，便于快速试算 |
| **零依赖静态站** | 仅 `index.html` + `styles.css` + `app.js` + `pricing.js`，GitHub Actions 自动部署 |

## 在线体验

**[https://zephyrdeng.github.io/relay-rate-calc/](https://zephyrdeng.github.io/relay-rate-calc/)**

## 快速开始

### 本地预览

```bash
git clone https://github.com/ZephyrDeng/relay-rate-calc.git
cd relay-rate-calc
python3 -m http.server 8080
```

浏览器访问 [http://localhost:8080](http://localhost:8080)。

> 市场汇率功能依赖外部 API，本地预览需联网。

### Fork 并部署到自己的 GitHub Pages

1. Fork 本仓库
2. 在 **Settings → Pages** 中将 **Source** 设为 **GitHub Actions**
3. 推送至 `main` 分支，工作流 [`.github/workflows/deploy-pages.yml`](.github/workflows/deploy-pages.yml) 会自动发布

也可在 Actions 页手动触发 `workflow_dispatch`。

## 计算模型

```text
支付倍率 = 折扣倍率（N 折 = N ÷ 10）
归一化倍率 = 基准汇率（¥/美元）× 支付倍率
买 1 美元实付（元） = 归一化倍率
1 元人民币可换美元 = 1 ÷ 归一化倍率
```

**市场对比：**

```text
划算倍数 = 中转 1 元可换美元 ÷ 市场 1 元可换美元
```

**参考成本：**

```text
官方等价（元） = 官方 API 美元成本 × 市场汇率
中转实付（元） = 官方 API 美元成本 × 归一化倍率
```

### 示例

| 渠道 | 基准 | 折扣 | 归一化倍率 | 1 元 → 美元 |
|------|------|------|------------|-------------|
| 渠道一 | ¥1 : $1 | 5 折 | 0.5 | 2.00 |
| 渠道二 | ¥7 : $1 | 1.5 折 | 1.05 | 0.95 |

渠道一每花 1 元能换到 2 美元；渠道二虽然标价更高，但折扣更深，最终每元只能换约 0.95 美元。

## 参考成本场景

定价数据维护于 [`pricing.js`](pricing.js)，当前覆盖：

| 提供商 | 场景 |
|--------|------|
| Anthropic | Claude Sonnet 4.6 普通对话、Claude Opus 4.8 复杂 Agent |
| OpenAI | GPT-5.4 / GPT-5.5 对话、GPT Image 2 标准 / 高清生图 |

标价来源见 `pricing.js` 顶部注释；不含缓存折扣、Batch 定价、工具调用等附加费用。更新官方定价后，修改 `REFERENCE_SCENARIOS` 与 `PRICING_META.updatedAt` 即可。

## 技术说明

- **运行时**：浏览器原生 ES6+，无打包器、无框架
- **样式**：CSS 自定义属性，支持 light / dark 跟随系统偏好
- **汇率源**：Frankfurter（ECB）优先，失败时回退 open.er-api.com
- **Star 计数**：shields.io 端点 + `localStorage` 缓存，页面可见时定期刷新

## 项目结构

```text
relay-rate-calc/
├── index.html                      # 页面结构与语义化布局
├── styles.css                      # 主题、响应式与侧边栏布局
├── app.js                          # 倍率计算、市场汇率、Star 同步
├── pricing.js                      # 官方 API 定价与参考场景
├── .github/workflows/deploy-pages.yml
├── .nojekyll                       # 禁用 Jekyll，确保静态资源直出
├── README.md
└── LICENSE
```

## 参与贡献

欢迎通过 [Issue](https://github.com/ZephyrDeng/relay-rate-calc/issues) 反馈问题或提交 [Pull Request](https://github.com/ZephyrDeng/relay-rate-calc/pulls)：

- 补充或修正官方 API 定价场景
- 改进计算说明、文案与可访问性
- 优化移动端体验或视觉细节

提交前请保持零依赖原则，避免引入构建链。

## License

[MIT](LICENSE) © 2026 [relay-rate-calc contributors](https://github.com/ZephyrDeng/relay-rate-calc/graphs/contributors)