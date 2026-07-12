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

MODEL = "gemini-3.1-flash-lite"
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
scanned PDFs, or photos of stamped floor plans.

First decide is_document: is the input an actual permit/floor-plan
document, or something else (a greeting, small talk, an unrelated
question)? Set it honestly.

If is_document is true: extract exactly the fields in the schema. Do not
infer values that aren't stated; if a field is genuinely absent, use the
literal text from the document (e.g. "Not specified in drawings") rather
than guessing a number. Set extraction_confidence honestly — below 0.7
means the source was hard to read (poor scan, ambiguous handwriting) and
downstream steps should know to be cautious.

If is_document is false: fill every other field with "Not specified" /
0 / false / empty list as applicable and set extraction_confidence to 0 —
downstream steps use is_document to skip processing and respond normally.
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
async def _gate_on_extraction_confidence(
    tool: BaseTool, args: dict, tool_context: ToolContext
) -> dict | None:
    """Refuse to run the compliance check on non-documents or low-confidence
    extractions. Without this, a plain greeting (all-zero/placeholder
    fields) would be checked as if 0mm and 0 exits were real drawn values —
    producing a fabricated code violation instead of just not running the
    check at all.
    """
    if tool.name != "check_egress_rules":
        return None

    extracted = tool_context.state.get("extracted") or {}

    if not extracted.get("is_document", False):
        # Not a document at all — block the tool call outright. The model's
        # instruction already tells it not to call this for non-documents;
        # this is the backstop in case it does anyway.
        return {
            "ruleset_version": "n/a",
            "checks": [],
            "status": "PASS",
            "not_applicable": True,
        }

    confidence = extracted.get("extraction_confidence", 0)
    if confidence < MIN_EXTRACTION_CONFIDENCE:
        return {
            "ruleset_version": "n/a",
            "checks": [{
                "rule_id": "INTAKE-01",
                "result": "NEEDS_INFO",
                "detail": (
                    f"Extraction confidence {confidence} is below the "
                    f"{MIN_EXTRACTION_CONFIDENCE} threshold — the document "
                    "was unreadable. Not evaluated against egress rules; "
                    "real field values are required first."
                ),
            }],
            "status": "NEEDS_INFO",
        }
    return None


async def _capture_compliance_result(
    tool: BaseTool, args: dict, tool_context: ToolContext, tool_response: dict
) -> dict | None:
    if tool.name == "check_egress_rules" and not tool_response.get("not_applicable"):
        extracted = tool_context.state["extracted"]
        tool_context.state["compliance"] = ComplianceResult(
            application_ref=extracted["application_ref"],
            ruleset_version=tool_response["ruleset_version"],
            checks=tool_response["checks"],
            status=tool_response["status"],
        ).model_dump()
    return None  # don't alter what the tool returns to the model


compliance_agent = Agent(
    name="compliance_agent",
    model=MODEL,
    description="Checks extracted permit fields against the versioned egress/fire-safety ruleset.",
    instruction="""
Extracted permit data is in state under `extracted`:
{extracted}

If extracted.is_document is false: this isn't a document to process. Do
NOT call check_egress_rules. Just reply in one or two friendly sentences
that you're a construction permit compliance agent and can check a permit
application or floor-plan document for egress/fire-safety compliance once
one is provided.

If extracted.is_document is true: call check_egress_rules with those exact
field values. Do not compute or restate the result yourself — the tool's
output is authoritative. After calling it, reply with one sentence
summarizing the status for the log.
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
    if tool.name not in ("file_document", "open_review_task"):
        return None

    extracted = tool_context.state.get("extracted") or {}
    compliance = tool_context.state.get("compliance")

    if not extracted.get("is_document", False):
        # Nothing was ever submitted — neither tool applies. Block both;
        # the model should just have replied conversationally already.
        return {"status": "not_applicable", "reason": "No document was submitted."}

    if tool.name == "file_document" and (not compliance or compliance["status"] != "PASS"):
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
Compliance result: {compliance?}

If extracted.is_document is false: no document was submitted, so there's
nothing to file or escalate. Do NOT call any tool. Just close out with a
brief, friendly line (or nothing at all if the compliance_agent already
replied for you).

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
