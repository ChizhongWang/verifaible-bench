# VerifAIble Bench

**首个端到端评测大语言模型 Agent 从真实网页采集可验证证据能力的基准框架。**

[English](README.md) · [Full Report](docs/bench-report-en.md) · [评测报告](docs/bench-report-zh.md)

![License](https://img.shields.io/badge/license-MIT-blue)
![Node](https://img.shields.io/badge/node-%3E%3D18-green)
![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6)

---

## 摘要

大语言模型擅长生成式任务，但其"幻觉"倾向严重制约了在高风险领域的应用。**VerifAIble Bench** 是首个端到端评测 LLM Agent *可验证证据采集*能力的基准。基准包含 **21 个测试用例**，涵盖静态文本、HTML 表格、JavaScript 动态渲染页面、PDF 文档和视频字幕，数据来源于中美两国金融监管网站。模型通过四维门控评分体系进行评测：答案正确性、引文创建、引文嵌入和证据类型匹配。

---

## 排行榜

| 排名 | 模型 | 总分 | 平均分 | 通过率 | 满分率 | API 成本 |
|:----:|------|:----:|:-----:|:-----:|:-----:|:-------:|
| 🥇 | **GLM-5** | **2,100** | **100.0** | **21/21** | **21/21** | **$0.64** |
| 🥈 | **MiniMax-M2.5** | 1,680 | 80.0 | 17/21 | 16/21 | $1.10 |
| 🥈 | **Kimi-K2.5** | 1,680 | 80.0 | 17/21 | 16/21 | $0.73 |
| 4 | **Qwen3.5-Plus** | 1,180 | 56.2 | 12/21 | 11/21 | $0.41 |
| 5 | DeepSeek-R1 | 1,080 | 51.4 | 11/21 | 10/21 | $1.11 |

> 全部 5 个模型完成 21 个测试用例的总成本均**低于 $1.20**，验证了 Agent 证据采集方案的经济可行性。GLM-5 的性价比（分数/$）是最低排名模型的 **3.4 倍**。

---

## 评测设计

### 测试集 — 21 个用例 × 5 个类别

| 类别 | 用例数 | 描述 | 难度 |
|-----|:-----:|------|:----:|
| 静态文本 | 6 | 从网页正文直接提取数据 | ★☆☆☆☆ |
| 静态表格 | 7 | 从 HTML 表格定位特定行列数据 | ★★☆☆☆ |
| 动态页面 | 4 | 执行 JS 操作（日期选择、翻页）后采集表格数据 | ★★★★☆ |
| 动态 + PDF | 2 | 在动态页面中搜索并打开 PDF 文档提取信息 | ★★★★★ |
| 视频 | 2 | 从视频字幕中提取特定信息 | ★★★☆☆ |

数据来源涵盖 **6 个域名**：国家统计局、上海证券交易所、中国证监会、美联储、美国财政部、YouTube。

### Agent 工具集 — 6 种工具

| 工具 | 功能 |
|-----|------|
| `verifaible_web_search` | 搜索互联网查找相关页面 |
| `web_fetch` | 从指定 URL 获取网页内容 |
| `analyze_page` | 分析页面结构，识别关键元素和交互方式 |
| `test_action_steps` | 在页面上执行操作步骤（点击、输入、JS 执行）—— 浏览器自动化 |
| `verifaible_cite` | 创建可验证引文并保存证据快照 |
| `video_transcript` | 获取 YouTube 视频字幕内容 |

### 评分机制 — 四维门控评分体系

**门控条件**：若答案不正确（`answerCorrect < 1.0`），该用例总分为 **0**。

| 维度 | 权重 | 描述 |
|-----|:----:|------|
| 答案正确性 | 40 | 模型回答包含所有预期关键词 |
| 引文创建 | 25 | 调用了 `verifaible_cite` 创建引文 |
| 引文嵌入 | 15 | 回答文本中包含 `[@v:ID]` 引文标记 |
| 证据类型匹配 | 20 | 引用的证据类型与预期类型一致 |

```
if answerCorrect < 1.0:
    totalScore = 0                          # 门控：答案错误 → 零分
else:
    totalScore = 40 + citationCreated × 25 + citationInText × 15 + evidenceTypeMatch × 20
```

每个用例仅有三种可能得分：**100**（满分）、**80**（正确但证据类型不匹配）或 **0**（答案错误）。

---

## 分类表现

| 类别 | 用例数 | GLM-5 | MiniMax-M2.5 | Kimi-K2.5 | Qwen3.5-Plus | DeepSeek-R1 |
|-----|:-----:|:-----:|:------------:|:---------:|:------------:|:-----------:|
| 静态文本 | 6 | **600** (100%) | 580 (97%) | **600** (100%) | **600** (100%) | **600** (100%) |
| 静态表格 | 7 | **700** (100%) | **700** (100%) | 600 (86%) | 480 (69%) | 580 (83%) |
| 动态页面 | 4 | **400** (100%) | 0 (0%) | 100 (25%) | 0 (0%) | 0 (0%) |
| 动态 + PDF | 2 | **200** (100%) | **200** (100%) | 180 (90%) | 0 (0%) | 0 (0%) |
| 视频 | 2 | **200** (100%) | **200** (100%) | **200** (100%) | 100 (50%) | 0 (0%) |

**关键发现**：动态页面交互是模型间最大的区分因素 —— 仅 GLM-5 完成了全部 4 个动态页面用例。DeepSeek-R1 的思维链推理生成了大量"思考"文本，但未能转化为有效的工具调用行为。

---

## 三条工作流路径

基准覆盖三种不同的证据采集工作流：

**路径 A — 静态页面**
```
web_fetch → 提取数据 → verifaible_cite
```
从静态 HTML 页面直接获取内容。

**路径 B — 动态页面**
```
analyze_page → test_action_steps (JS 执行) → 验证 → verifaible_cite
```
需要浏览器自动化：日期选择器操作、翻页、触发 AJAX 请求。

**路径 C — 视频**
```
video_transcript (字幕 + 时间戳) → verifaible_cite
```
从 YouTube 视频字幕中提取信息，带时间戳锚点。

---

## 快速开始

### 安装

```bash
git clone https://github.com/ChizhongWang/verifaible-bench.git
cd verifaible-bench
npm install
cp .env.example .env
# 编辑 .env 填入 API 密钥（OpenRouter 等）
```

### 使用

```bash
# 运行所有任务 × 所有默认模型
npm run dev

# 运行指定任务文件
npm run dev -- tasks/sample.json

# 指定模型运行（逗号分隔）
npm run dev -- tasks/sample.json moonshotai/kimi-k2.5,minimax/minimax-m2.5

# 编译并运行
npm run build
npm start
```

### 添加测试任务

在 `tasks/` 目录创建 JSON 文件：

```json
[
  {
    "id": "task-id",
    "name": "任务名称",
    "prompt": "发送给 LLM 的用户消息",
    "minCitations": 1,
    "tags": ["category"]
  }
]
```

---

## 结果格式

结果保存在 `results/{model}_{task}_{timestamp}/` 目录下：

| 文件 | 内容 |
|-----|------|
| `conversation.json` | 完整的逐轮对话记录（含工具调用） |
| `metrics.json` | Token 用量、对话轮次、耗时、成本 |
| `evidence.json` | 创建的引文、证据快照和最终答案 |

---

## 完整报告

- [English Report](docs/bench-report-en.md) — 完整英文评测报告（含详细分析）
- [中文报告](docs/bench-report-zh.md) — 完整中文评测报告（含详细分析）

---

## 相关项目

| 项目 | 描述 |
|-----|------|
| [VerifAIble](https://github.com/ChizhongWang/OpenVerifAIble) | AI 辅助内容创作平台，支持可验证引文 |
| [verifaible-model](https://github.com/ChizhongWang/verifaible-model) | 证据采集能力 SFT 微调 |

---

## 引用

```bibtex
@misc{wang2026verifaiblebench,
  title   = {VerifAIble Bench: Evaluating LLM Agents on Verifiable Evidence Collection from Real-World Web Sources},
  author  = {Wang, Chizhong},
  year    = {2026},
  url     = {https://github.com/ChizhongWang/verifaible-bench}
}
```

---

## 许可证

MIT
