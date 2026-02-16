# VerifAIble Bench: Evaluating LLM Agents on Verifiable Evidence Collection from Real-World Web Sources

> **VerifAIble Bench Evaluation Report**
>
> Published: February 2026

---

## Abstract

Large Language Models (LLMs) excel at generative tasks, yet their tendency to "hallucinate" severely limits adoption in high-stakes domains. We introduce **VerifAIble Bench**—the first end-to-end benchmark for evaluating LLM Agents on *verifiable evidence collection*. The benchmark comprises **21 test cases** spanning static text, HTML tables, JavaScript-rendered dynamic pages, PDF documents, and video transcripts, drawn from financial regulatory portals in China and the United States. We evaluate 4 models (GLM-5, Kimi-K2.5, MiniMax-M2.5, DeepSeek-R1) using an all-or-nothing gated scoring system across four dimensions: answer correctness, citation creation, citation embedding, and evidence type matching. Results show that **GLM-5 achieves a perfect score of 2,100**, Kimi-K2.5 and MiniMax-M2.5 tie at 1,680 (average 80.0), and DeepSeek-R1 trails at 1,080 (average 51.4). Dynamic page interaction emerges as the dominant differentiator across models.

---

## 1. Introduction

### 1.1 LLM Hallucination and the Need for Grounding

Large Language Models have achieved remarkable progress in open-domain question answering and content generation, but their inherent "hallucination" problem—generating plausible yet factually incorrect content—severely constrains their use in finance, law, journalism, and other domains requiring high verifiability. To address this, the industry has widely adopted Grounding strategies, requiring model outputs to be traceable to verifiable original sources.

### 1.2 Limitations of Existing Benchmarks

Existing RAG (Retrieval-Augmented Generation) benchmarks primarily evaluate retrieval quality and answer generation quality, but have significant blind spots:

1. **No evidence verifiability dimension**: They only assess whether answers are correct, not whether answers can be independently verified by third parties
2. **Ignore real-world web interaction**: Most benchmarks use pre-processed static corpora without addressing JavaScript dynamic rendering, date filtering, pagination, and other real-world web operations
3. **No end-to-end evidence pipeline evaluation**: The complete pipeline from search → navigation → interaction → collection → citation lacks systematic assessment

### 1.3 VerifAIble Platform and VerifAIble Bench

**VerifAIble** is a verifiable evidence management platform that supports highlight annotation and playback verification of web evidence. Building on this platform, we designed **VerifAIble Bench** to evaluate the ability of LLM Agents to complete the full pipeline of "search → page interaction → data collection → citation creation."

Unlike traditional RAG benchmarks, VerifAIble Bench requires models not only to answer correctly, but also to:
- Create verifiable citations pointing to original web sources
- Embed citation markers within the answer text
- Collect the correct type of evidence (text/table/PDF/video)

---

## 2. Benchmark Design

### 2.1 Test Set Composition

VerifAIble Bench contains **21 test cases** distributed across five categories:

| Category | Cases | Description | Difficulty |
|----------|-------|-------------|------------|
| Static Text | 6 | Extract data directly from web page body text | ★☆☆☆☆ |
| Static Table | 7 | Locate specific row-column data from HTML tables | ★★☆☆☆ |
| Dynamic Page | 4 | Execute JS operations (date selection, pagination) before collecting table data | ★★★★☆ |
| Dynamic+PDF | 2 | Search and open PDF documents within dynamic pages to extract information | ★★★★★ |
| Video | 2 | Extract specific information from video transcripts | ★★★☆☆ |

**Data Source Distribution:**

| Source | Cases | Domain |
|--------|-------|--------|
| National Bureau of Statistics (China) | 8 | stats.gov.cn |
| Shanghai Stock Exchange | 6 | sse.com.cn |
| China Securities Regulatory Commission | 1 | csrc.gov.cn |
| Federal Reserve | 3 | federalreserve.gov |
| U.S. Treasury | 1 | treasury.gov |
| YouTube | 2 | youtube.com |

### 2.2 Agent Tool Set

The LLM Agent is equipped with **6 tools** during evaluation:

| Tool | Function |
|------|----------|
| `verifaible_web_search` | Search the internet for relevant pages |
| `web_fetch` | Retrieve web page content from a specified URL |
| `analyze_page` | Analyze page structure, identify key elements and interaction methods |
| `test_action_steps` | Execute action steps on pages (click, input, JS execution), equivalent to browser automation |
| `verifaible_cite` | Create verifiable citations and save evidence snapshots |
| `video_transcript` | Retrieve YouTube video transcript content |

The `test_action_steps` tool supports `exec_js` capabilities, enabling execution of arbitrary JavaScript code (e.g., setting date pickers, triggering AJAX requests, manipulating DOM elements)—a critical tool for completing dynamic page tasks.

### 2.3 Scoring Criteria

VerifAIble Bench employs an **All-or-Nothing Gated Scoring System**:

**Gate Condition:** If the answer is not completely correct (answerCorrect ≠ 1.0), the total score for that case is **0**.

**Four-Dimensional Scoring (Maximum 100 points):**

| Dimension | Weight | Description |
|-----------|--------|-------------|
| Answer Correctness (answerCorrect) | 40 | Whether the model answer contains all expected keywords |
| Citation Created (citationCreated) | 25 | Whether `verifaible_cite` was called to create a citation |
| Citation In Text (citationInText) | 15 | Whether the answer text contains `[@v:ID]` citation markers |
| Evidence Type Match (evidenceTypeMatch) | 20 | Whether the cited evidence type matches the expected type |

**Scoring Formula:**

```
if answerCorrect < 1.0:
    totalScore = 0                          # Gate: wrong answer → zero
else:
    totalScore = 40
              + citationCreated × 25
              + citationInText  × 15
              + evidenceTypeMatch × 20
```

This results in only three possible scores per case: **100** (perfect), **80** (correct answer but evidence type mismatch), or **0** (incorrect answer).

### 2.4 Experimental Configuration

| Setting | Value |
|---------|-------|
| API | OpenRouter Responses API |
| Temperature | 0.3 |
| Max Round Trips | 30 |
| Session Isolation | Independent session per case, no shared state |

---

## 3. Evaluated Models

Four LLMs accessible via OpenRouter were selected for this evaluation:

| Model | Provider | Characteristics |
|-------|----------|----------------|
| **GLM-5** | Zhipu AI (Z-AI) | Next-generation general-purpose model with strong tool-calling capabilities |
| **Kimi-K2.5** | Moonshot AI | Excels at long-context understanding with multimodal support |
| **MiniMax-M2.5** | MiniMax | Cost-effective model with large context window |
| **DeepSeek-R1** | DeepSeek | Reasoning-specialized model with deep Chain-of-Thought inference |

---

## 4. Results

### 4.1 Overall Rankings

| Rank | Model | Total | Avg | Pass | Full | Avg Rounds | Avg Tool Calls | Total Time |
|------|-------|-------|-----|------|------|-----------|---------------|------------|
| 🥇 | **GLM-5** | **2,100** | **100.0** | **21/21** | **21/21** | 7.7 | 6.7 | 55.7 min |
| 🥈 | **MiniMax-M2.5** | 1,680 | 80.0 | 17/21 | 16/21 | 10.6 | 9.7 | 71.3 min |
| 🥈 | **Kimi-K2.5** | 1,680 | 80.0 | 17/21 | 16/21 | 8.0 | 7.0 | 60.6 min |
| 4 | DeepSeek-R1 | 1,080 | 51.4 | 11/21 | 10/21 | 5.0 | 4.0 | 115.0 min |

> **Note:** Pass = cases with score > 0; Full = cases with score = 100.

### 4.2 Category Analysis

| Category | Cases | GLM-5 | MiniMax-M2.5 | Kimi-K2.5 | DeepSeek-R1 |
|----------|-------|-------|-------------|-----------|-------------|
| Static Text | 6 | **600** (100%) | 580 (96.7%) | **600** (100%) | **600** (100%) |
| Static Table | 7 | **700** (100%) | **700** (100%) | 600 (85.7%) | 580 (82.9%) |
| Dynamic Page | 4 | **400** (100%) | 0 (0%) | 100 (25%) | 0 (0%) |
| Dynamic+PDF | 2 | **200** (100%) | **200** (100%) | 180 (90%) | 0 (0%) |
| Video | 2 | **200** (100%) | **200** (100%) | **200** (100%) | 0 (0%) |

**Key Findings:**

- **Static content (Text + Table)**: All four models perform similarly well
- **Dynamic pages are the dominant differentiator**: Only GLM-5 completed all 4 dynamic cases; other models scored 0%–25%
- **Video comprehension**: All models except DeepSeek-R1 successfully utilized the `video_transcript` tool
- **DeepSeek-R1 fails across all non-static categories**: Zero scores on all 8 dynamic, PDF, and video cases

### 4.3 Token Usage and Efficiency Analysis

| Model | Input Tokens | Output Tokens | Total Tokens | Output/Input Ratio |
|-------|-------------|---------------|-------------|-------------------|
| GLM-5 | 1.87M | 31.5K | 1.90M | 1.7% |
| MiniMax-M2.5 | 3.45M | 54.4K | 3.51M | 1.6% |
| Kimi-K2.5 | 2.65M | 39.8K | 2.70M | 1.5% |
| DeepSeek-R1 | 1.02M | 160.2K | 1.18M | 15.7% |

**Efficiency Metrics:**

| Model | Score | Total Tokens | Total Time | Score/10K Tokens | Score/min |
|-------|-------|-------------|------------|-----------------|----------|
| **GLM-5** | 2,100 | 1.90M | 55.7 min | **11.1** | **37.7** |
| MiniMax-M2.5 | 1,680 | 3.51M | 71.3 min | 4.8 | 23.6 |
| Kimi-K2.5 | 1,680 | 2.70M | 60.6 min | 6.2 | 27.7 |
| DeepSeek-R1 | 1,080 | 1.18M | 115.0 min | 9.2 | 9.4 |

> GLM-5 leads significantly in both score-per-token and score-per-minute efficiency.

### 4.4 Conversational Behavior Analysis

| Model | Avg Rounds | Avg Tool Calls | Avg Input Tokens | Avg Output Tokens | Avg Duration |
|-------|-----------|---------------|-----------------|------------------|-------------|
| GLM-5 | 7.7 | 6.7 | 88.9K | 1.5K | 2m39s |
| MiniMax-M2.5 | 10.6 | 9.7 | 164.4K | 2.6K | 3m24s |
| Kimi-K2.5 | 8.0 | 7.0 | 126.4K | 1.9K | 2m53s |
| DeepSeek-R1 | 5.0 | 4.0 | 48.4K | 7.6K | 5m29s |

**The DeepSeek-R1 CoT Paradox:**
- Fewest round trips (5.0) and tool calls (4.0) among all models
- Yet **3–5× more output tokens** per case (7.6K vs 1.5–2.6K)
- Longest duration (5m29s/case) and lowest score (51.4)

This demonstrates that R1's Chain-of-Thought reasoning generates extensive "thinking" text that fails to translate into better tool-use strategies. Its fewer tool calls mean it cannot complete tasks requiring multi-step interaction.

---

## 5. In-Depth Analysis

### 5.1 Why Did GLM-5 Achieve a Perfect Score?

GLM-5 scored 100 on all 21 test cases. Key success factors include:

1. **Efficient dynamic page interaction strategy**: When facing SSE's date pickers, GLM-5 accurately identified DOM structures and correctly set dates via `exec_js`, typically completing the most complex dynamic tasks within 10–28 rounds
2. **Precise tool-call decisions**: An average of only 6.7 tool calls per case—the "just right" amount
3. **Consistent citation creation**: 100% citation creation rate, correctly calling `verifaible_cite` and embedding citation markers every time

### 5.2 Dynamic Pages as the Primary Discriminator

The 4 dynamic page cases from the Shanghai Stock Exchange (sse.com.cn) proved to be the most discriminating tests in the entire benchmark:

| Case | Task | GLM-5 | MiniMax | Kimi | R1 |
|------|------|-------|---------|------|-----|
| cn_dynamic_001 | Bond transaction count (date filter) | ✅ 100 | ❌ 0 | ✅ 100 | ❌ 0 |
| cn_dynamic_002 | Top market cap stock ratio (date filter) | ✅ 100 | ❌ 0 | ❌ 0 | ❌ 0 |
| cn_dynamic_003 | Fund trading volume (date filter) | ✅ 100 | ❌ 0 | ❌ 0 | ❌ 0 |
| cn_dynamic_004 | Securities lending balance (date filter) | ✅ 100 | ❌ 0 | ❌ 0 | ❌ 0 |

**Failure Analysis:**
- **Date setting failure**: MiniMax and Kimi retrieved data for the wrong date in cn_dynamic_002–004 (e.g., confusing 2025-02-10 with 2026-02-10), indicating they failed to correctly operate the page's date filter components
- **Round trip exhaustion**: MiniMax exhausted the 30-round limit in cn_dynamic_001 and cn_dynamic_003 without completing the task
- **Premature termination**: DeepSeek-R1 typically stopped tool calls after 5–10 rounds, even without obtaining the correct answer

### 5.3 The Reasoning Model Paradox of DeepSeek-R1

DeepSeek-R1, known for its Chain-of-Thought (CoT) reasoning capabilities, performed worst in this benchmark, exhibiting a clear "reasoning-action" paradox:

| Metric | DeepSeek-R1 | Other Models (avg) | Ratio |
|--------|-----------|-------------------|-------|
| Avg Output Tokens | 7,630 | 2,000 | **3.8×** |
| Avg Rounds | 5.0 | 8.8 | **0.57×** |
| Avg Tool Calls | 4.0 | 7.8 | **0.51×** |
| Score | 51.4 | 86.7 | **0.59×** |
| Total Time | 115.0 min | 62.5 min | **1.84×** |

R1 allocates substantial computational resources to generating CoT reasoning text, but these reasoning traces fail to translate into effective tool-use behavior:
- In cn_dynamic_003, R1 produced 31,201 output tokens in just 5 rounds (6,240 tokens/round) yet achieved zero successful page interactions
- In cn_dynamic_pdf_001 and cn_dynamic_pdf_002, R1 spent nearly 19 minutes each but failed to locate the target PDFs

**Conclusion**: For Agent tasks requiring "frequent tool calls + environment interaction," improvements in pure reasoning capability cannot compensate for deficiencies in action capability.

---

## 6. Limitations and Future Work

### 6.1 Current Limitations

1. **Limited test set size**: Only 21 cases, insufficient to cover all possible evidence collection scenarios
2. **Limited model selection**: Only 4 models evaluated; GPT-4o, Claude, and other mainstream models are not included
3. **Concentrated data sources**: Primarily focused on Chinese and U.S. financial regulatory websites, lacking coverage of other domains
4. **Single run**: No repeated experiments to assess the stability of model performance
5. **No cost accounting**: API call costs not compared across models

### 6.2 Future Work

1. **Expand test set**: Increase to 100+ cases covering additional domains (healthcare, law, academia)
2. **Include more models**: Add GPT-4o, Claude, Gemini, and other international models for cross-comparison
3. **Multilingual expansion**: Add test scenarios in Japanese, Korean, and other Asian languages
4. **Stability assessment**: Run each case multiple times to evaluate performance variance
5. **Cost-efficiency analysis**: Integrate precise API pricing data for cost-effectiveness metrics

---

## Appendix

### Appendix A: Complete Score Matrix

| # | Case ID | Category | Question Summary | GLM-5 | MiniMax | Kimi | R1 |
|---|---------|----------|-----------------|-------|---------|------|----|
| 1 | cn_text_001 | text | 2025 China total population | 100 | 100 | 100 | 100 |
| 2 | cn_text_002 | text | CSRC securities regulatory bureaus count | 100 | 100 | 100 | 100 |
| 3 | cn_text_table_001 | text/table | Jan 2026 PMI | 100 | 100 | 100 | 100 |
| 4 | cn_table_001 | table | Rebar price change (Jan late) | 100 | 100 | 100 | 100 |
| 5 | cn_table_002 | table | Zhengzhou used housing price YoY | 100 | 100 | **0** | **0** |
| 6 | cn_table_003 | table | Rental housing rent YoY | 100 | 100 | 100 | 100 |
| 7 | cn_table_004 | table | Durable goods price YoY | 100 | 100 | 100 | 80 |
| 8 | cn_table_005 | table | Non-manufacturing business activity index | 100 | 100 | 100 | 100 |
| 9 | cn_table_006 | table | Rebar price change (Feb early) | 100 | 100 | 100 | 100 |
| 10 | cn_dynamic_001 | dynamic | Gov bond transaction count | 100 | **0** | 100 | **0** |
| 11 | cn_dynamic_002 | dynamic | Top market cap stock ratio | 100 | **0** | **0** | **0** |
| 12 | cn_dynamic_003 | dynamic | Fund trading volume | 100 | **0** | **0** | **0** |
| 13 | cn_dynamic_004 | dynamic | Securities lending balance | 100 | **0** | **0** | **0** |
| 14 | cn_dynamic_pdf_001 | dynamic+pdf | China Gold Zhengzhou branch head | 100 | 100 | 80 | **0** |
| 15 | cn_dynamic_pdf_002 | dynamic+pdf | SPDB net asset per share change | 100 | 100 | 100 | **0** |
| 16 | us_text_001 | text | IORB rate (Feb 2024) | 100 | 100 | 100 | 100 |
| 17 | us_text_002 | text | FOMC dissenting vote | 100 | 100 | 100 | 100 |
| 18 | us_text_003 | text | IORB rate cut to | 100 | 80 | 100 | 100 |
| 19 | us_table_001 | table | 10-year Treasury yield | 100 | 100 | 100 | 100 |
| 20 | video_001 | video | Ken Robinson TED talk quote | 100 | 100 | 100 | **0** |
| 21 | video_002 | video | Neural network input layer neurons | 100 | 100 | 100 | **0** |
| | | | **Total** | **2,100** | **1,680** | **1,680** | **1,080** |

### Appendix B: Failure Case Error Analysis

| Case | Model | Failure Reason |
|------|-------|---------------|
| cn_table_002 | Kimi | Wrong answer: failed to accurately locate Zhengzhou used housing YoY data from complex table |
| cn_table_002 | R1 | Wrong answer: returned 91.1 (correct: 90.9), likely read adjacent row data |
| cn_table_004 | R1 | Evidence type mismatch: extracted from body text instead of table (scored 80) |
| cn_dynamic_001 | MiniMax | Round trip exhaustion: failed to complete date setting within 30 rounds |
| cn_dynamic_001 | R1 | Wrong date: retrieved wrong date's data (167 vs correct 61) |
| cn_dynamic_002 | MiniMax, Kimi | Date confusion: returned 5.33% (2026 data) instead of 3.97% (2025 data) |
| cn_dynamic_002 | R1 | Date confusion: failed to correctly switch to Feb 2025 data |
| cn_dynamic_003 | MiniMax | Round trip exhaustion: 30 rounds without completion |
| cn_dynamic_003 | Kimi | Round trip exhaustion: 30 rounds without completion |
| cn_dynamic_003 | R1 | Premature stop: stopped after 5 rounds, generated extensive CoT text but no effective actions |
| cn_dynamic_004 | MiniMax, Kimi, R1 | Date confusion / partial match: all retrieved wrong date's lending data |
| cn_dynamic_pdf_001 | R1 | Navigation failure: could not find target PDF in announcements page |
| cn_dynamic_pdf_001 | Kimi | Evidence type mismatch: correct answer but cited as text instead of pdf (scored 80) |
| cn_dynamic_pdf_002 | R1 | Navigation failure: could not find target PDF in announcements page |
| us_text_003 | MiniMax | Evidence type mismatch: cited as pdf instead of text (scored 80) |
| video_001 | R1 | Answer matching failure: included correct quote but scoring engine failed to match full phrase |
| video_002 | R1 | No citation created: answered the question but did not call `verifaible_cite` |

### Appendix C: Token Usage Details

| Model | Total Input Tokens | Total Output Tokens | Total Tokens | Avg Input/Case | Avg Output/Case |
|-------|-------------------|--------------------|--------------| --------------|----------------|
| GLM-5 | 1,866,536 | 31,507 | 1,898,043 | 88,883 | 1,500 |
| MiniMax-M2.5 | 3,453,171 | 54,435 | 3,507,606 | 164,437 | 2,592 |
| Kimi-K2.5 | 2,654,870 | 39,759 | 2,694,629 | 126,422 | 1,893 |
| DeepSeek-R1 | 1,016,392 | 160,241 | 1,176,633 | 48,400 | 7,631 |

---

*The complete dataset and code are open-sourced in the [verifaible-bench](https://github.com/verifaible/verifaible-bench) repository.*
