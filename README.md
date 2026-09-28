# playwright-jev

A TypeSafe Jev agent that controls a persistent **Playwright CLI** session. Includes an unchanged copy of the Trello workshop app and a recorded three-way comparison: **Astra + MCP**, **Jev + CLI**, and **Astra + native CLI**.

The instruction for all three systems is:

> Create a board named "Product launch", add a list named "todo" to that board, and add a card named "Write launch announcement" to that list. Stop when the card is visible. Do not create duplicates.

All receive the named values from `test-data/trello.json` before starting. The Jev agent has **no text-generation model**: it selects an observed field and an exact supplied value in the same request as its next action.

## Run

Requires Node.js 22+, npm, Google Chrome, and `ffmpeg`/`ffprobe` on PATH for recording/rendering. The Playwright CLI and MCP packages are pinned to releases that use the same Playwright build.

```sh
npm ci
npm run setup
cp .env.example .env
# Supply TYPESAFE_API_KEY and OPENAI_API_KEY, or export them in your shell.
npm run compare -- --output artifacts/my-comparison
```

The comparison starts its own production demo on ports **3100/3101**, restores the demo database on shutdown, and closes only the browser sessions it creates. It refuses occupied ports and existing output directories. Stop `npm run demo` before running the comparison or end-to-end tests.

No keys are required for `npm run check`. Model calls in the live commands consume provider credits. Keys are read from the environment or the ignored root `.env`; browser child processes do not receive model credentials.

Playwright's video recorder may require its platform FFmpeg helper on a new machine. If it reports a missing helper, run `npx playwright install ffmpeg` once. This is separate from the system `ffmpeg` used for rendering.

To use the Jev agent on another page:

```sh
npm run jev -- --url https://example.com --goal "Your complete task" --data test-data/trello.json --output artifacts/my-run
```

`--data` accepts a JSON object of descriptive labels and string values, such as `{"board":"Product launch","list":"todo","card":"Write launch announcement"}`. Labels describe the meaning of each value, not selectors or the order of actions. Supply the values your task requires. Without a data file the agent can navigate and click, but cannot type. Only `TYPESAFE_API_KEY` is needed for the standalone Jev agent; OpenAI credentials are used by the MCP and native CLI comparison baselines.

To inspect the demo manually:

```sh
npm run demo:build
npm run demo
# http://127.0.0.1:3100
```

The default run order is MCP, Jev + CLI, then Astra + CLI. To rotate the order or re-render an existing recording:

```sh
npm run compare -- --output artifacts/another-comparison --order jev-first
# --order cli-first is also supported.
npm run render -- artifacts/my-comparison
```

## Architecture

```text
page + supplied data -> observed elements -> Jev operation and target questions
                                       |
                              selected operation only
                                       |
               TYPE_TEXT -> chosen field + exact supplied value
                                       |
                    freshness guard -> Playwright CLI -> page
```

All Jev browser interactions go through the actual `playwright-cli` executable and its persistent named session. `run-code` carries fixed adapter code that batches DOM reads, resolves retained observed nodes, and calls Playwright click/fill/select/press methods. It does not ask a general model to write executable code, and it does not bypass the CLI through a separate browser connection. Compared with a direct Playwright library integration, every command still pays CLI process/IPC overhead.

The observer recognizes standard HTML/ARIA controls and named pointer-styled surfaces, including nested React div controls in the unmodified demo. It retains actual DOM nodes in a per-document map. Model IDs are code-owned identities, never model-produced selectors or coordinates. Input values are validated on load and passed to the browser as data.

Jev gets the original goal, supplied test data, visible page text, element values, and recent executed actions. One TypeSafe request asks for an operation plus speculative operation-specific targets. For `TYPE_TEXT`, each choice is a pair of an observed field and a named input value, so field and value are selected together without a second model call. Only the selected operation's target is validated and consumed. Operations are `CLICK`, `TYPE_TEXT`, `SELECT`, `PRESS_ENTER`, `SCROLL_UP`, `SCROLL_DOWN`, `WAIT`, `DONE`, and `BLOCKED`. Enter is needed for forms that have no submit button, including the demo's empty-state board form.

Before input, the adapter compares a semantic snapshot and verifies the observed element still exists and is actionable. A changed page gets a new prediction. Browser mutations are never blindly retried after an uncertain result. Typed text must exactly equal the selected supplied value; the agent cannot invent or rewrite strings. Runs have decision, action, elapsed-time, subprocess, and network budgets.

Main files:

- `lib/browser/snapshot.ts`: browser-side observation and stable node map.
- `lib/browser/cli.ts`: Playwright CLI transport, freshness guard, execution, recording.
- `lib/models/jev.ts`: request construction and response validation.
- `lib/agent/data.ts`: validation and loading of named input values.
- `test-data/trello.json`: board, list and card names supplied to all agents.
- `lib/agent/loop.ts`: generic bounded agent; no Trello workflow or scripted action sequence.
- `lib/browser/mcp.ts`: real Playwright MCP connection over stdio.
- `lib/browser/cli-native.ts`: native CLI commands and accessibility snapshots for the LLM arm.
- `lib/models/responses.ts`: GPT-6 Astra via OpenAI Responses, default low reasoning.
- `lib/comparison/baseline.ts`: shared Astra model/tool loop with MCP or native CLI tools.
- `lib/comparison/cli.ts`: fresh-state runs, timing, verification, artifact capture.
- `lib/comparison/render.ts`: original-speed side-by-side MP4.

## What the comparison measures

This is a **whole-system scenario demonstration**, not an isolated benchmark of MCP versus CLI. The systems deliberately differ in decision model, representation of browser state, and execution adapter:

| | MCP baseline | Jev + CLI | LLM + native CLI |
|---|---|---|---|
| Decision model | GPT-6 Astra, low reasoning | Jev (`jev-latest`; actual model ID recorded) | GPT-6 Astra, low reasoning |
| Field values | Astra copies supplied data into tool arguments | Jev selects an exact supplied value; no text helper | Astra copies supplied data into command arguments |
| Observation | Native MCP accessibility snapshots | Custom DOM element table and visible text | Native CLI accessibility snapshots |
| Transport | Real MCP stdio | Real CLI subprocess and daemon | Real CLI subprocess and daemon |
| Execution | Native MCP tools | Fixed scripts through CLI `run-code` | Native CLI `fill`, `click`, `press`, etc. |

The MCP baseline sees the actual server schemas for snapshot, click, type, fill-form, press-key, select-option, wait-for, and hover. Its normal tool results include updated snapshots. When MCP returns a generated snapshot attachment, the client reads that confined file and supplies its contents to the model in the same tool result. Arbitrary evaluation, network tools, shell, and model-generated `run-code` are not offered; it must use the UI. It can batch fields with `browser_fill_form`.

The native CLI baseline uses the same Astra Responses model, reasoning setting, goal, data, system policy and model loop as MCP. Its tools run the real CLI's `snapshot`, `fill` (including `--submit`), `click`, `press`, `select`, `hover` and `mousewheel` commands. Targets must be native snapshot refs such as `e16`. Arguments pass directly to `execFile` without a shell. CLI emits snapshots when it detects changes; generated snapshot files within the owned output directory are inlined into that same result. Some actions, such as filling a field, may return no snapshot. Earlier snapshots remain in the model's history, and the model can request `snapshot` when needed. It never calls Jev and never receives Jev's custom DOM table or prewritten action sequence. The code does not add a separate snapshot command after every action.

All three agents receive the same full goal and named test data. None receives application source, a site-specific action plan, or access to the reset/verification API. The Astra arms make the models more comparable, but command schemas, supported actions and transport still differ; this remains a whole-system demonstration.

Timing begins at the first decision request and ends at accepted completion. It includes model calls, browser transport, freshness checks, retries of stale decisions, and waits. Browser setup, initial navigation/observation, recorder setup, and independent verification are excluded. Each run records the supplied data, model IDs, usage, calls, actions, verification results, dependency versions, source hash, and timing boundaries.

The verifier separately reads the demo API and checks exact names, board/list/card relationships, counts (no duplicates), and visible final state. A model's `DONE`/`finish` result alone never proves success. Verification status remains in the saved results; the video omits verification badges. The live command exits nonzero on a failed run and preserves its artifacts.

Videos preserve original speed, with no animated cursor that would add artificial action delays. Raw recordings contain a short lead-in and verification tail. The renderer starts all recordings together and freezes finished panes at their final frames. It renders three 960-pixel columns at 2880×1080, or the original two-column layout when loading an older pair. Displayed durations are the measured decision-loop times, not the raw video lengths. One run per system is not evidence of broad speed or reliability; use distinct output directories and rotating orders for repeats.

Each pane has a live stopwatch, starting at playback time zero and freezing at its saved decision-loop duration. The final CLI + Jev time is green, MCP is red, and CLI + Astra is amber, with a two-second hold at the end for readability. These timers are playback-aligned animations of the measured durations: the recording does not capture the exact offset between recorder startup and loop startup. The footage retains its short lead-in and verification tail, and `stopwatch.json` records this timing basis. The video keeps the requested minimal layout: pane labels, timers and metrics, without title, subtitle, verification badge or footer descriptions.

The video shows provider-reported input/output token totals, model calls, browser tool calls and the estimated final API price in USD. Browser tool calls count all actual MCP calls or CLI commands inside the timed loop, including observations and freshness checks. Setup, recording and independent verification calls are excluded. MCP's `finish` is an orchestrator signal, not a browser call. Future recordings capture the adapter counter difference directly; older recordings require an explicit, documented `metrics-input.json` reconstruction or display an unknown count.

`config/pricing.json` contains dated public Standard rates and official source URLs. A copy is frozen as `pricing.json` beside each video. The cost calculation treats ordinary input, cache reads and cache writes separately and includes reasoning in output only once. Jev output tokens are reported but free. This is a rate-card estimate, not a retrieved invoice; it assumes Standard processing and excludes account discounts, credits, taxes and local compute. Unknown models, incomplete usage and unsupported context sizes produce an unavailable price, never a zero-cost claim. Provider tokenizers differ, so token totals are not identical units of text across the two models.

## Artifacts

Each comparison directory contains `comparison.mp4`, `results.json`, `metadata.json`, `source.sha256`, `metrics.json`, and the frozen `pricing.json`, plus `mcp/`, `jev/` and `cli_llm/` folders with original `recording.webm`, initial observations, run logs and verified results. `source.sha256` describes the implementation at recording time; re-rendering adds derived metrics without changing the saved run traces. Failure attempts are retained. All live artifacts are Git-ignored because page contents and entered text can be sensitive.

## Tests and scope

```sh
npm run typecheck
npm test
npm run test:e2e
# or all three:
npm run check
```

Unit tests cover malicious/invalid choices, mismatched target heads, exact field/value selection, invalid supplied data, invented-text rejection, uncertain mutation handling, stale retries, and independent verification. Playwright tests run against the production build, reset state per test, and exercise the actual CLI adapter through the complete board/list/card UI with an intentional stale decision. No tests invoke paid models.

The observer is an MVP. Shadow roots, iframes, uploads, new tabs, arbitrary keyboard widgets, and nested scrolling are not supported. The pointer heuristic and name extraction are not the browser's complete accessibility algorithm. Whole-page semantic guards are intentionally conservative; irrelevant text changes may cause an extra prediction. A model can select a valid but wrong action. Playwright actions stop on uncertain errors instead of attempting automatic recovery.

## Source provenance and conventions

`demo/` is a `git archive` copy at the exact commit in `DEMO_SOURCE.json`, with no nested `.git` directory. Its source is unchanged. Build configuration lives in `config/demo.vite.ts`; the production backend runs through the upstream Vite preview configuration. Dependencies/build outputs are generated locally and ignored. The starting database is restored after owned server shutdown.

The design is adapted from browser-use/jev-ultrafast; its attribution and MIT notice are in `THIRD_PARTY_NOTICES.md`.

New implementation code uses strict TypeScript under `lib/<area>/<thing>.ts`, ESM, a shared Pino logger, explicit network/subprocess timeouts, and Playwright web-first assertions. This small package imports its internal modules directly; it does not add barrel files or one-to-one tests for passive types, logging, and CLI entrypoints. High-value behavior tests and browser integration tests cover those paths. Vendored upstream files are exempt from the new source layout and style rules.

Dependencies needed for the user's requested Playwright CLI/MCP implementation are intentional. Other dependencies provide TypeScript execution/typechecking, schema validation, and logging. The organization-wide built-ins-only recommendation is not applied to this browser integration. Timing/recording artifacts intentionally contain measurements and are exempt from timestamp-free code-generation rules. `npm run typecheck` is used instead of the pnpm-specific spelling. Local fake model dependencies keep unit tests offline; MSW is not added solely for the pure contract tests.

Validation includes local code inspection, strict typechecking, offline unit tests, and real browser checks.
