from fastapi import APIRouter, HTTPException, BackgroundTasks, UploadFile, File, Form
from pydantic import BaseModel
from typing import Any, Dict, Optional, List
import json
import os
import datetime
import secrets
from app.core.privacy import DataMaskingMiddleware
from app.core.local_storage import LocalStateStore


router = APIRouter()

class ChatRequest(BaseModel):
    message: str

class ActionRequest(BaseModel):
    action: str  # e.g., "approve_interview", "upload_documents", "schedule", "allotment", "provision"
    payload: Optional[Any] = None

@router.get("/health")
def health_check() -> dict:
    """Production health check endpoint for Render service verification."""
    return {"status": "healthy"}

@router.post("/webhook/upload")
def webhook_upload(payload: dict) -> dict:
    """Webhook endpoint to handle incoming file metadata with strict PII scrubbing."""
    scrubbed = DataMaskingMiddleware.redact_pii(payload)
    return {
        "status": "processed",
        "details": "Payload successfully scrubbed & queued.",
        "payload": scrubbed
    }

@router.post("/api/upload")
async def upload_document_endpoint(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    doc_type: str = Form(...),
    username: str = Form(...)
) -> dict:
    from supabase import create_client
    supabase_url = os.getenv("SUPABASE_URL", "").strip()
    supabase_key = os.getenv("SUPABASE_KEY", "").strip()
    
    if not supabase_url or not supabase_key:
        static_dir = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "static")
        user_dir = os.path.join(static_dir, "uploads", username)
        os.makedirs(user_dir, exist_ok=True)
        file_path = os.path.join(user_dir, f"{doc_type}.pdf")
        content = await file.read()
        with open(file_path, "wb") as f:
            f.write(content)
        file_url = f"/static/uploads/{username}/{doc_type}.pdf"
    else:
        try:
            client = create_client(supabase_url, supabase_key)
            file_bytes = await file.read()
            file_path = f"{username}/{doc_type}.pdf"
            
            res = client.storage.from_("documents").upload(
                path=file_path,
                file=file_bytes,
                file_options={"cache-control": "3600", "upsert": "true"}
            )
            file_url = client.storage.from_("documents").get_public_url(file_path)
        except Exception as e:
            write_log("UPLOAD_ERROR", f"Supabase storage upload failed: {str(e)}")
            raise HTTPException(status_code=500, detail=f"Supabase storage upload failed: {str(e)}")

    store = LocalStateStore()
    state = store.load_state()
    if not state or "teachers" not in state or username not in state["teachers"]:
        raise HTTPException(status_code=404, detail="Teacher not found.")

    from app.core.agent import WorkflowState
    teacher_data = state["teachers"][username]
    matching_fields = {k: v for k, v in teacher_data.items() if k in WorkflowState.model_fields}
    ws = WorkflowState(**matching_fields)
    
    if file.filename not in ws.documents:
        ws.documents.append(file.filename)
        
    ws.update_document_upload_path(doc_type, file_url)
    
    all_uploaded = all(status in ["pending", "approved"] for status in ws.document_statuses.values())
    if all_uploaded:
        ws.onboarding_status_message = "Pending verification by HR"
    else:
        ws.onboarding_status_message = "Please upload remaining documents in document upload tab"

    state["teachers"][username].update(ws.model_dump())
    write_log("CANDIDATE_PORTAL", f"Uploaded document: {file.filename} -> {file_url} for teacher {username}")
    store.save_state(state)
    
    return {"status": "success", "file_url": file_url}


@router.get("/api/state")
def get_state() -> dict:
    store = LocalStateStore()
    state = store.load_state()
    if not state or "teachers" not in state:
        state = initialize_default_state()
        store.save_state(state)
        return state

    modified = False
    for username, teacher in state.get("teachers", {}).items():
        if "document_statuses" not in teacher or not teacher["document_statuses"]:
            teacher["document_statuses"] = {
                "aadhaar_card": "unuploaded",
                "appointment_letter": "unuploaded",
                "teacher_eligibility_test": "unuploaded"
            }
            modified = True
            
        if "document_paths" not in teacher or not teacher["document_paths"]:
            teacher["document_paths"] = {
                "aadhaar_card": "",
                "appointment_letter": "",
                "teacher_eligibility_test": ""
            }
            modified = True

        if "employee_id" not in teacher:
            teacher["employee_id"] = ""
            modified = True

        if "onboarding_status_message" not in teacher:
            teacher["onboarding_status_message"] = "Please upload documents in document upload tab"
            modified = True

        verified = teacher.get("verified_documents", [])
        for doc_type in ["aadhaar_card", "appointment_letter", "teacher_eligibility_test"]:
            path = teacher.get("document_paths", {}).get(doc_type, "")
            if path:
                filename = path.split("/")[-1]
                if filename in verified:
                    teacher["document_statuses"][doc_type] = "approved"
                elif teacher["document_statuses"][doc_type] not in ["approved", "rejected"]:
                    teacher["document_statuses"][doc_type] = "pending"
                modified = True

    if modified:
        store.save_state(state)

    return state

def initialize_default_state() -> dict:
    return {
        "announcements": [
            {
                "id": 1,
                "title": "MedInnTech Minor Degree Program",
                "content": "Minor Degree in MedInnTech commences Monday, 6th July 2026. 22 Credits, 11 Courses, 5 Terms.",
                "date": "2026-07-01",
                "sender": "Chairperson"
            },
            {
                "id": 2,
                "title": "Ph.D Course Work Exam August 2026",
                "content": "Exam August 2026 Notification with Application form available in departments.",
                "date": "2026-07-01",
                "sender": "Admin"
            },
            {
                "id": 3,
                "title": "ESA June - July 2026 Backlog Room Allotment",
                "content": "Backlog Room Allotment Session-1 published for all undergraduate classes.",
                "date": "2026-07-02",
                "sender": "Admin"
            }
        ],
        "teachers": {
            "teacher": {
                "name": "Dr. Jane Doe",
                "email": "jane.doe@pes.edu",
                "department": "Computer Science & Engineering",
                "designation": "Professor",
                "username": "teacher",
                "password": "password",
                "seating_info": "Room 405, Desk C",
                "attendance": [
                    {"date": "2026-06-15", "status": "Absent", "reason": "Sick Leave"},
                    {"date": "2026-06-28", "status": "Absent", "reason": "Casual Leave"}
                ],
                "documents": ["PhD_Cert.pdf", "Joining_Letter.pdf"],
                "projects": [],
                "schedule": [
                    {"day": "Monday", "time": "09:00 AM - 10:30 AM", "class": "CSE-A", "subject": "Advanced Algorithms"},
                    {"day": "Wednesday", "time": "11:00 AM - 12:30 PM", "class": "CSE-B", "subject": "Machine Learning"},
                    {"day": "Friday", "time": "02:00 PM - 03:30 PM", "class": "CSE-A", "subject": "Advanced Algorithms"}
                ],
                "policy_brief": "[Pinecone Search @ production] RETRIEVED RULES CONTEXT:\n- Joining guidelines: Submit original verification documents within 30 days.\n- Campus ethics: Absolute professionalism in research and teaching duties.",
                "leave_balance": 28,
                "onboarding_status_message": "Please upload documents in document upload tab"
            }
        }
    }

@router.post("/api/state/reset")
def reset_state() -> dict:
    store = LocalStateStore()
    state = initialize_default_state()
    store.save_state(state)
    write_log("SYSTEM", "State reset to default mock values.")
    return state

def refine_query_with_gemini(user_input: str) -> str:
    from dotenv import load_dotenv
    load_dotenv(override=True)
    api_key = os.getenv("GEMINI_API_KEY", "").strip()
    if not api_key:
        return user_input

    refiner_prompt = (
        "You are an expert Query Refiner for the PESU HR & Policy RAG system.\n"
        "Your goal is to transform vague or conversational user questions into precise search queries that will maximize the retrieval of accurate policy information from our Pinecone database.\n\n"
        "### Guidelines for Refinement:\n"
        "1. Identify the core intent of the user's question (e.g., if they ask \"What leaves can I take?\", map this to keywords like \"Leave types\", \"Privilege Leave\", \"Sick Leave\", \"Policy\").\n"
        "2. Do not answer the question; only rewrite it to be optimal for vector search.\n"
        "3. If the user uses colloquial language, translate it into standard HR/Institutional terminology.\n"
        "4. If the query is already precise, keep it as is.\n\n"
        "### Examples:\n"
        "- Input: \"tell me about the types of leaves available in pesu\"\n"
        "- Refined Query: \"What are the different types of leaves, including Privilege Leave, available under PESU HR policy?\"\n\n"
        "- Input: \"how do I get leave for vacation?\"\n"
        "- Refined Query: \"What is the procedure and approval process for availing Privilege Leave at PESU?\"\n\n"
        f"User Input: \"{user_input}\"\n"
        "Refined Query:"
    )

    try:
        import requests
        url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent?key={api_key}"
        headers = {"Content-Type": "application/json"}
        data = {
            "contents": [{"parts": [{"text": refiner_prompt}]}]
        }
        response = requests.post(url, headers=headers, json=data, timeout=60.0)
        if response.status_code == 200:
            res_json = response.json()
            refined = res_json["candidates"][0]["content"]["parts"][0]["text"].strip()
            if refined.startswith('"') and refined.endswith('"'):
                refined = refined[1:-1].strip()
            write_log("QUERY_REFINER", f"Refined '{user_input}' -> '{refined}'")
            return refined
    except Exception as e:
        write_log("QUERY_REFINER_ERROR", f"Failed to refine query: {str(e)}")

    return user_input

@router.post("/api/chat")
def chatbot_endpoint(req: ChatRequest) -> dict:
    clean_input = DataMaskingMiddleware.redact_pii(req.message)
    write_log("CHATBOT_AGENT", f"Received message: '{clean_input}'")
    
    if req.message == "load_basic_policies_rag":
        # Force a dedicated lookup on core university policies
        from app.tools.pinecone_rag import PineconeRAGService
        pinecone_service = PineconeRAGService()
        rules_context = pinecone_service.query_rules("core university guidelines, employee ethics, campus policies, faculty code of conduct")
        
        from dotenv import load_dotenv
        load_dotenv(override=True)
        api_key = os.getenv("GEMINI_API_KEY", "").strip()
        
        prompt = (
            f"You are a helpful PESU AI. Please synthesize the following retrieved university policies, faculty code of conduct, and employee guidelines into a welcoming, easy-to-digest executive brief for a newly onboarded teacher. Start with a warm welcome statement, highlight the core values, working expectations, and code of conduct. Keep it structured with bullet points. Make sure to use relevant emojis where appropriate to make the response engaging and friendly.\n\n"
            f"Retrieved Policies:\n{rules_context}\n\n"
            f"Executive Brief:"
        )
    else:
        # 1. Refine query before calling Pinecone RAG search
        refined_query = refine_query_with_gemini(clean_input)
        
        # 2. Query Pinecone database to get context
        from app.tools.pinecone_rag import PineconeRAGService
        pinecone_service = PineconeRAGService()
        rules_context = pinecone_service.query_rules(refined_query)
        
        # 2. Call Gemini model using API Key
        from dotenv import load_dotenv
        load_dotenv(override=True)
        api_key = os.getenv("GEMINI_API_KEY", "").strip()
        
        prompt = (
            f"You are a helpful PESU AI. Use the following Pinecone RAG context to answer the user's query.\n"
            f"Make sure to use relevant emojis where appropriate in your response to make it engaging and friendly.\n"
            f"If you answer using the retrieved context guidelines, always append '[Source: Pinecone Database]' to make it clear that the response refers to retrieved records.\n"
            f"If the context does not contain enough info to answer the query, reply to the best of your knowledge, specify that it is general info, and do not append the citation.\n\n"
            f"Context:\n{rules_context}\n\n"
            f"User Query: {clean_input}\n\n"
            f"Response:"
        )
    
    answer = None
    if api_key:
        try:
            import requests
            url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent?key={api_key}"
            headers = {"Content-Type": "application/json"}
            data = {
                "contents": [{"parts": [{"text": prompt}]}]
            }
            import time
            retries = 3
            backoff = 0.5
            for attempt in range(retries):
                response = requests.post(url, headers=headers, json=data, timeout=60.0)
                if response.status_code == 200:
                    res_json = response.json()
                    answer = res_json["candidates"][0]["content"]["parts"][0]["text"]
                    break
                elif response.status_code == 503 and attempt < retries - 1:
                    time.sleep(backoff)
                    backoff *= 2
                else:
                    write_log("CHATBOT_ERROR", f"Gemini API returned status code {response.status_code}: {response.text}")
                    break
        except Exception as e:
            write_log("CHATBOT_ERROR", f"Failed to contact Gemini API: {str(e)}")

    if not answer:
        # Fallback if Gemini key is invalid/missing or API request failed/timed out
        answer = f"[RAG Rules Context] Retrieved Rules:\n{rules_context}\n\n(Please check that GEMINI_API_KEY in .env is valid)"
    
    return {"response": answer}

def send_welcome_email_task(email: str, username: str, name: str, password: str):
    from app.app_utils.email import send_email
    import logging

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
    send_email(email, "Welcome to PES University - Portal Credentials", html_content, is_html=True)


def send_verification_email_task(email: str, name: str):
    from app.app_utils.email import send_email
    import logging

    logging.info(f"Preparing to send verification confirmation email to {email}")

    html_content = f"""<!DOCTYPE html>
<html>
<head>
    <style>
        body {{ font-family: 'Inter', sans-serif; background-color: #0d1117; color: #c9d1d9; margin: 0; padding: 20px; }}
        .card {{ background: rgba(255, 255, 255, 0.05); border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 12px; padding: 30px; max-width: 600px; margin: auto; box-shadow: 0 8px 32px 0 rgba(0, 0, 0, 0.37); }}
        h2 {{ color: #58a6ff; margin-top: 0; }}
        p {{ line-height: 1.6; }}
        .footer {{ font-size: 0.8em; color: #8b949e; text-align: center; margin-top: 30px; }}
    </style>
</head>
<body>
    <div class="card">
        <h2>Documents Verified - PES University</h2>
        <p>Dear Faculty Member,</p>
        <p>We are pleased to inform you that all your submitted verification documents (Aadhaar Card, Appointment Letter, and Teacher Eligibility Test) have been successfully verified by our HR department.</p>
        <p>You need to log in to the <a href="https://technova-gt7e.onrender.com" style="color: #58a6ff;">PESU Academic portal</a> and check the <strong>PESU AI</strong> chatbot for a detailed brief on college policies.</p>
        <p>Best Regards,<br>HR Department<br>PES University</p>
        <div class="footer">
            This is an automated onboarding email. Please do not reply directly.
        </div>
    </div>
</body>
</html>
"""
    send_email(email, "Documents Verified - PES University Onboarding", html_content, is_html=True)


def send_chairperson_email_task(teacher_email: str, teacher_name: str):
    from app.app_utils.email import send_email
    from app.core.config import CHAIRPERSON_EMAIL
    import logging

    logging.info(f"Preparing to send chairperson email for {teacher_name}")
    body = f"""Dear Chairperson,

An interview appointment request has been made for a new faculty member's onboarding.

Faculty Name: {teacher_name}
Email Address: {teacher_email}

Please schedule a suitable interview slot.

Best Regards,
PES University Onboarding System"""
    send_email(CHAIRPERSON_EMAIL, "Interview Appointment Request: New Faculty Onboarding", body, is_html=False)


def send_provisioning_emails_task(email: str, name: str, department: str = "N/A", designation: str = "N/A"):
    from app.app_utils.email import send_email
    from app.core.config import IDCARD_EMAIL, IT_EMAIL
    import logging

    logging.info(f"Preparing to send provisioning emails for {name}")
    try:
        # 1. ID Card Printing Email
        body_id = (
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
        send_email(IDCARD_EMAIL, "Faculty ID Card Printing Request", body_id, is_html=False)
        
        # 2. IT Department Email
        body_it = (
            f"Please generate campus Wi-Fi credentials and assign an official domain email ID (e.g., username@pes.edu) for:\n"
            f"Teacher Name: {name}\n"
            f"Primary Email: {email}"
        )
        send_email(IT_EMAIL, "Faculty Network & Workspace Provisioning Request", body_it, is_html=False)
        
        print(f"Provisioning emails dispatched for {name}")
    except Exception as e:
        logging.error(f"Failed to send provisioning emails for {name}: {e}")


@router.post("/api/action")
def trigger_action(req: ActionRequest, background_tasks: BackgroundTasks) -> dict:
    store = LocalStateStore()
    state = store.load_state()
    if not state or "teachers" not in state:
        state = initialize_default_state()

    action = req.action
    payload = req.payload

    if action == "add_teacher":
        email = payload.get("email")
        if not email:
            raise HTTPException(status_code=400, detail="Email is required.")
        username = email
        if username in state["teachers"]:
            raise HTTPException(status_code=400, detail="Teacher with this email already exists.")
        
        name = payload.get("name")
        password = secrets.token_urlsafe(10)

        state["teachers"][username] = {
            "name": name,
            "email": email,
            "department": payload.get("department", "CSE"),
            "designation": payload.get("designation", "Assistant Professor"),
            "username": username,
            "password": password,
            "employee_id": payload.get("employee_id", ""),
            "seating_info": "Not Allotted",
            "attendance": [
                {"date": "2026-06-10", "status": "Absent", "reason": "Personal Leave"},
                {"date": "2026-06-20", "status": "Absent", "reason": "Medical Leave"}
            ],
            "documents": [],
            "projects": [],
            "schedule": [
                {"day": "Tuesday", "time": "10:00 AM - 11:30 AM", "class": "CSE-C", "subject": "Database Systems"},
                {"day": "Thursday", "time": "02:00 PM - 03:30 PM", "class": "CSE-C", "subject": "Database Systems"}
            ],
            "policy_brief": "Pending document upload and policy checker run.",
            "leave_balance": 30,
            "onboarding_status_message": "Please upload documents in document upload tab"
        }
        write_log("HR_AGENT", f"New teacher profile created: {username} ({name})")
        background_tasks.add_task(send_welcome_email_task, email=email, username=username, name=name, password=password)

    elif action == "update_teacher":
        username = payload.get("username")
        if username not in state["teachers"]:
            raise HTTPException(status_code=404, detail="Teacher not found.")
        
        state["teachers"][username].update({
            "name": payload.get("name"),
            "email": payload.get("email"),
            "department": payload.get("department"),
            "designation": payload.get("designation"),
            "employee_id": payload.get("employee_id", "")
        })
        write_log("HR_AGENT", f"Updated profile details for teacher: {username}")

    elif action == "delete_teacher":
        username = payload.get("username")
        if username not in state["teachers"]:
            raise HTTPException(status_code=404, detail="Teacher not found.")
        del state["teachers"][username]
        write_log("HR_AGENT", f"Deleted teacher profile: {username}")

    elif action == "allot_seat":
        username = payload.get("username")
        seating = payload.get("seating_info")
        if username not in state["teachers"]:
            raise HTTPException(status_code=404, detail="Teacher not found.")
        
        state["teachers"][username]["seating_info"] = seating
        write_log("CHAIRPERSON_AGENT", f"Allotted seating '{seating}' for teacher {username}.")

    elif action == "add_announcement":
        announcement_id = len(state.get("announcements", [])) + 1
        new_ann = {
            "id": announcement_id,
            "title": payload.get("title"),
            "content": payload.get("content"),
            "date": datetime.datetime.now().strftime("%Y-%m-%d"),
            "sender": payload.get("sender", "Admin")
        }
        state["announcements"].append(new_ann)
        write_log("ADMIN_AGENT", f"New announcement published: '{payload.get('title')}'")

    elif action == "upload_document":
        username = payload.get("username")
        doc_name = payload.get("document_name")
        doc_type = payload.get("doc_type", "aadhaar_card")
        if username not in state["teachers"]:
            raise HTTPException(status_code=404, detail="Teacher not found.")
        
        from app.core.agent import WorkflowState
        teacher_data = state["teachers"][username]
        matching_fields = {k: v for k, v in teacher_data.items() if k in WorkflowState.model_fields}
        ws = WorkflowState(**matching_fields)
        
        if doc_name not in ws.documents:
            ws.documents.append(doc_name)
            
        ws.update_document_upload_path(doc_type, doc_name)
        
        # Update status message based on whether all documents have been uploaded
        all_uploaded = all(status in ["pending", "approved"] for status in ws.document_statuses.values())
        if all_uploaded:
            ws.onboarding_status_message = "Pending verification by HR"
        else:
            ws.onboarding_status_message = "Please upload remaining documents in document upload tab"

        state["teachers"][username].update(ws.model_dump())
        write_log("CANDIDATE_PORTAL", f"Uploaded document: {doc_name} for teacher {username}")

    elif action == "verify_document":
        username = payload.get("username")
        doc_name = payload.get("document_name")
        doc_type = payload.get("doc_type", "aadhaar_card")
        approved = payload.get("approved", True)
        if username not in state["teachers"]:
            raise HTTPException(status_code=404, detail="Teacher not found.")
        
        from app.core.agent import WorkflowState
        teacher_data = state["teachers"][username]
        matching_fields = {k: v for k, v in teacher_data.items() if k in WorkflowState.model_fields}
        ws = WorkflowState(**matching_fields)
        
        ws.evaluate_document_approval(doc_type, approved)
        
        if "verified_documents" not in state["teachers"][username]:
            state["teachers"][username]["verified_documents"] = []
            
        if approved:
            if doc_name not in state["teachers"][username]["verified_documents"]:
                state["teachers"][username]["verified_documents"].append(doc_name)
        else:
            if doc_name in state["teachers"][username]["verified_documents"]:
                state["teachers"][username]["verified_documents"].remove(doc_name)
            if doc_name in ws.documents:
                ws.documents.remove(doc_name)
            ws.document_statuses[doc_type] = "rejected"
            ws.onboarding_status_message = "Rejected by HR, please upload again"

        if ws.current_stage == "policy_review":
            ws.onboarding_status_message = "Verified by HR, details forwarded for teacher onboarding"
            if not ws.chairperson_notified:
                email = state["teachers"][username].get("email")
                name = state["teachers"][username].get("name", "Faculty Member")
                if email:
                    background_tasks.add_task(send_chairperson_email_task, teacher_email=email, teacher_name=name)
                ws.chairperson_notified = True
            
            if not ws.it_notified and not ws.admin_notified:
                email = state["teachers"][username].get("email")
                name = state["teachers"][username].get("name", "Faculty Member")
                dept = state["teachers"][username].get("department", "N/A")
                desig = state["teachers"][username].get("designation", "N/A")
                if email:
                    background_tasks.add_task(
                        send_provisioning_emails_task,
                        email=email,
                        name=name,
                        department=dept,
                        designation=desig
                    )
                ws.it_notified = True
                ws.admin_notified = True
            
        state["teachers"][username].update(ws.model_dump())
        write_log("HR_PORTAL", f"Evaluated document '{doc_name}' for teacher {username}: approved={approved}")

        if ws.current_stage == "policy_review":
            email = state["teachers"][username].get("email")
            name = state["teachers"][username].get("name", "Faculty Member")
            if email:
                background_tasks.add_task(send_verification_email_task, email=email, name=name)

    else:
        raise HTTPException(status_code=400, detail="Invalid action")

    store.save_state(state)
    return {"status": "success", "state": state}

@router.get("/api/logs")
def get_logs() -> List[dict]:
    log_file = "agent_activity.log"
    if not os.path.exists(log_file):
        return []
    try:
        with open(log_file, "r") as f:
            lines = f.readlines()
        return [json.loads(line) for line in lines[-50:]]
    except Exception:
        return []

def write_log(agent: str, message: str):
    log_file = "agent_activity.log"
    log_entry = {
        "timestamp": datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "agent": agent,
        "message": message
    }
    try:
        with open(log_file, "a") as f:
            f.write(json.dumps(log_entry) + "\n")
    except Exception:
        pass


