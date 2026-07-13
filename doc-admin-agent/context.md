# Context

## What this is

A construction-industry document-admin agent: reads permit applications /
floor-plan documents, checks them against an egress/fire-safety ruleset,
and either files the result or escalates it for human (surveyor) review.

## Origin

Built to prep for a meeting with Daniela — demonstrating Claude Code
capabilities and strategic AI-agent architecture thinking. The brief:
show a direct Claude Code example and a case study for a plausible
first project, with strict guardrails around legal building legislation
and document-management integration.

Sequence so far:
1. A blueprint-themed case-study artifact (problem statement, ADK
   multi-agent architecture diagram, ADK-vs-Claude-Agent-SDK comparison)
   plus a live Claude Code demo processing a synthetic permit doc.
2. User said "let's stick with ADK" — became a real `agents-cli`-
   scaffolded project (`doc-admin-agent/`) at the repo root, not just a
   diagram.
3. Extended with a real AG-UI + CopilotKit frontend ("stand out to
   applicants" — this doubles as a portfolio/interview piece, not just
   internal meeting prep).
4. Recolored from the case-study's blueprint-blue to a construction
   safety-orange/white theme per explicit request (see Frontend Theming
   below).
5. Added a real ADK eval suite (`tests/eval/evalsets/permit_intake.evalset.json`).

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

## Frontend theming

Currently: white/light background, forced regardless of OS dark-mode
preference (`color-scheme: light` in `frontend/app/globals.css`, no
`prefers-color-scheme: dark` override). Accent is construction safety-
orange/rust (`--accent: #c1531f`), not the case-study artifact's
blueprint-blue — that palette was explicitly rejected ("I don't like the
dark blue color UI"). If asked to touch colors again: keep it white/light
by default, pick accents that read as construction-professional (safety
orange, steel grey), and double-check there's no dark-mode media query
quietly reintroducing a dark palette.

## Running it right now (ports)

| What | Command | Port |
|---|---|---|
| ADK dev UI | `agents-cli playground` (from `doc-admin-agent/`) | 8080 |
| AG-UI backend | `uv run python ag_ui_server.py` (from `doc-admin-agent/`) | 8000 |
| CopilotKit frontend | `npm run dev` (from `doc-admin-agent/frontend/`) | 3000 |

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
