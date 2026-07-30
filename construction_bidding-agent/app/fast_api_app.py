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

import json
import logging
import os

from dotenv import load_dotenv
from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.agent import run_bid_copilot
from app.api import create_bid_router
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

app = FastAPI(
    title="construction-bid-copilot",
    description="API for interacting with the Agent construction-bid-copilot",
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=allow_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(create_bid_router(get_repository))


@app.get("/healthz")
def healthz() -> dict[str, str]:
    """Unauthenticated liveness probe (for uptime checks / Cloud Run)."""
    return {"status": "ok"}


@app.post("/api/chat")
async def chat(
    payload: ChatRequest,
    _user: dict[str, str] = Depends(require_auth),
) -> dict[str, str]:
    message, session_id = await run_bid_copilot(payload.message, payload.session_id)
    return {"session_id": session_id, "message": message}


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
