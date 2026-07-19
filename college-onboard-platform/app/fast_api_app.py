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
import asyncio
from dotenv import load_dotenv
load_dotenv(override=True)
import google.auth
from fastapi import FastAPI
from google.adk.cli.fast_api import get_fast_api_app
from google.cloud import logging as google_cloud_logging

from app.app_utils.telemetry import setup_telemetry
from app.app_utils.typing import Feedback
from app.endpoints.routes import router

setup_telemetry()
otel_to_cloud = False
project_id = "mock-project-id"

if os.getenv("ENV") == "production":
    try:
        _, project_id = google.auth.default()
        otel_to_cloud = True
    except Exception:
        pass

logger = None
if os.getenv("ENV") == "production":
    try:
        logging_client = google_cloud_logging.Client()
        logger = logging_client.logger(__name__)
    except Exception:
        pass

if logger is None:
    import logging
    logging.basicConfig(level=logging.INFO)
    class LocalLogger:
        def log_struct(self, data, severity="INFO"):
            logging.info(f"[{severity}] {data}")
        def info(self, msg):
            logging.info(msg)
        def error(self, msg):
            logging.error(msg)
        def warning(self, msg):
            logging.warning(msg)
    logger = LocalLogger()

allow_origins = (
    os.getenv("ALLOW_ORIGINS", "").split(",") if os.getenv("ALLOW_ORIGINS") else None
)

logs_bucket_name = os.environ.get("LOGS_BUCKET_NAME")
AGENT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
session_service_uri = None
artifact_service_uri = f"gs://{logs_bucket_name}" if logs_bucket_name else None

from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse

app: FastAPI = get_fast_api_app(
    agents_dir=AGENT_DIR,
    web=True,
    artifact_service_uri=artifact_service_uri,
    allow_origins=allow_origins,
    session_service_uri=session_service_uri,
    otel_to_cloud=otel_to_cloud,
)
app.title = "college-onboard-platform"
app.description = "API for interacting with the Agent college-onboard-platform"

# Include endpoints router
app.include_router(router)

# Remove default root route redirection to playground UI
app.router.routes = [r for r in app.router.routes if not hasattr(r, "path") or r.path != "/"]

# Mount static files directory
static_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "static")
os.makedirs(static_dir, exist_ok=True)
app.mount("/static", StaticFiles(directory=static_dir), name="static")

@app.get("/")
def read_index():
    return FileResponse(os.path.join(static_dir, "index.html"))


# Ambient Background Operator definition
async def ambient_background_worker():
    from app.core.local_storage import LocalStateStore
    store = LocalStateStore()
    while True:
        try:
            state = store.load_state()
            # Simulates ambient agent watching database state changes and handling long-running updates
        except Exception:
            pass
        await asyncio.sleep(5)

@app.on_event("startup")
async def startup_event():
    asyncio.create_task(ambient_background_worker())


@app.post("/feedback")
def collect_feedback(feedback: Feedback) -> dict[str, str]:
    """Collect and log feedback."""
    logger.log_struct(feedback.model_dump(), severity="INFO")
    return {"status": "success"}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
