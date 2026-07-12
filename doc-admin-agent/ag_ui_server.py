"""Exposes root_agent over the AG-UI protocol so a CopilotKit frontend can
drive it directly, instead of the ADK dev-UI. Separate process from
`agents-cli playground` — same agent code, different transport.
"""

from ag_ui_adk import ADKAgent, add_adk_fastapi_endpoint
from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.agent import root_agent

load_dotenv()

adk_agent = ADKAgent(
    adk_agent=root_agent,
    app_name="doc_admin_agent",
    user_id="demo_user",
    session_timeout_seconds=3600,
    use_in_memory_services=True,
)

app = FastAPI(title="doc-admin-agent AG-UI server")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_methods=["*"],
    allow_headers=["*"],
)

add_adk_fastapi_endpoint(app, adk_agent, path="/")

if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="127.0.0.1", port=8000)
