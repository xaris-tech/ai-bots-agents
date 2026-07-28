# Copyright 2026 Google LLC
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     https://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

import contextlib
import json
import logging
import os
import uuid
from collections.abc import AsyncIterator

from a2a.server.tasks import InMemoryTaskStore
from dotenv import load_dotenv
from fastapi import Depends, FastAPI, Request
from google.adk.cli.fast_api import get_fast_api_app
from google.adk.runners import Runner
from google.genai import types

from app.api import create_bid_router
from app.app_utils import services
from app.app_utils.a2a import attach_a2a_routes
from app.app_utils.telemetry import setup_telemetry
from app.app_utils.typing import Feedback
from app.auth import require_auth
from app.bid_models import ChatRequest
from app.runtime import get_repository

load_dotenv()
if os.getenv("ENABLE_CLOUD_TELEMETRY", "false").lower() == "true":
    setup_telemetry()
logger = logging.getLogger(__name__)
allow_origins = (
    os.getenv("CORS_ALLOWED_ORIGINS", os.getenv("ALLOW_ORIGINS", "")).split(",")
    if os.getenv("CORS_ALLOWED_ORIGINS") or os.getenv("ALLOW_ORIGINS")
    else ["http://localhost:3000"]
)

AGENT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


@contextlib.asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    from app.agent import app as adk_app
    from app.agent import root_agent

    runner = Runner(
        app=adk_app,
        session_service=services.get_session_service(),
        artifact_service=services.get_artifact_service(),
        auto_create_session=True,
    )
    app.state.runner = runner
    app.state.agent_app_name = adk_app.name
    await attach_a2a_routes(
        app,
        agent=root_agent,
        runner=runner,
        task_store=InMemoryTaskStore(),
        rpc_path=f"/a2a/{adk_app.name}",
    )
    yield


app: FastAPI = get_fast_api_app(
    agents_dir=AGENT_DIR,
    web=True,
    artifact_service_uri=services.ARTIFACT_SERVICE_URI,
    allow_origins=allow_origins,
    session_service_uri=services.SESSION_SERVICE_URI,
    otel_to_cloud=False,
    lifespan=lifespan,
)
app.title = "construction-bid-copilot"
app.description = "API for interacting with the Agent construction-bid-copilot"
app.include_router(create_bid_router(get_repository))


@app.get("/healthz")
def healthz() -> dict[str, str]:
    """Unauthenticated liveness probe (for uptime checks / Cloud Run)."""
    return {"status": "ok"}


@app.post("/api/chat")
async def chat(
    payload: ChatRequest,
    request: Request,
    _user: dict[str, str] = Depends(require_auth),
) -> dict[str, str]:
    session_id = payload.session_id or str(uuid.uuid4())
    message = types.Content(
        role="user", parts=[types.Part.from_text(text=payload.message)]
    )
    text_parts: list[str] = []
    async for event in request.app.state.runner.run_async(
        user_id="local-ceo",
        session_id=session_id,
        new_message=message,
    ):
        if event.content and event.content.parts:
            text_parts.extend(part.text for part in event.content.parts if part.text)
    return {"session_id": session_id, "message": "".join(text_parts)}


@app.post("/feedback")
def collect_feedback(
    feedback: Feedback,
    _user: dict[str, str] = Depends(require_auth),
) -> dict[str, str]:
    """Collect and log feedback.

    Args:
        feedback: The feedback data to log

    Returns:
        Success message
    """
    logger.info("agent_feedback %s", json.dumps(feedback.model_dump()))
    return {"status": "success"}


# Main execution
if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8000)
