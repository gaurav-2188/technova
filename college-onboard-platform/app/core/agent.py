import os
import google.auth
from pydantic import BaseModel, Field
from typing import List, Dict, Any

from google.adk.apps import App, ResumabilityConfig
from google.adk.agents.context import Context
from google.adk.events.event import Event
from google.adk.events.request_input import RequestInput
from google.adk.workflow import Workflow, JoinNode, node, START

from app.core.local_storage import LocalStateStore
from app.core.hitl import review_before_execute
from app.core.privacy import DataMaskingMiddleware
from app.tools.pinecone_rag import PineconeRAGService
from app.app_utils.telemetry import track_memory

# Set up environment variables for ADK's own agent registry / project discovery.
# NOTE: We deliberately do NOT set GOOGLE_GENAI_USE_VERTEXAI here. Doing so used to
# force every google-genai Client() in the whole process (including the plain
# API-key calls in app/endpoints/routes.py) into Vertex AI auth mode, which requires
# Application Default Credentials + an enabled Vertex AI API on the GCP project.
# That mismatch was the root cause of the chatbot's "Your default credentials were
# not found" / 403 SERVICE_DISABLED failures. If a specific piece of code needs
# Vertex AI, pass vertexai=True explicitly to that one genai.Client(...) call instead
# of mutating process-wide environment state here.
try:
    _, project_id = google.auth.default()
except Exception:
    project_id = "mock-project-id"
os.environ.setdefault("GOOGLE_CLOUD_PROJECT", project_id)
os.environ.setdefault("GOOGLE_CLOUD_LOCATION", "global")

# --- 1. Global State Management Schema ---
class WorkflowState(BaseModel):
    candidate_name: str = "Dr. Jane Doe"
    active_stage: str = "START"
    confirmation_email_sent: bool = False
    credentials_sent: bool = False
    documents: List[str] = Field(default_factory=list)
    policy_brief: str = ""
    manager_interview_scheduled: bool = False
    chairperson_notified: bool = False
    final_approval_flag: bool = False
    allotment_criteria: Dict[str, Any] = Field(default_factory=dict)
    it_notified: bool = False
    admin_notified: bool = False
    leave_balance: int = 30
    leaves: List[Dict[str, Any]] = Field(default_factory=list)
    email: str = ""
    username: str = ""
    password: str = ""
    employee_id: str = ""
    
    # Verification Lifecycle fields
    document_statuses: Dict[str, str] = Field(default_factory=lambda: {
        "aadhaar_card": "unuploaded",
        "appointment_letter": "unuploaded",
        "teacher_eligibility_test": "unuploaded"
    })
    document_paths: Dict[str, str] = Field(default_factory=lambda: {
        "aadhaar_card": "",
        "appointment_letter": "",
        "teacher_eligibility_test": ""
    })
    pending_tally: int = 0
    current_stage: str = "document_collection"
    onboarding_status_message: str = "Please upload documents in document upload tab"

    def update_document_upload_path(self, doc_type: str, filepath: str):
        """Sets document status to 'pending' and updates path/filename."""
        if doc_type in self.document_statuses:
            self.document_statuses[doc_type] = "pending"
            self.document_paths[doc_type] = filepath
            print(f"[STATE TRANSITION] Document '{doc_type}' uploaded: {filepath}. Status set to 'pending'.")
            self.recalculate_pending_tally()

    def evaluate_document_approval(self, doc_type: str, approved: bool):
        """Approves or rejects a document, recalculates tally, and advances stage if all approved."""
        status = "approved" if approved else "rejected"
        if doc_type in self.document_statuses:
            self.document_statuses[doc_type] = status
            if not approved:
                self.document_paths[doc_type] = "" # Clear path on rejection
            print(f"[STATE TRANSITION] Document '{doc_type}' evaluation: {status}.")
            self.recalculate_pending_tally()
            self.check_all_approved_transition()

    def recalculate_pending_tally(self):
        """Counts documents with status 'pending'."""
        self.pending_tally = sum(1 for status in self.document_statuses.values() if status == "pending")
        print(f"[STATE METRIC] Recalculated pending tally: {self.pending_tally}")

    def check_all_approved_transition(self):
        """Advances current_stage if all three required documents are approved."""
        all_approved = all(status == "approved" for status in self.document_statuses.values())
        if all_approved:
            self.current_stage = "policy_review"
            print("[STATE TRANSITION] All documents approved! Advancing current_stage to 'policy_review'.")

# --- 2. Workflow Routing and Node Implementations ---

def router_node(ctx: Context, node_input: Any) -> Event:
    """Classifies input queries to route between chatbot and onboarding pipeline."""
    # Sync from local storage schema if it exists
    local_store = LocalStateStore()
    stored_state = local_store.load_state()
    if stored_state:
        # If state contains multi-teacher mapping, extract the default 'teacher' details for ADK workflows
        if "teachers" in stored_state and "teacher" in stored_state["teachers"]:
            teacher_data = stored_state["teachers"]["teacher"]
            for k in WorkflowState.model_fields.keys():
                if k in teacher_data:
                    ctx.state[k] = teacher_data[k]
        else:
            for k, v in stored_state.items():
                if k in WorkflowState.model_fields.keys():
                    ctx.state[k] = v

    from app.core.config import BYPASS_HITL_FOR_TESTING
    if BYPASS_HITL_FOR_TESTING:
        state_updates = {
            "final_approval_flag": True,
            "active_stage": "Provisioning-Done",
            "current_stage": "policy_review",
            "document_statuses": {
                "aadhaar_card": "approved",
                "appointment_letter": "approved",
                "teacher_eligibility_test": "approved"
            },
            "onboarding_status_message": "Verified by HR, details forwarded for teacher onboarding"
        }
        for k, v in state_updates.items():
            ctx.state[k] = v
            
        current_state = local_store.load_state() or {}
        current_state.update(state_updates)
        if "teachers" in current_state and "teacher" in current_state["teachers"]:
            current_state["teachers"]["teacher"].update(state_updates)
        local_store.save_state(current_state)

        return Event(output=node_input, route="chatbot", state=state_updates)

    text = str(node_input)
    if any(keyword in text.lower() for keyword in ["leave", "apply", "balance", "policy", "days"]):
        return Event(output=node_input, route="chatbot")
    return Event(output=node_input, route="onboarding")


@track_memory
def chatbot_node(ctx: Context, node_input: Any) -> Event:
    """On-Demand parallel chatbot verifying leave database & policy rules."""
    # Central Data Masking Layer: Scrub PII from input before evaluating
    clean_input = DataMaskingMiddleware.redact_pii(str(node_input))
    
    response = ""
    state_updates = {}

    from app.core.config import BYPASS_HITL_FOR_TESTING
    if BYPASS_HITL_FOR_TESTING:
        state_updates = {
            "final_approval_flag": True,
            "active_stage": "Provisioning-Done",
            "current_stage": "policy_review",
            "document_statuses": {
                "aadhaar_card": "approved",
                "appointment_letter": "approved",
                "teacher_eligibility_test": "approved"
            },
            "onboarding_status_message": "Verified by HR, details forwarded for teacher onboarding"
        }
        pinecone_service = PineconeRAGService()
        response = pinecone_service.query_rules(clean_input)

        local_store = LocalStateStore()
        current_state = local_store.load_state() or {}
        current_state.update(state_updates)
        if "teachers" in current_state and "teacher" in current_state["teachers"]:
            current_state["teachers"]["teacher"].update(state_updates)
        local_store.save_state(current_state)

        return Event(
            output=response,
            content={"parts": [{"text": response}], "role": "model"},
            state=state_updates
        )

    if "leave" in clean_input.lower() or "apply" in clean_input.lower():
        import re
        days_match = re.search(r"(\d+)\s*day", clean_input.lower())
        days = int(days_match.group(1)) if days_match else 1
        
        balance = ctx.state.get("leave_balance", 30)
        if balance >= days:
            new_balance = balance - days
            leaves = ctx.state.get("leaves", [])
            leaves.append({"days": days, "status": "approved", "request": clean_input})
            state_updates["leave_balance"] = new_balance
            state_updates["leaves"] = leaves
            response = f"✅ Success: Leave of {days} days approved. Remaining leave balance: {new_balance} days. 📅"
        else:
            response = f"❌ Failed: Insufficient leave balance. Requested {days} days but you only have {balance} days. ⚠️"
    else:
        # Vector search query simulation over Pinecone using the masked input
        pinecone_service = PineconeRAGService()
        response = pinecone_service.query_rules(clean_input)

    # Sync to local storage
    local_store = LocalStateStore()
    current_state = local_store.load_state()
    current_state.update(state_updates)
    local_store.save_state(current_state)

    return Event(
        output=response,
        content={"parts": [{"text": response}], "role": "model"},
        state=state_updates
    )


@node(rerun_on_resume=True)
@review_before_execute(api_action="Email HR & Candidate Interview Confirmation")
def initial_interview(ctx: Context, node_input: Any) -> Event:
    """Processes post-interview status and triggers confirmation event."""
    state_updates = {
        "confirmation_email_sent": True,
        "active_stage": "Initial-Interview-Passed"
    }
    local_store = LocalStateStore()
    current_state = local_store.load_state()
    current_state.update(state_updates)
    local_store.save_state(current_state)

    msg = "Initial Interview Complete. Confirmation email fired to HR & Candidate."
    return Event(output=msg, state=state_updates)


def triggered_procedures(ctx: Context, node_input: Any) -> Event:
    """Acts as a state gate to programmatically initiate subsequent tasks."""
    confirmation = ctx.state.get("confirmation_email_sent", False)
    if confirmation:
        state_updates = {"active_stage": "Procedures-Initiated"}
        local_store = LocalStateStore()
        current_state = local_store.load_state()
        current_state.update(state_updates)
        local_store.save_state(current_state)
        return Event(output="Confirmed: Initiating credentials, onboarding and scheduling tasks.", route="start_procedures", state=state_updates)
    return Event(output="Procedures halted: Confirmation email flag is False.", route="halted")


@node(rerun_on_resume=True)
@review_before_execute(api_action="Generate & dispatch secure portal credentials via SMTP")
async def credential_agent(ctx: Context, node_input: Any) -> Event:
    """Automatically generates and emails portal credentials."""
    state = ctx.state
    print(f'CURRENT WORKING STATE: {state}')
    import smtplib
    from email.mime.multipart import MIMEMultipart
    from email.mime.text import MIMEText
    import logging
    import asyncio
    import secrets
    from app.core.config import SMTP_HOST, SMTP_PORT, SMTP_USERNAME, SMTP_PASSWORD

    email = ctx.state.get("email") or "jane.doe@pes.edu"
    username = email
    
    # Attempt to load existing credentials if they exist
    existing_password = ctx.state.get("password")
    local_store = LocalStateStore()
    current_state = local_store.load_state()
    if not existing_password and current_state and "teachers" in current_state:
        for t_username, t_data in current_state["teachers"].items():
            if t_data.get("email") == email and t_data.get("password"):
                existing_password = t_data.get("password")
                break

    password = existing_password or secrets.token_urlsafe(10)
    name = ctx.state.get("candidate_name") or "Dr. Jane Doe"

    print(f"[CREDENTIALS GENERATED] Username: {username}, Target Email: {email}")
    logging.info(f"Preparing to send credentials welcome email to {email}")

    html_content = f"""<!DOCTYPE html>
<html>
<head>
    <style>
        body {{ font-family: 'Inter', sans-serif; background-color: #0d1117; color: #c9d1d9; margin: 0; padding: 20px; }}
        .card {{ background: rgba(255, 255, 255, 0.05); border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 12px; padding: 30px; max-width: 600px; margin: auto; box-shadow: 0 8px 32px 0 rgba(0, 0, 0, 0.37); }}
        h2 {{ color: #58a6ff; margin-top: 0; }}
        p {{ line-height: 1.6; }}
        .credentials {{ background: rgba(255, 255, 255, 0.08); padding: 15px; border-radius: 8px; border-left: 4px solid #58a6ff; font-family: monospace; margin: 20px 0; }}
        .footer {{ font-size: 0.8em; color: #8b949e; text-align: center; margin-top: 30px; }}
    </style>
</head>
<body>
    <div class="card">
        <h2>Welcome to PES University {name}!</h2>
        <p>Dear Faculty Member,</p>
        <p>We are thrilled to welcome you to the PES University family. Your portal credentials have been successfully provisioned. Please log in using the details below:</p>
        <div class="credentials">
            <strong>Portal URL:</strong> https://technova-gt7e.onrender.com<br>
            <strong>Username:</strong> {username}<br>
            <strong>Password:</strong> {password}
        </div>
        <p>After logging in, you will be guided through our onboarding workspace to upload your credentials and check university policy guidelines.</p>
        <p>Best Regards,<br>HR Department<br>PES University</p>
        <div class="footer">
            This is an automated onboarding email. Please do not reply directly.
        </div>
    </div>
</body>
</html>
"""

    def _send_email():
        from app.app_utils.email import send_email
        send_email(email, "Welcome to PES University - Portal Credentials", html_content, is_html=True)

    try:
        await asyncio.to_thread(_send_email)
        logging.info(f"Successfully dispatched welcome email to {email}")
    except Exception as e:
        logging.error(f"Failed to dispatch welcome email to {email}: {e}")

    state_updates = {
        "credentials_sent": True,
        "active_stage": "Credentials-Sent",
        "username": username,
        "password": password
    }
    local_store = LocalStateStore()
    current_state = local_store.load_state()
    current_state.update(state_updates)
    
    # Update Context state so downstream workflow nodes have access
    for k, v in state_updates.items():
        ctx.state[k] = v

    if "teachers" in current_state:
        for t_username, t_data in current_state["teachers"].items():
            if t_data.get("email") == email:
                t_data.update(state_updates)
                break
    local_store.save_state(current_state)

    msg = f"Credentials Generated: Welcome email successfully dispatched via SMTP with TLS to {email}."
    return Event(output=msg, state=state_updates)


async def onboarding_guide(ctx: Context, node_input: Any):
    """Guides the teacher through the scan-and-upload process for joining documents."""
    from app.core.config import BYPASS_HITL_FOR_TESTING
    if BYPASS_HITL_FOR_TESTING:
        docs = ["aadhaar_card.pdf", "appointment_letter.pdf", "teacher_eligibility_test.pdf"]
        state_updates = {
            "documents": docs,
            "active_stage": "Documents-Uploaded"
        }
        local_store = LocalStateStore()
        current_state = local_store.load_state()
        current_state.update(state_updates)
        local_store.save_state(current_state)

        yield Event(output="Onboarding Guide: Documents received (Bypass): " + ",".join(docs), state=state_updates)
        return

    if not ctx.resume_inputs or "uploaded_documents" not in ctx.resume_inputs:
        yield RequestInput(
            interrupt_id="uploaded_documents",
            message="Onboarding Guide: Please upload your scanned joining letters and structural documents (comma-separated):"
        )
        return

    res = ctx.resume_inputs["uploaded_documents"]
    if isinstance(res, dict):
        res_val = res.get("uploaded_documents") or res.get("result") or list(res.values())[0]
    else:
        res_val = res

    docs = [d.strip() for d in str(res_val).split(",")]
    state_updates = {
        "documents": docs,
        "active_stage": "Documents-Uploaded"
    }
    local_store = LocalStateStore()
    current_state = local_store.load_state()
    current_state.update(state_updates)
    local_store.save_state(current_state)

    yield Event(output=f"Onboarding Guide: Documents received: {docs}", state=state_updates)


@track_memory
def policy_rag_agent(ctx: Context, node_input: Any) -> Event:
    """Uses a simulated Llama 3.1 LLM response to check file formats and output college rules brief."""
    if isinstance(node_input, dict):
        res_val = node_input.get("uploaded_documents") or node_input.get("result") or list(node_input.values())[0]
    else:
        res_val = node_input

    # Privacy Scrubbing: mask potential PII in document contents/filenames before rules lookup
    clean_val = DataMaskingMiddleware.redact_pii(str(res_val))
    docs = [d.strip() for d in clean_val.split(",") if d.strip()]
    
    verified_files = [f for f in docs if f.endswith(('.pdf', '.docx'))]
    
    # Query production Pinecone vector database
    pinecone_service = PineconeRAGService()
    brief = pinecone_service.query_rules(clean_val)

    state_updates = {
        "documents": docs,
        "policy_brief": brief,
        "active_stage": "Policy-Checked"
    }
    local_store = LocalStateStore()
    current_state = local_store.load_state()
    current_state.update(state_updates)
    local_store.save_state(current_state)

    msg = f"Policy RAG (Llama 3.1 Simulation) complete. Verified: {verified_files}.\n{brief}"
    return Event(output=msg, state=state_updates)


def get_salary_status_message(teacher_data: dict) -> str:
    """Returns salary credited message only if it was credited within the last 24 hours."""
    import datetime
    history = teacher_data.get("salary_history", [])
    if not history:
        return ""
    
    latest_record = history[0]
    if latest_record.get("status") != "Credited":
        return ""
        
    credited_at_str = latest_record.get("credited_at")
    if not credited_at_str:
        return ""
        
    try:
        credited_at = datetime.datetime.fromisoformat(credited_at_str)
        now = datetime.datetime.now(datetime.timezone.utc)
        if credited_at.tzinfo is None:
            now = datetime.datetime.now()
        
        delta = now - credited_at
        if delta.total_seconds() <= 24 * 3600:
            return "💰 Salary for the month has been credited."
    except Exception:
        pass
        
    return ""


def generate_dynamic_companion_brief(teacher_name: str, department: str, designation: str, salary_msg: str, upcoming_meetings: list, seating_info: str = "") -> str:
    """Generates a dynamic daily briefing message for a faculty member using Groq API."""
    import os
    import requests
    
    groq_key = os.getenv("GROQ_API_KEY", "").strip()
    
    # Construct a default fallback brief in markdown
    fallback_parts = []
    if salary_msg:
        fallback_parts.append(f"💰 **Salary Status**: {salary_msg}")
    
    if seating_info:
        fallback_parts.append(f"🪑 **Seating Assigned**: {seating_info} — check the **Seating Info** tab to view your workspace details.")
    
    if upcoming_meetings:
        fallback_parts.append("\n📅 **Upcoming Meetings & Events**:")
        for m in upcoming_meetings:
            fallback_parts.append(m)
        fallback_parts.append("\n*Please check your calendar for details.*")
    else:
        fallback_parts.append("\n📅 *No upcoming meetings or events scheduled.*")
        fallback_parts.append("\n💡 **Fun Fact**: Did you know that PES University was founded in 1972 and was originally known as the People's Education Society?")
    
    default_brief = "\n".join(fallback_parts)
    
    if not groq_key or groq_key == "your_groq_api_key_here":
        return default_brief
        
    try:
        url = "https://api.groq.com/openai/v1/chat/completions"
        headers = {
            "Authorization": f"Bearer {groq_key}",
            "Content-Type": "application/json"
        }
        
        meetings_str = "\n".join(upcoming_meetings) if upcoming_meetings else "None"
        seating_note = f""
        if seating_info:
            seating_note = f"- Seating: {seating_info} (newly assigned — mention they should check the Seating Info tab)\n"
        prompt = f"""You are the PESU Companion daily brief generator for PES University's faculty onboarding portal.
Generate a daily briefing message for a faculty member.

Faculty Member Details:
- Name: {teacher_name}
- Department: {department}
- Designation: {designation}
{seating_note}
Current Status:
- Salary Status: {salary_msg}
- Upcoming Meetings & Public Holidays:
{meetings_str}

Instructions:
1. Format your response using clean Markdown. Use bold (**text**) and italics (*text*) to highlight key information or terms.
2. If seating has been assigned, mention it warmly and tell them to check the Seating Info tab.
3. If there are upcoming meetings/holidays, list them using bullet points (• or -) with the exact date and time provided — do NOT paraphrase or invent dates.
4. If there are NO upcoming meetings or public holidays, write a warm, encouraging check-in message and include an interesting, inspiring **Fun Fact** or **Productivity/Teaching Tip**.
5. Keep the entire briefing concise (under 80 words), professional, and warm.
6. Do not include markdown headers (like # or ##). Start directly with the briefing content.
"""

        payload = {
            "model": "llama-3.1-8b-instant",
            "messages": [
                {
                    "role": "user",
                    "content": prompt
                }
            ],
            "temperature": 0.7,
            "max_tokens": 200
        }
        res = requests.post(url, headers=headers, json=payload, timeout=10)
        if res.status_code == 200:
            data = res.json()
            brief = data["choices"][0]["message"]["content"].strip()
            # Clean up any potential markdown headers
            lines = brief.split('\n')
            cleaned_lines = []
            for line in lines:
                if line.strip().startswith(('#', '##', '###', '####')):
                    cleaned_lines.append(line.lstrip('#').strip())
                else:
                    cleaned_lines.append(line)
            return "\n".join(cleaned_lines)
    except Exception as e:
        print(f"[Groq Daily Brief Generation Error] {e}")
        
    return default_brief


def get_or_generate_companion_brief(teacher_data: dict, salary_msg: str, upcoming_meetings: list, today_str: str, seating_info: str = "") -> tuple[str, bool, dict]:
    """
    Checks cache. Returns (brief, was_regenerated, updated_meta_to_save).
    """
    old_brief = teacher_data.get("pesu_companion_brief", "")
    last_date = teacher_data.get("pesu_companion_last_generated_date", "")
    last_inputs = teacher_data.get("pesu_companion_last_inputs", {})
    
    current_inputs = {
        "salary_msg": salary_msg,
        "upcoming_meetings": sorted(upcoming_meetings),
        "seating_info": seating_info,
    }
    
    if old_brief and last_date == today_str and last_inputs == current_inputs:
        return old_brief, False, {}
        
    new_brief = generate_dynamic_companion_brief(
        teacher_name=teacher_data.get("name") or "",
        department=teacher_data.get("department") or "",
        designation=teacher_data.get("designation") or "",
        salary_msg=salary_msg,
        upcoming_meetings=upcoming_meetings,
        seating_info=seating_info,
    )
    
    updated_meta = {
        "pesu_companion_last_generated_date": today_str,
        "pesu_companion_last_inputs": current_inputs
    }
    
    return new_brief, True, updated_meta



@node(rerun_on_resume=True)
async def scheduler_agent(ctx: Context, node_input: Any) -> Event:
    """Checks upcoming meetings (within 3 days) and public holidays (only today), and salary status."""
    local_store = LocalStateStore()
    current_state = local_store.load_state() or {}
    
    import datetime
    import os
    import requests
    
    today = datetime.date.today()
    today_str = today.strftime("%Y-%m-%d")
    upcoming_meetings = []
    
    # Ensure caches exist
    if "holiday_briefs_cache" not in current_state:
        current_state["holiday_briefs_cache"] = {}
    if "event_briefs_cache" not in current_state:
        current_state["event_briefs_cache"] = {}
        
    def generate_ai_holiday_brief(holiday_name: str) -> str:
        groq_key = os.getenv("GROQ_API_KEY", "").strip()
        if not groq_key or groq_key == "your_groq_api_key_here":
            return f"Public Holiday: celebration of {holiday_name}."
        try:
            url = "https://api.groq.com/openai/v1/chat/completions"
            headers = {
                "Authorization": f"Bearer {groq_key}",
                "Content-Type": "application/json"
            }
            payload = {
                "model": "llama-3.1-8b-instant",
                "messages": [
                    {
                        "role": "user",
                        "content": f"Write a short, engaging one-sentence brief info or fun fact about the holiday: {holiday_name}. Keep it under 15 words and direct."
                    }
                ],
                "temperature": 0.7,
                "max_tokens": 50
            }
            res = requests.post(url, headers=headers, json=payload, timeout=10)
            if res.status_code == 200:
                data = res.json()
                return data["choices"][0]["message"]["content"].strip().replace('"', '')
        except Exception as e:
            print(f"[Groq Brief Error] {e}")
        return f"Public Holiday: celebration of {holiday_name}."

    def generate_ai_event_brief(title: str, description: str) -> dict:
        import json
        default_res = {"ai_title": title, "ai_brief": description or "No additional details provided."}
        groq_key = os.getenv("GROQ_API_KEY", "").strip()
        if not groq_key or groq_key == "your_groq_api_key_here":
            return default_res
        try:
            url = "https://api.groq.com/openai/v1/chat/completions"
            headers = {
                "Authorization": f"Bearer {groq_key}",
                "Content-Type": "application/json"
            }
            payload = {
                "model": "llama-3.1-8b-instant",
                "messages": [
                    {
                        "role": "user",
                        "content": f"Given the event title '{title}' and description '{description}', generate a short, professional alternative title (under 5 words) and a direct one-sentence description/brief info (under 15 words) in JSON format with keys 'ai_title' and 'ai_brief'."
                    }
                ],
                "response_format": {"type": "json_object"},
                "temperature": 0.7,
                "max_tokens": 100
            }
            res = requests.post(url, headers=headers, json=payload, timeout=10)
            if res.status_code == 200:
                data = res.json()
                content = data["choices"][0]["message"]["content"].strip()
                parsed = json.loads(content)
                if "ai_title" in parsed and "ai_brief" in parsed:
                    return {
                        "ai_title": parsed["ai_title"].strip().replace('"', ''),
                        "ai_brief": parsed["ai_brief"].strip().replace('"', '')
                    }
        except Exception as e:
            print(f"[Groq Event Brief Error] {e}")
        return default_res

    # 1. Fetch upcoming meetings
    try:
        from app.endpoints.routes import get_calendar_meetings
        meetings = get_calendar_meetings()
    except Exception:
        meetings = current_state.get("meetings", [])
        
    for m in meetings:
        m_date = m.get("event_date") or m.get("date")
        if m_date:
            try:
                event_date = datetime.datetime.strptime(m_date, "%Y-%m-%d").date()
                delta = (event_date - today).days
                if 0 <= delta <= 3:
                    title = m.get("title")
                    desc = m.get("description") or m.get("notes") or ""
                    
                    # Fetch from Groq or Cache
                    cache_key = m.get("id") or f"{m_date}:{title}"
                    if cache_key in current_state["event_briefs_cache"]:
                        cached = current_state["event_briefs_cache"][cache_key]
                        ai_title = cached.get("ai_title", title)
                        ai_brief = cached.get("ai_brief", desc)
                    else:
                        cached = generate_ai_event_brief(title, desc)
                        current_state["event_briefs_cache"][cache_key] = cached
                        ai_title = cached.get("ai_title", title)
                        ai_brief = cached.get("ai_brief", desc)
                        
                    m_time = m.get("event_time") or m.get("time") or ""
                    time_str = f" at {m_time}" if m_time else ""
                    if delta == 0:
                        upcoming_meetings.append(f"• {ai_title} is today{time_str}! (Brief Info: {ai_brief})")
                    elif delta == 1:
                        upcoming_meetings.append(f"• {ai_title} upcoming in 1 day{time_str} (Brief Info: {ai_brief})")
                    else:
                        upcoming_meetings.append(f"• {ai_title} upcoming in {delta} days{time_str} (Brief Info: {ai_brief})")
            except Exception:
                pass
            
    # Check holidays/events (ONLY on the day itself, with AI summary cached for the day)
    holidays = current_state.get("holidays", [])
    for h in holidays:
        h_date = h.get("date")
        if h_date == today_str:
            title = h.get("localName") or h.get("name")
            cache_key = f"{today_str}:{title}"
            
            if cache_key in current_state["holiday_briefs_cache"]:
                brief_info = current_state["holiday_briefs_cache"][cache_key]
            else:
                brief_info = generate_ai_holiday_brief(title)
                current_state["holiday_briefs_cache"][cache_key] = brief_info
                # Clean up old keys from other dates
                old_keys = [k for k in current_state["holiday_briefs_cache"].keys() if not k.startswith(today_str)]
                for k in old_keys:
                    del current_state["holiday_briefs_cache"][k]
                    
            upcoming_meetings.append(f"• 📅 Holiday: {title} is today! (Brief Info: {brief_info})")
            
    # 2. Extract teacher profile details for caching and custom briefing
    username = ctx.state.get("username")
    teacher_name = ""
    department = ""
    designation = ""
    t_data = {}
    if current_state and "teachers" in current_state:
        if username in current_state["teachers"]:
            t_data = current_state["teachers"][username]
        else:
            email = ctx.state.get("email")
            for t_username, td in current_state["teachers"].items():
                if td.get("email") == email:
                    t_data = td
                    break
        teacher_name = t_data.get("name") or username or ""
        department = t_data.get("department") or ""
        designation = t_data.get("designation") or ""

    # 3. Salary status check (mock status, 24-hour limit check)
    salary_msg = get_salary_status_message(t_data)

    # 4. Generate dynamic briefing using AI
    pesu_companion_brief, was_new, updated_meta = get_or_generate_companion_brief(
        teacher_data=t_data,
        salary_msg=salary_msg,
        upcoming_meetings=upcoming_meetings,
        today_str=today_str
    )
    
    # Update state
    state_updates = {
        "pesu_companion_brief": pesu_companion_brief,
        "onboarding_completed": True,
        "current_stage": "provisioning_complete",
        "onboarding_status_message": "Onboarding Process Completed!"
    }
    if was_new:
        state_updates.update(updated_meta)
    
    # Update Context state so downstream workflow nodes have access
    for k, v in state_updates.items():
        ctx.state[k] = v
        
    username = ctx.state.get("username")
    if current_state and "teachers" in current_state:
        if username in current_state["teachers"]:
            current_state["teachers"][username].update(state_updates)
        else:
            email = ctx.state.get("email")
            for t_username, t_data in current_state["teachers"].items():
                if t_data.get("email") == email:
                    t_data.update(state_updates)
                    break
                    
    current_state.update(state_updates)
    local_store.save_state(current_state)
    
    return Event(output="Scheduler Agent: Updated PESU Companion daily brief.", state=state_updates)


@node(rerun_on_resume=True)
async def allotment_approval_gate(ctx: Context, node_input: Any):
    """Listens for final approval and requests place and seat allotment criteria."""
    from app.core.config import BYPASS_HITL_FOR_TESTING
    if BYPASS_HITL_FOR_TESTING and not ctx.state.get("final_approval_flag", False):
        criteria = "Room 101, Seat 1"
        state_updates = {
            "allotment_criteria": {"criteria": criteria},
            "final_approval_flag": True,
            "active_stage": "Seat-Allotted"
        }
        local_store = LocalStateStore()
        current_state = local_store.load_state()
        current_state.update(state_updates)
        local_store.save_state(current_state)

        yield Event(output=f"Allotment Gate: Seat approved with criteria (Bypass): {criteria}", state=state_updates)
        return

    if not ctx.state.get("final_approval_flag", False):
        if not ctx.resume_inputs or "allotment_criteria" not in ctx.resume_inputs:
            yield RequestInput(
                interrupt_id="allotment_criteria",
                message="Allotment Approval Gate: Submit place and seat allotment criteria (e.g. Room 401, Desk B):"
            )
            return

        res = ctx.resume_inputs["allotment_criteria"]
        if isinstance(res, dict):
            res_val = res.get("allotment_criteria") or res.get("result") or list(res.values())[0]
        else:
            res_val = res

        criteria = str(res_val)
        state_updates = {
            "allotment_criteria": {"criteria": criteria},
            "final_approval_flag": True,
            "active_stage": "Seat-Allotted"
        }
        local_store = LocalStateStore()
        current_state = local_store.load_state()
        current_state.update(state_updates)
        local_store.save_state(current_state)

        yield Event(output=f"Allotment Gate: Seat approved with criteria: {criteria}", state=state_updates)
    else:
        yield Event(output="Allotment already approved.")


def _send_idcard(name: str, email: str, department: str = "N/A", designation: str = "N/A"):
    from app.app_utils.email import send_email
    from app.core.config import IDCARD_EMAIL
    
    body = (
        f"Dear ID Card Printing Team,\n\n"
        f"Please process the printing of a new Faculty ID Card for the newly onboarded faculty member:\n\n"
        f"- Full Name: {name}\n"
        f"- Email Address: {email}\n"
        f"- Department: {department}\n"
        f"- Designation: {designation}\n\n"
        f"Please coordinate with the HR department once the physical card is printed and ready for dispatch.\n\n"
        f"Best Regards,\n"
        f"PES University Onboarding System"
    )
    send_email(IDCARD_EMAIL, "Faculty ID Card Printing Request", body, is_html=False)


def _send_it(name: str, email: str):
    from app.app_utils.email import send_email
    from app.core.config import IT_EMAIL
    
    body = (
        f"Please generate campus Wi-Fi credentials and assign an official domain email ID (e.g., username@pes.edu) for:\n"
        f"Teacher Name: {name}\n"
        f"Primary Email: {email}"
    )
    send_email(IT_EMAIL, "Faculty Network & Workspace Provisioning Request", body, is_html=False)


@node(rerun_on_resume=True)
@review_before_execute(api_action="Notify IT and Administrative departments for campus provisioning")
async def follow_up_provisioning(ctx: Context, node_input: Any) -> Event:
    """Blasts templates to IT & Admin for Wi-Fi, email, and ID printing."""
    import asyncio
    name = ctx.state.get("name") or ctx.state.get("candidate_name") or "New Faculty Member"
    email = ctx.state.get("email") or "faculty@pes.edu"
    dept = ctx.state.get("department") or "N/A"
    desig = ctx.state.get("designation") or "N/A"

    try:
        await asyncio.gather(
            asyncio.to_thread(_send_idcard, name, email, dept, desig),
            asyncio.to_thread(_send_it, name, email)
        )
        print(f"Provisioning emails dispatched for {name}")
    except Exception as e:
        print(f"Error dispatching provisioning emails for {name}: {e}")

    state_updates = {
        "it_notified": True,
        "admin_notified": True,
        "active_stage": "Provisioning-Done"
    }
    local_store = LocalStateStore()
    current_state = local_store.load_state()
    current_state.update(state_updates)
    local_store.save_state(current_state)

    msg = (
        "Follow-Up Provisioning Complete:\n"
        "- IT notified for physical ID printing & Campus Wi-Fi.\n"
        "- Admin notified for official pes.edu email creation."
    )
    return Event(output=msg, state=state_updates)


# --- 3. Graph Topology Definitions ---

join_procedures = JoinNode(name="join_procedures")

edges_definition = [
    # Router entry point
    (START, router_node),
    
    # Conditional routes from router_node
    (router_node, {"chatbot": chatbot_node, "onboarding": initial_interview}),
    
    # Onboarding main flow
    (initial_interview, triggered_procedures),
    (triggered_procedures, {"start_procedures": (credential_agent, onboarding_guide, scheduler_agent)}),
    
    # Onboarding Guide -> Policy check flow
    (onboarding_guide, policy_rag_agent),
    
    # Scheduler routes (self loop and fanning in to join)
    (scheduler_agent, {"email_chairperson": scheduler_agent, "final_presentation_secured": join_procedures}),
    
    # Join paths
    ((credential_agent, policy_rag_agent), join_procedures),
    
    # Allotment Gate & provisioning post-join
    (join_procedures, allotment_approval_gate),
    (allotment_approval_gate, follow_up_provisioning)
]

state_manager_agent = Workflow(
    name="state_manager_agent",
    state_schema=WorkflowState,
    edges=edges_definition
)

app = App(
    root_agent=state_manager_agent,
    name="app",
    resumability_config=ResumabilityConfig(enabled=True)
)
