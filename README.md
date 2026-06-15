# 中转站倍率计算器

轻量静态页面，用于计算 AI 中转站的实际换汇倍率。

统一按 **¥1 : $1** 基准，将任意「标价汇率 + 支付折扣」归一化，方便横向比较不同渠道谁更划算。

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

## GitHub Pages 部署

1. 将本仓库推送到 GitHub 公开仓库（例如 `relay-rate-calc`）
2. 进入仓库 **Settings → Pages**
3. **Source** 选择 **Deploy from a branch**
4. **Branch** 选 `main`，目录选 `/ (root)`
5. 保存后等待部署，访问 `https://<username>.github.io/relay-rate-calc/`

仓库已包含 `.nojekyll`，避免 Jekyll 处理静态文件。

## 文件结构

```text
relay-rate-calc/
├── index.html    # 页面
├── styles.css    # 样式
├── app.js        # 计算逻辑
├── README.md
├── LICENSE
└── .nojekyll
```

## License

MIT