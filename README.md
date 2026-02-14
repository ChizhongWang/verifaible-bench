# verifaible-bench

Benchmark framework for evaluating LLM performance on evidence creation tasks using the VerifAIble platform.

## Setup

```bash
npm install
cp .env.example .env
# Edit .env with your API keys
```

## Usage

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

## Results

Results are saved to `results/{model}_{task}_{timestamp}/`:
- `conversation.json` — full turn-by-turn dialogue
- `metrics.json` — token usage, round-trips, duration
- `evidence.json` — created citations and final answer

## Adding Tasks

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
