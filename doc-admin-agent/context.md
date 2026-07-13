# Context

## What this is

A construction-industry document-admin agent: reads permit applications /
floor-plan documents, checks them against an egress/fire-safety ruleset,
and either files the result or escalates it for human (surveyor) review.
Built as a demo case study, then extended into a working project.

## Architecture

Three-agent `SequentialAgent` pipeline (`app/agent.py`):

```
extraction_agent -> compliance_agent -> filing_agent
```

- **`extraction_agent`** — reads the raw input, emits a fixed
  `ExtractedPermit` schema (`app/schemas.py`). Classifies `is_document`
  first (real document vs. greeting/small talk) — everything downstream
  branches on this.
- **`compliance_agent`** — calls `check_egress_rules` (`app/tools.py`, a
  pure deterministic function against `app/rules/egress_rules.json`),
  never computes compliance itself. A `before_tool_callback` blocks the
  tool call outright when `is_document` is false or extraction confidence
  is below threshold — otherwise a blank input's zero-valued placeholder
  fields would get evaluated as if they were real measurements.
- **`filing_agent`** — the only agent with write-side tools
  (`file_document`, `open_review_task`). A `before_tool_callback` hard-
  blocks `file_document` unless compliance status is `PASS`. This is
  enforced in code, not by prompt instruction — the model cannot reason
  its way past it.

`app/rules/egress_rules.json` is explicitly illustrative/demo-only — a
real deployment needs a surveyor-authored ruleset.

## Two ways to run it

1. **ADK dev UI** — `agents-cli playground` (or `adk web`), served at
   `:8080`. Fastest way to inspect the raw agent trace.
2. **AG-UI + CopilotKit frontend** — `ag_ui_server.py` exposes the same
   `root_agent` over the AG-UI protocol (`ag-ui-adk`) on `:8000`;
   `frontend/` is a Next.js + CopilotKit app on `:3000` with a chat
   sidebar and a live "case file" panel (via `useCoAgent`) that renders
   extraction fields and compliance checks in real time as the pipeline
   runs — not just as chat text.

## Testing

- `uv run pytest tests/unit tests/integration` — unit tests hit the
  deterministic rule-check logic directly, no model or credentials
  needed.
- `agents-cli eval run --evalset tests/eval/evalsets/permit_intake.evalset.json --config tests/eval/eval_config.json`
  — 5 cases covering PASS / FAIL / NEEDS_INFO / no-document / off-topic.
  Uses `rubric_based_tool_use_quality_v1` rather than
  `tool_trajectory_avg_score` — the latter requires exact tool-call
  `args` equality, which is brittle for an extraction agent whose parsed
  values legitimately vary by document.

## Gotchas worth knowing before touching this again

- **ADK 2.x callback signature**: `before_tool_callback` /
  `after_tool_callback` take keyword args `(tool, args, tool_context,
  [tool_response])`, not the `(callback_context, tool_name, ...)` shape
  shown in some older ADK cheatsheets/docs.
- **`app/.adk/`** (session DB, artifacts) is created by the dev server on
  startup and is gitignored. Don't delete it "for cleanup" while a server
  is running — it breaks session creation until the directory exists
  again. Being gitignored is sufficient; no need to touch it.
- **`.env` key format**: this project runs on a plain Gemini API key
  (`GEMINI_API_KEY`, starts `AIza...`) with
  `GOOGLE_GENAI_USE_VERTEXAI=FALSE`. Google's newer "auth key" format
  (`AQ.` prefix, service-account-bound) is also supported by the
  installed `google-genai`/`google-adk` versions, but needs its own
  prepay credits — a 401 there is usually credits, not the key itself.
- **AG-UI / CopilotKit wiring**: uses the verified v1 stack
  (`CopilotKit` + `CopilotSidebar` + `CopilotRuntime`/`HttpAgent`), not
  the newer v2 provider API. v2's `A2UI` generative-UI theming is real
  and installed (`@ag-ui/a2ui-middleware`) but its wiring pattern wasn't
  verified deeply enough to ship under time pressure — worth revisiting
  as a follow-up, not a gap to silently ignore.
- **Next.js 16 / React 19**: `frontend/` was scaffolded on a Next.js
  version newer than most training data — check
  `frontend/node_modules/next/dist/docs/` before assuming App Router
  conventions haven't changed.
