"""Document Admin Processing Agent — construction permit/floor-plan intake.

Pipeline (SequentialAgent, state flows left to right):

    extraction_agent -> compliance_agent -> filing_agent

Guardrail is structural, not a prompt instruction: the filing agent's
before_tool_callback physically blocks `file_document` unless the
compliance step returned PASS. See `_enforce_compliance_gate` below —
that function is the whole guardrail, everything else is plumbing.
"""

from google.adk.agents import Agent, SequentialAgent
from google.adk.apps import App
from google.adk.tools import BaseTool, FunctionTool, ToolContext

from app.schemas import ExtractedPermit, ComplianceResult
from app.tools import check_egress_rules, file_document, open_review_task

MODEL = "gemini-flash-latest"
MIN_EXTRACTION_CONFIDENCE = 0.5


# ---------------------------------------------------------------------------
# 1. Extraction — reads the raw document (scan, PDF, photo of a stamped
#    drawing) and produces fixed structured fields. Nothing downstream ever
#    reads the source document again; it only reads `extracted`.
# ---------------------------------------------------------------------------
extraction_agent = Agent(
    name="extraction_agent",
    model=MODEL,
    description="Reads a permit application or floor-plan document and extracts structured egress/fire-safety fields.",
    instruction="""
You read construction permit applications and associated drawings — text,
scanned PDFs, or photos of stamped floor plans. Extract exactly the fields
in the schema. Do not infer values that aren't stated; if a field is
genuinely absent, use the literal text from the document (e.g. "Not
specified in drawings") rather than guessing a number.

Set extraction_confidence honestly — below 0.7 means the source was hard
to read (poor scan, ambiguous handwriting) and downstream steps should
know to be cautious.
""",
    output_schema=ExtractedPermit,
    output_key="extracted",
)


# ---------------------------------------------------------------------------
# 2. Compliance guardrail — calls a deterministic rule-check tool rather
#    than reasoning about thresholds itself. The tool's raw dict is copied
#    straight into state by after_tool_callback, so the LLM never gets a
#    chance to paraphrase or soften a FAIL result.
# ---------------------------------------------------------------------------
async def _capture_compliance_result(
    tool: BaseTool, args: dict, tool_context: ToolContext, tool_response: dict
) -> dict | None:
    if tool.name == "check_egress_rules":
        extracted = tool_context.state["extracted"]
        tool_context.state["compliance"] = ComplianceResult(
            application_ref=extracted["application_ref"],
            ruleset_version=tool_response["ruleset_version"],
            checks=tool_response["checks"],
            status=tool_response["status"],
        ).model_dump()
    return None  # don't alter what the tool returns to the model


async def _gate_on_extraction_confidence(
    tool: BaseTool, args: dict, tool_context: ToolContext
) -> dict | None:
    """Refuse to run the compliance check against low-confidence or absent
    extraction data. Without this, a document that failed to extract
    (all-zero/placeholder fields) would be checked as if 0mm and 0 exits
    were real drawn values — producing a fabricated code violation instead
    of correctly reporting "no usable document".
    """
    if tool.name != "check_egress_rules":
        return None

    extracted = tool_context.state.get("extracted") or {}
    confidence = extracted.get("extraction_confidence", 0)
    if confidence < MIN_EXTRACTION_CONFIDENCE:
        return {
            "ruleset_version": "n/a",
            "checks": [{
                "rule_id": "INTAKE-01",
                "result": "NEEDS_INFO",
                "detail": (
                    f"Extraction confidence {confidence} is below the "
                    f"{MIN_EXTRACTION_CONFIDENCE} threshold — no document, or "
                    "an unreadable one, was provided. Not evaluated against "
                    "egress rules; real field values are required first."
                ),
            }],
            "status": "NEEDS_INFO",
        }
    return None


compliance_agent = Agent(
    name="compliance_agent",
    model=MODEL,
    description="Checks extracted permit fields against the versioned egress/fire-safety ruleset.",
    instruction="""
Extracted permit data is in state under `extracted`:
{extracted}

Call check_egress_rules with those exact field values. Do not compute or
restate the result yourself — the tool's output is authoritative. After
calling it, reply with one sentence summarizing the status for the log.
""",
    tools=[FunctionTool(func=check_egress_rules)],
    before_tool_callback=_gate_on_extraction_confidence,
    after_tool_callback=_capture_compliance_result,
)


# ---------------------------------------------------------------------------
# 3. Filing — the ONLY agent with write access to the document management
#    system. `_enforce_compliance_gate` is the guardrail: it runs before
#    every tool call and refuses `file_document` outright unless compliance
#    status is PASS, no matter what the model was asked to do.
# ---------------------------------------------------------------------------
async def _enforce_compliance_gate(
    tool: BaseTool, args: dict, tool_context: ToolContext
) -> dict | None:
    if tool.name != "file_document":
        return None

    compliance = tool_context.state.get("compliance")
    if not compliance or compliance["status"] != "PASS":
        # Skip the real tool entirely; return this in its place.
        return {
            "status": "blocked",
            "reason": (
                "file_document refused: compliance status is "
                f"{compliance['status'] if compliance else 'UNKNOWN'}, not PASS. "
                "Route to open_review_task instead."
            ),
        }
    return None


filing_agent = Agent(
    name="filing_agent",
    model=MODEL,
    description="Files compliant documents and opens human review tasks for anything that failed a check.",
    instruction="""
Extracted data: {extracted}
Compliance result: {compliance}

If compliance status is PASS: call file_document with a filed_path under
/Projects/<project>/Permits/<application_ref>/ and tags describing the
occupancy class and outcome.

If compliance status is FAIL or NEEDS_INFO: do NOT attempt to file. Call
open_review_task with queue="surveyor-review" and a reason that names the
specific failed rule_ids from the compliance result.
""",
    tools=[
        FunctionTool(func=file_document),
        FunctionTool(func=open_review_task),
    ],
    before_tool_callback=_enforce_compliance_gate,
)


root_agent = SequentialAgent(
    name="doc_admin_orchestrator",
    sub_agents=[extraction_agent, compliance_agent, filing_agent],
    description="Intake pipeline for construction permit/floor-plan documents: extract, check compliance, file or escalate.",
)

app = App(
    root_agent=root_agent,
    name="app",
)
