# VerifAIble Bench

**The first end-to-end benchmark for evaluating LLM Agents on verifiable evidence collection from real-world web sources.**

[中文版](README_zh.md) · [Full Report](docs/bench-report-en.md) · [评测报告](docs/bench-report-zh.md)

![License](https://img.shields.io/badge/license-MIT-blue)
![Node](https://img.shields.io/badge/node-%3E%3D18-green)
![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6)

---

## Abstract

LLMs excel at generative tasks, yet their tendency to "hallucinate" limits adoption in high-stakes domains. **VerifAIble Bench** is the first end-to-end benchmark for evaluating LLM Agents on *verifiable evidence collection*. It comprises **21 test cases** spanning static text, HTML tables, JavaScript-rendered dynamic pages, PDF documents, and video transcripts, drawn from financial regulatory portals in China and the United States. Models are evaluated using an all-or-nothing gated scoring system across four dimensions: answer correctness, citation creation, citation embedding, and evidence type matching.

---

## Leaderboard

| Rank | Model | Total Score | Average | Pass Rate | Full Score Rate | API Cost |
|:----:|-------|:-----------:|:-------:|:---------:|:---------------:|:--------:|
| 🥇 | **GLM-5** | **2,100** | **100.0** | **21/21** | **21/21** | **$0.64** |
| 🥈 | **MiniMax-M2.5** | 1,680 | 80.0 | 17/21 | 16/21 | $1.10 |
| 🥈 | **Kimi-K2.5** | 1,680 | 80.0 | 17/21 | 16/21 | $0.73 |
| 4 | **Qwen3.5-Plus** | 1,180 | 56.2 | 12/21 | 11/21 | $0.41 |
| 5 | DeepSeek-R1 | 1,080 | 51.4 | 11/21 | 10/21 | $1.11 |

> All 5 models complete the full 21-case benchmark for **under $1.20**, validating the economic feasibility of agent-based evidence collection. GLM-5 achieves a cost-efficiency (score/$) **3.4× higher** than the lowest-ranked model.

---

## Benchmark Design

### Test Set — 21 Cases × 5 Categories

| Category | Cases | Description | Difficulty |
|----------|:-----:|-------------|:----------:|
| Static Text | 6 | Extract data directly from web page body text | ★☆☆☆☆ |
| Static Table | 7 | Locate specific row-column data from HTML tables | ★★☆☆☆ |
| Dynamic Page | 4 | Execute JS operations (date selection, pagination) before collecting table data | ★★★★☆ |
| Dynamic + PDF | 2 | Search and open PDF documents within dynamic pages to extract information | ★★★★★ |
| Video | 2 | Extract specific information from video transcripts | ★★★☆☆ |

Data sources span **6 domains**: National Bureau of Statistics (China), Shanghai Stock Exchange, CSRC, Federal Reserve, U.S. Treasury, and YouTube.

### Agent Tools — 6 Tools

| Tool | Function |
|------|----------|
| `verifaible_web_search` | Search the internet for relevant pages |
| `web_fetch` | Retrieve web page content from a specified URL |
| `analyze_page` | Analyze page structure, identify key elements and interaction methods |
| `test_action_steps` | Execute action steps on pages (click, input, JS execution) — browser automation |
| `verifaible_cite` | Create verifiable citations and save evidence snapshots |
| `video_transcript` | Retrieve YouTube video transcript content |

### Scoring — Four-Dimensional Gated System

**Gate Condition:** If the answer is incorrect (`answerCorrect < 1.0`), the total score is **0**.

| Dimension | Weight | Description |
|-----------|:------:|-------------|
| Answer Correctness | 40 | Model answer contains all expected keywords |
| Citation Created | 25 | `verifaible_cite` was called to create a citation |
| Citation In Text | 15 | Answer text contains `[@v:ID]` citation markers |
| Evidence Type Match | 20 | Cited evidence type matches the expected type |

```
if answerCorrect < 1.0:
    totalScore = 0                          # Gate: wrong answer → zero
else:
    totalScore = 40 + citationCreated × 25 + citationInText × 15 + evidenceTypeMatch × 20
```

This yields only three possible scores per case: **100** (perfect), **80** (correct but evidence type mismatch), or **0** (incorrect answer).

---

## Category Results

| Category | Cases | GLM-5 | MiniMax-M2.5 | Kimi-K2.5 | Qwen3.5-Plus | DeepSeek-R1 |
|----------|:-----:|:-----:|:------------:|:---------:|:------------:|:-----------:|
| Static Text | 6 | **600** (100%) | 580 (97%) | **600** (100%) | **600** (100%) | **600** (100%) |
| Static Table | 7 | **700** (100%) | **700** (100%) | 600 (86%) | 480 (69%) | 580 (83%) |
| Dynamic Page | 4 | **400** (100%) | 0 (0%) | 100 (25%) | 0 (0%) | 0 (0%) |
| Dynamic + PDF | 2 | **200** (100%) | **200** (100%) | 180 (90%) | 0 (0%) | 0 (0%) |
| Video | 2 | **200** (100%) | **200** (100%) | **200** (100%) | 100 (50%) | 0 (0%) |

**Key findings:** Dynamic page interaction is the dominant differentiator — only GLM-5 completed all 4 dynamic cases. DeepSeek-R1's Chain-of-Thought reasoning generates extensive "thinking" text but fails to translate into effective tool-use behavior.

---

## Three Workflow Paths

The benchmark covers three distinct evidence collection workflows:

**Path A — Static Pages**
```
web_fetch → extract data → verifaible_cite
```
Direct content retrieval from static HTML pages.

**Path B — Dynamic Pages**
```
analyze_page → test_action_steps (JS execution) → verify → verifaible_cite
```
Requires browser automation: date picker manipulation, pagination, AJAX triggering.

**Path C — Video**
```
video_transcript (subtitles + timestamps) → verifaible_cite
```
Extract information from YouTube video transcripts with timestamp anchoring.

---

## Quick Start

### Setup

```bash
git clone https://github.com/ChizhongWang/verifaible-bench.git
cd verifaible-bench
npm install
cp .env.example .env
# Edit .env with your API keys (OpenRouter, etc.)
```

### Usage

```bash
# Run all tasks × all default models
npm run dev

# Run specific task file
npm run dev -- tasks/sample.json

# Run with specific models (comma-separated)
npm run dev -- tasks/sample.json moonshotai/kimi-k2.5,minimax/minimax-m2.5

# Build & run compiled
npm run build
npm start
```

### Adding Tasks

Create a JSON file in `tasks/`:

```json
[
  {
    "id": "task-id",
    "name": "Task display name",
    "prompt": "The user message sent to the LLM",
    "minCitations": 1,
    "tags": ["category"]
  }
]
```

---

## Results Format

Results are saved to `results/{model}_{task}_{timestamp}/`:

| File | Content |
|------|---------|
| `conversation.json` | Full turn-by-turn dialogue with tool calls |
| `metrics.json` | Token usage, round-trips, duration, costs |
| `evidence.json` | Created citations, evidence snapshots, and final answer |

---

## Full Report

- [English Report](docs/bench-report-en.md) — Complete evaluation report with detailed analysis
- [中文报告](docs/bench-report-zh.md) — 完整评测报告（含详细分析）

---

## Related Projects

| Project | Description |
|---------|-------------|
| [VerifAIble](https://github.com/ChizhongWang/OpenVerifAIble) | AI-powered content creation platform with verifiable citations |
| [verifaible-model](https://github.com/ChizhongWang/verifaible-model) | SFT fine-tuning for evidence collection capabilities |

---

## Citation

```bibtex
@misc{wang2026verifaiblebench,
  title   = {VerifAIble Bench: Evaluating LLM Agents on Verifiable Evidence Collection from Real-World Web Sources},
  author  = {Wang, Chizhong},
  year    = {2026},
  url     = {https://github.com/ChizhongWang/verifaible-bench}
}
```

---

## License

MIT
