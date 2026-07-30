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

import os

import pytest

from app.agent import run_bid_copilot

LIVE_CLAUDE_CONFIGURED = bool(os.getenv("RUN_LIVE_CLAUDE_TESTS"))


@pytest.mark.skipif(
    not LIVE_CLAUDE_CONFIGURED,
    reason="Set RUN_LIVE_CLAUDE_TESTS=1 to run against a live Claude session",
)
@pytest.mark.asyncio
async def test_agent_responds() -> None:
    """Integration test: the bid copilot returns a non-empty answer and a session id."""
    message, session_id = await run_bid_copilot(
        "List the current high-fit bids.", session_id=None
    )
    assert message.strip(), "Expected a non-empty response"
    assert session_id
