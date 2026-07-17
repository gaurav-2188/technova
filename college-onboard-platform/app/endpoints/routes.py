from fastapi import APIRouter, HTTPException, BackgroundTasks, UploadFile, File, Form
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from typing import Any, Dict, Optional, List
import json
import os
import datetime
import secrets
import re
from app.core.privacy import DataMaskingMiddleware
from app.core.local_storage import LocalStateStore


router = APIRouter()

def clean_and_capitalize_name(name: str) -> str:
    if not name:
        return ""
    name_clean = name.replace(".", " ")
    name_clean = re.sub(r'\s+', ' ', name_clean).strip()
    words = name_clean.split(" ")
    capitalized_words = [w.capitalize() for w in words if w]
    return " ".join(capitalized_words)

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
    uploaded_to_supabase = False
    file_url = ""
    if supabase_url and supabase_key:
        try:
            client = create_client(supabase_url, supabase_key)
            file_bytes = await file.read()
            file_path = f"{username}/{doc_type}.pdf"
            
            res = client.storage.from_("documents").upload(
                path=file_path,
                file=file_bytes,
                file_options={"cache-control": "3600", "upsert": "true", "content-type": "application/pdf"}
            )
            file_url = client.storage.from_("documents").get_public_url(file_path)
            uploaded_to_supabase = True
        except Exception as e:
            write_log("UPLOAD_WARNING", f"Supabase storage upload failed: {str(e)}. Falling back to local storage.")
            try:
                await file.seek(0)
            except Exception:
                pass
            
    if not uploaded_to_supabase:
        static_dir = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "static")
        user_dir = os.path.join(static_dir, "uploads", username)
        os.makedirs(user_dir, exist_ok=True)
        file_path = os.path.join(user_dir, f"{doc_type}.pdf")
        content = await file.read()
        with open(file_path, "wb") as f:
            f.write(content)
        file_url = f"/static/uploads/{username}/{doc_type}.pdf"

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


@router.post("/api/profile-photo/upload")
async def upload_profile_photo_endpoint(
    file: UploadFile = File(...),
    username: str = Form(...)
) -> dict:
    from supabase import create_client
    supabase_url = os.getenv("SUPABASE_URL", "").strip()
    supabase_key = os.getenv("SUPABASE_KEY", "").strip()
    uploaded_to_supabase = False
    file_url = ""
    
    _, ext = os.path.splitext(file.filename)
    if not ext:
        ext = ".jpg"
    
    if supabase_url and supabase_key:
        try:
            client = create_client(supabase_url, supabase_key)
            file_bytes = await file.read()
            file_path = f"{username}/profile_photo{ext}"
            
            import mimetypes
            content_type, _ = mimetypes.guess_type(file.filename)
            if not content_type:
                content_type = "image/jpeg"
                
            res = client.storage.from_("documents").upload(
                path=file_path,
                file=file_bytes,
                file_options={"cache-control": "3600", "upsert": "true", "content-type": content_type}
            )
            file_url = client.storage.from_("documents").get_public_url(file_path)
            uploaded_to_supabase = True
        except Exception as e:
            write_log("UPLOAD_WARNING", f"Supabase storage photo upload failed: {str(e)}. Falling back to local storage.")
            try:
                await file.seek(0)
            except Exception:
                pass
            
    if not uploaded_to_supabase:
        static_dir = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "static")
        user_dir = os.path.join(static_dir, "uploads", username)
        os.makedirs(user_dir, exist_ok=True)
        file_path = os.path.join(user_dir, f"profile_photo{ext}")
        content = await file.read()
        with open(file_path, "wb") as f:
            f.write(content)
        file_url = f"/static/uploads/{username}/profile_photo{ext}"

    store = LocalStateStore()
    state = store.load_state()
    if not state or "teachers" not in state or username not in state["teachers"]:
        raise HTTPException(status_code=404, detail="Teacher not found.")

    state["teachers"][username]["profile_photo_url"] = file_url
    write_log("CANDIDATE_PORTAL", f"Uploaded profile photo for teacher {username} -> {file_url}")
    store.save_state(state)
    
    return {"status": "success", "profile_photo_url": file_url}


@router.post("/api/projects/upload")
async def upload_project_endpoint(
    file: UploadFile = File(...),
    title: str = Form(...),
    username: str = Form(...)
) -> dict:
    from supabase import create_client
    supabase_url = os.getenv("SUPABASE_URL", "").strip()
    supabase_key = os.getenv("SUPABASE_KEY", "").strip()
    uploaded_to_supabase = False
    file_url = ""
    if supabase_url and supabase_key:
        try:
            client = create_client(supabase_url, supabase_key)
            file_bytes = await file.read()
            file_path = f"{username}/projects/{file.filename}"
            
            import mimetypes
            content_type, _ = mimetypes.guess_type(file.filename)
            if not content_type:
                content_type = "application/octet-stream"
            
            res = client.storage.from_("documents").upload(
                path=file_path,
                file=file_bytes,
                file_options={
                    "cache-control": "3600", 
                    "upsert": "true", 
                    "content-type": content_type
                }
            )
            file_url = client.storage.from_("documents").get_public_url(file_path)
            uploaded_to_supabase = True
        except Exception as e:
            write_log("UPLOAD_WARNING", f"Supabase storage project upload failed: {str(e)}. Falling back to local storage.")
            try:
                await file.seek(0)
            except Exception:
                pass
            
    if not uploaded_to_supabase:
        static_dir = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "static")
        user_dir = os.path.join(static_dir, "uploads", username, "projects")
        os.makedirs(user_dir, exist_ok=True)
        file_path = os.path.join(user_dir, file.filename)
        content = await file.read()
        with open(file_path, "wb") as f:
            f.write(content)
        file_url = f"/static/uploads/{username}/projects/{file.filename}"

    store = LocalStateStore()
    state = store.load_state()
    if not state or "teachers" not in state or username not in state["teachers"]:
        raise HTTPException(status_code=404, detail="Teacher not found.")

    teacher = state["teachers"][username]
    if "projects" not in teacher:
        teacher["projects"] = []
    
    new_project = {
        "title": title,
        "filename": file.filename,
        "file_url": file_url,
        "uploaded_at": datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    }
    
    teacher["projects"].append(new_project)
    write_log("CANDIDATE_PORTAL", f"Uploaded project: '{title}' ({file.filename}) for teacher {username}")
    store.save_state(state)
    
    return {"status": "success", "file_url": file_url}


def generate_ai_holiday_brief(holiday_name: str) -> str:
    """Generates a brief 1-sentence description/fun fact about a holiday/event using Groq API."""
    import os
    import requests
    
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


def run_scheduler_agent_brief(state: dict, username: str) -> str:
    """Checks upcoming meetings (within 3 days) and public holidays (only today), and salary status."""
    import datetime
    
    today = datetime.date.today()
    today_str = today.strftime("%Y-%m-%d")
    upcoming_meetings = []
    
    # Ensure cache exists
    if "holiday_briefs_cache" not in state:
        state["holiday_briefs_cache"] = {}
        
    # Helper to calculate delta and format message for meetings (3 days prior)
    def get_meeting_message(title: str, date_str: str, description: str = "") -> str or None:
        try:
            event_date = datetime.datetime.strptime(date_str, "%Y-%m-%d").date()
            delta = (event_date - today).days
            if 0 <= delta <= 3:
                if delta == 0:
                    desc_suffix = f" (Brief Info: {description})" if description else ""
                    return f"• {title} is today!{desc_suffix}"
                elif delta == 1:
                    return f"• {title} upcoming in 1 day"
                else:
                    return f"• {title} upcoming in {delta} days"
        except Exception:
            pass
        return None

    # Check standard meetings
    meetings = state.get("meetings", [])
    for m in meetings:
        m_date = m.get("event_date") or m.get("date")
        if m_date:
            title = m.get("title")
            desc = m.get("description") or m.get("notes") or ""
            msg = get_meeting_message(title, m_date, desc)
            if msg:
                upcoming_meetings.append(msg)
            
    # Check holidays/events (ONLY on the day itself, with AI summary cached for the day)
    holidays = state.get("holidays", [])
    for h in holidays:
        h_date = h.get("date")
        if h_date == today_str:
            title = h.get("localName") or h.get("name")
            cache_key = f"{today_str}:{title}"
            
            if cache_key in state["holiday_briefs_cache"]:
                brief_info = state["holiday_briefs_cache"][cache_key]
            else:
                brief_info = generate_ai_holiday_brief(title)
                state["holiday_briefs_cache"][cache_key] = brief_info
                # Clean up old keys from other dates
                old_keys = [k for k in state["holiday_briefs_cache"].keys() if not k.startswith(today_str)]
                for k in old_keys:
                    del state["holiday_briefs_cache"][k]
                    
            upcoming_meetings.append(f"• 📅 Holiday: {title} is today! (Brief Info: {brief_info})")
            
    # 2. Salary status check (mock status)
    salary_msg = "💰 Salary for the month has been credited."
    
    # Construct brief
    brief_parts = [salary_msg]
    if upcoming_meetings:
        brief_parts.append("\n📅 **Upcoming Meetings & Events (Next 3 Days):**")
        brief_parts.extend(upcoming_meetings)
    else:
        brief_parts.append("\n📅 No upcoming meetings or events in the next 3 days.")
        
    return "\n".join(brief_parts)


@router.get("/api/state")
def get_state() -> dict:
    store = LocalStateStore()
    state = store.load_state()
    if not state or "teachers" not in state:
        state = initialize_default_state()
        store.save_state(state)
        return state

    modified = False
    initial_cache_len = len(state.get("holiday_briefs_cache", {}))
    
    # Run the scheduler agent brief generation for daily-phase teachers
    for username, teacher in state.get("teachers", {}).items():
        if teacher.get("onboarding_completed"):
            old_brief = teacher.get("pesu_companion_brief", "")
            new_brief = run_scheduler_agent_brief(state, username)
            if old_brief != new_brief:
                teacher["pesu_companion_brief"] = new_brief
                modified = True
                
    if len(state.get("holiday_briefs_cache", {})) != initial_cache_len:
        modified = True
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
        url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key={api_key}"
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
async def chatbot_endpoint(req: ChatRequest):
    clean_input = DataMaskingMiddleware.redact_pii(req.message)
    write_log("CHATBOT_AGENT", f"Received message: '{clean_input}'")
    
    async def event_generator():
        if req.message == "load_basic_policies_rag":
            welcome_msg = (
                "✨Welcome to the PES University Family! ✨\n\n"
                "On behalf of the entire community, a warm and hearty welcome to PES University (PESU)! We are absolutely thrilled to have you join our esteemed faculty.\n\n"
                "At PESU, we believe that our teachers are the catalysts for transformation, innovation, and academic excellence. This executive brief is designed to help you seamlessly transition into your new role, understanding our shared values, operational expectations, and the world-class research ecosystem available at your fingertips.\n\n"
                "---\n\n"
                "### 🛡️ Our Core Values\n"
                "* **Academic Excellence & Integrity**: We uphold the highest academic standards and expect our faculty to foster an environment of honesty, curiosity, and intellectual rigor.\n"
                "* **Focus on Discovery**: We empower our scholars and educators to focus on high-quality discovery, innovative problem-solving, and impactful academic output.\n"
                "* **Collaboration & Connectivity**: We believe in breaking down silos. Our faculty members work collaboratively across departments and campuses to drive interdisciplinary success.\n\n"
                "---\n\n"
                "### 🏫 Working Expectations & Campus-Wide Support\n"
                "To help you balance teaching excellence with cutting-edge research, PESU provides comprehensive, coordinated support across our campuses:\n\n"
                "* **Dual-Campus Synergy** 📍: You have full access to research support, administrators, seminar updates, and networking initiatives across both the Ring Road (RR) Campus and the Electronic City (EC) Campus.\n"
                "* **Centralized Resource Hub** 📚: Easily access vital information through our centralized portals, including:\n"
                "  * Institutional Research Policies\n"
                "  * Funding and Grant Pathways\n"
                "  * Publication Support\n"
                "  * Patent-related Guidance and Filing Services\n"
                "* **Professional Development** 💡: Participate in regular seminars, workshops, and departmental exchange programs to continuously elevate your pedagogical and research skills.\n\n"
                "---\n\n"
                "### 🔬 Equipment Reservation & Research Code of Conduct\n"
                "PESU houses state-of-the-art research infrastructure. To ensure fair, safe, and efficient utilization of these resources, we ask all faculty members to adhere to the following guidelines:\n\n"
                "* **State-of-the-Art Instruments**: Access advanced testing and analysis equipment, such as the FTIR Spectrometer (Fourier Transform Infrared Spectroscopy) for material characterization, polymer analysis, and pharmaceutical research.\n"
                "* **Reservation Protocol** 📝:\n"
                "  1. Download the official booking form from the Scholar Services portal.\n"
                "  2. Fill in your research/class details.\n"
                "  3. Submit the form directly to the respective Facility Coordinator before usage.\n"
                "* **Lab Ethics & Safety** 🛡️: Please guide your students to treat all laboratories and instruments with care, strictly adhering to safety protocols and leaving workspaces clean for the next user.\n\n"
                "---\n\n"
                "### ⚙️ Complete Your Profile\n"
                "* **Setup Settings** ⚙️: Please navigate to the **Settings** tab to verify your information, fill in your employee details, and complete your profile setup.\n\n"
                "---\n\n"
                "### 📞 Need Assistance?\n"
                "We are here to support you every step of the way!\n"
                "* For curriculum and classroom support, please reach out to your Department Chairperson.\n"
                "* For research, patents, or equipment booking, connect directly with our Research Administrators on either campus.\n\n"
                "Once again, welcome aboard! We look forward to watching you inspire the next generation of leaders at PES University. Let’s create, discover, and excel together! 🚀🎓"
            )
            yield welcome_msg
        else:
            # 1. Skip synchronous refiner query to minimize latency
            refined_query = clean_input
            
            # 2. Query Pinecone database to get context
            from app.tools.pinecone_rag import PineconeRAGService
            pinecone_service = PineconeRAGService()
            rules_context = pinecone_service.query_rules(refined_query)
            
            # 3. Call Gemini model using API Key
            from dotenv import load_dotenv
            load_dotenv(override=True)
            api_key = os.getenv("GEMINI_API_KEY", "").strip()
            
            prompt = (
                f"You are a helpful PESU AI. You MUST prioritize using the following facts and context to answer the user's query.\n"
                f"Answer the query naturally, making it look like a general, direct answer from your own knowledge. Under no circumstances should you ever mention, hint at, or refer to 'the context', 'retrieved documents', 'the database', 'rules reference', or 'provided rules'. Act as if you naturally know these details.\n"
                f"Check the details carefully first. If and only if the requested information is not present in the context, you may provide a generalized answer based on your general knowledge. If the answer is found in the facts, restrict your response strictly to those details.\n"
                f"Be extremely precise about department names. If the user asks about the main 'Computer Science & Engineering' or 'CSE' department, do NOT provide information or chairpersons for related or specialized departments such as 'CSE (AIML)' or 'Computer Science & Engineering (AIML)', and vice-versa. Always match the exact department name.\n"
                f"If the user asks about a person, department head, or contact details:\n"
                f"- Provide their contact info ONLY if it is available in the retrieved facts or if you are 100% sure of it from your general knowledge.\n"
                f"- Under no circumstances should you ever make up, hallucinate, or use placeholder contact details (such as 'example@gmail.com', 'xyz@pes.edu', or placeholder phone numbers) if they are not in the context. If the contact details are not available, state clearly that you do not have their contact details.\n"
                f"Your answer must be direct, concise, and specifically address only what the user is asking. Do not summarize or list unrelated parts. For specific questions (e.g., 'what is the casual leave entitlement?'), provide a direct, concise answer (e.g., 'The casual leave entitlement is 12 days per year') without unnecessary lists, headers, or details.\n"
                f"When formatting larger or multi-part responses, make sure they are well-aligned and readable using proper spacing, newlines, bold text, or clean bullet points where appropriate.\n"
                f"Make sure to use relevant emojis where appropriate to make it engaging and friendly.\n\n"
                f"Context:\n{rules_context}\n\n"
                f"User Query: {clean_input}\n\n"
                f"Response:"
            )
            

            streamed_any = False
            try:
                import asyncio
                import httpx
                from dotenv import load_dotenv
                load_dotenv(override=True)
                groq_key = os.getenv("GROQ_API_KEY", "").strip()

                # Try Groq API first if configured
                if groq_key and groq_key != "your_groq_api_key_here":
                    write_log("CHATBOT_DEBUG", "GROQ_API_KEY detected. Using Groq API for chatbot endpoint.")
                    url = "https://api.groq.com/openai/v1/chat/completions"
                    headers = {
                        "Authorization": f"Bearer {groq_key}",
                        "Content-Type": "application/json"
                    }
                    data = {
                        "model": "llama-3.3-70b-versatile",
                        "messages": [
                            {"role": "user", "content": prompt}
                        ],
                        "stream": True
                    }
                    try:
                        async with httpx.AsyncClient(timeout=30.0) as client:
                            async with client.stream("POST", url, headers=headers, json=data) as response:
                                if response.status_code == 200:
                                    async for line in response.aiter_lines():
                                        if line:
                                            line_str = line.strip()
                                            if line_str.startswith("data: "):
                                                data_content = line_str[6:].strip()
                                                if data_content == "[DONE]":
                                                    break
                                                try:
                                                    chunk_json = json.loads(data_content)
                                                    delta = chunk_json["choices"][0]["delta"]
                                                    if "content" in delta:
                                                        text = delta["content"]
                                                        if text:
                                                            streamed_any = True
                                                            yield text
                                                except Exception:
                                                    pass
                                    if streamed_any:
                                        write_log("CHATBOT_DEBUG", "Groq stream finished successfully.")
                                else:
                                    err_content = await response.aread()
                                    write_log("CHATBOT_ERROR", f"Groq stream returned non-200: {response.status_code} - {err_content.decode('utf-8', errors='ignore')}")
                    except Exception as groq_err:
                        write_log("CHATBOT_ERROR", f"Groq API call failed: {str(groq_err)}")

                # Fallback to Gemini if Groq did not stream anything
                if not streamed_any:
                    api_key = os.getenv("GEMINI_API_KEY", "").strip()
                    # 1. Try Direct REST Streaming API (Highly robust for AQ. keys)
                    write_log("CHATBOT_DEBUG", f"api_key loaded: length={len(api_key)}, starts_with={api_key[:5] if api_key else 'None'}")
                    if api_key:
                        models_to_try = ['gemini-2.5-flash', 'gemini-flash-latest', 'gemini-flash-lite-latest', 'gemini-2.0-flash']
                        for model_name in models_to_try:
                            try:
                                url = f"https://generativelanguage.googleapis.com/v1beta/models/{model_name}:streamGenerateContent?key={api_key}"
                                headers = {"Content-Type": "application/json"}
                                data = {
                                    "contents": [{"parts": [{"text": prompt}]}]
                                }
                                write_log("CHATBOT_DEBUG", f"Attempting REST stream with model: {model_name}")
                                async with httpx.AsyncClient(timeout=30.0) as client:
                                    async with client.stream("POST", url, headers=headers, json=data) as response:
                                        write_log("CHATBOT_DEBUG", f"REST stream response status for {model_name}: {response.status_code}")
                                        if response.status_code == 200:
                                            async for line in response.aiter_lines():
                                                if line:
                                                    line_str = line.strip()
                                                    if line_str.startswith('['):
                                                        line_str = line_str[1:]
                                                    if line_str.startswith(','):
                                                        line_str = line_str[1:]
                                                    if line_str.endswith(']'):
                                                        line_str = line_str[:-1]
                                                    line_str = line_str.strip()
                                                    if not line_str:
                                                        continue
                                                    try:
                                                        chunk_json = json.loads(line_str)
                                                        text = chunk_json["candidates"][0]["content"]["parts"][0]["text"]
                                                        if text:
                                                            streamed_any = True
                                                            yield text
                                                    except Exception:
                                                        pass
                                            if streamed_any:
                                                break
                                        else:
                                            err_content = await response.aread()
                                            write_log("CHATBOT_ERROR", f"REST stream {model_name} returned non-200: {response.status_code} - {err_content.decode('utf-8', errors='ignore')}")
                            except Exception as rest_err:
                                write_log("CHATBOT_ERROR", f"REST stream {model_name} request failed: {str(rest_err)}.")
                            
                # 2. Try SDK Fallbacks if REST did not stream anything
                if not streamed_any:
                    from google import genai
                    try:
                        if api_key:
                            client = genai.Client(api_key=api_key)
                        else:
                            client = genai.Client()
                        response_stream = await client.aio.models.generate_content_stream(
                            model='gemini-2.5-flash',
                            contents=prompt
                        )
                        async for chunk in response_stream:
                            if chunk.text:
                                streamed_any = True
                                yield chunk.text
                    except Exception as sdk_err:
                        write_log("CHATBOT_ERROR", f"Standard GenAI SDK call failed: {str(sdk_err)}. Attempting Vertex AI fallback...")
                        client = genai.Client(vertexai=True)
                        response_stream = await client.aio.models.generate_content_stream(
                            model='gemini-2.5-flash',
                            contents=prompt
                        )
                        async for chunk in response_stream:
                            if chunk.text:
                                streamed_any = True
                                yield chunk.text
            except Exception as e:
                write_log("CHATBOT_ERROR", f"All Gemini calls failed: {str(e)}")
            
            if not streamed_any:
                import re
                cleaned_rules = rules_context
                cleaned_rules = re.sub(r'^\[Pinecone Index:[^\]]+\] RETRIEVED REAL-TIME RULES:\s*', '', cleaned_rules, flags=re.IGNORECASE)
                cleaned_rules = re.sub(r'^\[Pinecone Search \([^)]+\)\] RETRIEVED RULES CONTEXT:\s*', '', cleaned_rules, flags=re.IGNORECASE)
                cleaned_rules = re.sub(r'\[cite:?\s*\d*\]', '', cleaned_rules, flags=re.IGNORECASE)
                
                replacements = {
                    "Casual/SickLeave": "Casual / Sick Leave",
                    "PaternityLeave": "Paternity Leave",
                    "Maternity/Adoption": "Maternity / Adoption",
                    "BereavementLeave": "Bereavement Leave",
                    "PrivilegeLeave": "Privilege Leave",
                    "RelocationTransfer": "Relocation & Transfer",
                    "ofsick": "of sick",
                    "byyear-end": "by year-end",
                    "areexhausted": "are exhausted",
                    "accrualand": "accrual and",
                    "familymember": "family member",
                    "continuousleave": "continuous leave",
                    "orvacation": "or vacation",
                    "ofrelocation": "of relocation",
                    "Officialholidays": "Official holidays",
                    "Policy.Line": "Policy. Line",
                    "Policy.Entitlement": "Policy. Entitlement",
                    "Dept Head": "Department Head",
                    "member.Entitlement": "member. Entitlement",
                }
                
                for old, new in replacements.items():
                    cleaned_rules = cleaned_rules.replace(old, new)
                    
                # Extract search keywords from user query, removing common stop words
                stop_words = {"who", "is", "the", "of", "a", "an", "hey", "can", "you", "tell", "me", "what", "about", "for", "please", "help", "with", "query", "question", "info", "information", "detail", "details"}
                query_words = [w.lower().strip(",.?!()\"'") for w in clean_input.split()]
                keywords = [w for w in query_words if len(w) > 2 and w not in stop_words]

                lines = cleaned_rules.split('\n')
                formatted_sections = []
                
                for line in lines:
                    line = line.strip()
                    if not line:
                        continue
                    if line.startswith("- "):
                        line = line[2:].strip()
                    
                    sentences = re.split(r'\.\s+', line)
                    for s in sentences:
                        s_clean = s.strip()
                        if not s_clean:
                            continue
                        if not s_clean.endswith('.'):
                            s_clean += '.'
                            
                        # If query keywords exist, filter sentences to only those containing at least one keyword
                        if keywords:
                            has_match = False
                            for kw in keywords:
                                if kw in s_clean.lower():
                                    has_match = True
                                    break
                            if not has_match:
                                continue
                            
                        # Keywords to format as header
                        headers = [
                            "Casual / Sick Leave", "Paternity Leave", "Maternity / Adoption", 
                            "Bereavement Leave", "Privilege Leave", "Relocation & Transfer", 
                            "General Leave Policies", "Loss of Pay", "Leave Classification", 
                            "Public Holidays", "Leave Application", "Leave Donation", 
                            "Accumulated Earned"
                        ]
                        
                        if any(keyword.lower() in s_clean.lower() for keyword in headers):
                            formatted_sections.append(f"\n📋 **{s_clean}**")
                        elif "entitlement:" in s_clean.lower():
                            val = re.sub(r'^entitlement\s*:\s*', '', s_clean, flags=re.IGNORECASE)
                            formatted_sections.append(f"  * **Entitlement:** {val}")
                        elif any(auth.lower() in s_clean.lower() for auth in ["Line Manager", "Department Head", "HR"]):
                            formatted_sections.append(f"  * **Approvals:** {s_clean}")
                        else:
                            formatted_sections.append(f"  * {s_clean}")
                            
                result_text = "\n".join(formatted_sections)
                result_text = re.sub(r'\n+', '\n\n', result_text).strip()
                
                if result_text:
                    fallback_msg = (
                        "🤖 **Here is what I found in the PESU policy database:**\n\n"
                        f"{result_text}"
                    )
                else:
                    fallback_msg = "🤖 Sorry, I couldn't find any relevant rules or policies in the database for your query."
                
                import asyncio
                words = fallback_msg.split(' ')
                for i, word in enumerate(words):
                    if i > 0:
                        yield ' ' + word
                    else:
                        yield word
                    await asyncio.sleep(0.03)

    headers = {
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
        "X-Accel-Buffering": "no"
    }
    return StreamingResponse(event_generator(), media_type="text/event-stream", headers=headers)

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
        
        name = clean_and_capitalize_name(payload.get("name"))
        password = secrets.token_urlsafe(10)

        import time
        state["teachers"][username] = {
            "name": name,
            "email": email,
            "department": payload.get("department", "CSE"),
            "designation": payload.get("designation", "Assistant Professor"),
            "username": username,
            "password": password,
            "employee_id": payload.get("employee_id", ""),
            "created_at": payload.get("created_at") or int(time.time() * 1000),
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

    elif action == "change_password":
        username = payload.get("username")
        current_password = payload.get("current_password")
        new_password = payload.get("new_password")
        
        if username not in state["teachers"]:
            raise HTTPException(status_code=404, detail="Teacher not found.")
            
        teacher = state["teachers"][username]
        if teacher.get("password") != current_password:
            raise HTTPException(status_code=400, detail="Incorrect current password.")
            
        teacher["password"] = new_password
        write_log("CANDIDATE_PORTAL", f"Password changed successfully for user: {username}")

    elif action == "update_email":
        username = payload.get("username")
        new_email = payload.get("new_email")
        
        if username not in state["teachers"]:
            raise HTTPException(status_code=404, detail="Teacher not found.")
            
        teacher = state["teachers"][username]
        teacher["email"] = new_email
        write_log("CANDIDATE_PORTAL", f"Email updated successfully for user: {username} to {new_email}")

    elif action == "update_teacher":
        username = payload.get("username")
        if username not in state["teachers"]:
            raise HTTPException(status_code=404, detail="Teacher not found.")
        
        state["teachers"][username].update({
            "name": clean_and_capitalize_name(payload.get("name")),
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

    elif action == "complete_onboarding":
        username = payload.get("username")
        if username not in state["teachers"]:
            raise HTTPException(status_code=404, detail="Teacher not found.")
        state["teachers"][username]["onboarding_completed"] = True
        state["teachers"][username]["current_stage"] = "provisioning_complete"
        state["teachers"][username]["onboarding_status_message"] = "Onboarding Process Completed!"
        write_log("HR_PORTAL", f"Onboarding completed for teacher: {username}")

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

    elif action == "edit_announcement":
        ann_id = payload.get("id")
        title = payload.get("title")
        content = payload.get("content")
        
        found = False
        for ann in state.get("announcements", []):
            if ann.get("id") == ann_id:
                ann["title"] = title
                ann["content"] = content
                found = True
                break
        
        if not found:
            raise HTTPException(status_code=404, detail="Announcement not found.")
        write_log("ADMIN_AGENT", f"Announcement edited: {ann_id} - '{title}'")

    elif action == "delete_announcement":
        ann_id = payload.get("id")
        original_len = len(state.get("announcements", []))
        state["announcements"] = [ann for ann in state.get("announcements", []) if ann.get("id") != ann_id]
        
        if len(state["announcements"]) == original_len:
            raise HTTPException(status_code=404, detail="Announcement not found.")
        write_log("ADMIN_AGENT", f"Announcement deleted: {ann_id}")

    elif action == "delete_project":
        username = payload.get("username")
        filename = payload.get("filename")
        if username not in state["teachers"]:
            raise HTTPException(status_code=404, detail="Teacher not found.")
        
        teacher = state["teachers"][username]
        original_projects = teacher.get("projects", [])
        
        updated_projects = [p for p in original_projects if p.get("filename") != filename]
        if len(updated_projects) == len(original_projects):
            raise HTTPException(status_code=404, detail="Project not found.")
            
        teacher["projects"] = updated_projects
        write_log("CANDIDATE_PORTAL", f"Deleted project '{filename}' for teacher {username}")
        
        # 1. Attempt to delete local file
        try:
            static_dir = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "static")
            local_file_path = os.path.join(static_dir, "uploads", username, "projects", filename)
            if os.path.exists(local_file_path):
                os.remove(local_file_path)
                write_log("CANDIDATE_PORTAL", f"Deleted local file: {local_file_path}")
        except Exception as e:
            write_log("UPLOAD_WARNING", f"Failed to delete local project file: {str(e)}")

        # 2. Attempt to delete from Supabase storage (if configured)
        supabase_url = os.getenv("SUPABASE_URL", "").strip()
        supabase_key = os.getenv("SUPABASE_KEY", "").strip()
        if supabase_url and supabase_key:
            try:
                from supabase import create_client
                client = create_client(supabase_url, supabase_key)
                file_path = f"{username}/projects/{filename}"
                client.storage.from_("documents").remove([file_path])
                write_log("CANDIDATE_PORTAL", f"Deleted Supabase file: {file_path}")
            except Exception as e:
                write_log("UPLOAD_WARNING", f"Failed to delete Supabase project file: {str(e)}")

    elif action == "remove_profile_photo":
        username = payload.get("username")
        if username not in state["teachers"]:
            raise HTTPException(status_code=404, detail="Teacher not found.")
            
        teacher = state["teachers"][username]
        photo_url = teacher.get("profile_photo_url", "")
        if not photo_url:
            raise HTTPException(status_code=400, detail="No profile photo to remove.")
            
        teacher["profile_photo_url"] = ""
        write_log("HR_AGENT", f"HR removed profile photo for teacher {username}")
        
        try:
            filename = photo_url.split("/")[-1]
            static_dir = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "static")
            local_file_path = os.path.join(static_dir, "uploads", username, filename)
            if os.path.exists(local_file_path):
                os.remove(local_file_path)
                write_log("HR_AGENT", f"Deleted local profile photo file: {local_file_path}")
        except Exception as e:
            write_log("UPLOAD_WARNING", f"Failed to delete local profile photo: {str(e)}")

        supabase_url = os.getenv("SUPABASE_URL", "").strip()
        supabase_key = os.getenv("SUPABASE_KEY", "").strip()
        if supabase_url and supabase_key:
            try:
                from supabase import create_client
                client = create_client(supabase_url, supabase_key)
                filename = photo_url.split("/")[-1]
                file_path = f"{username}/{filename}"
                client.storage.from_("documents").remove([file_path])
                write_log("HR_AGENT", f"Deleted Supabase profile photo file: {file_path}")
            except Exception as e:
                write_log("UPLOAD_WARNING", f"Failed to delete Supabase profile photo: {str(e)}")

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

class MeetingSchema(BaseModel):
    id: Optional[str] = None
    title: str
    description: str
    event_date: Optional[str] = None
    event_time: Optional[str] = None
    created_at: Optional[str] = None
    departments: Optional[List[str]] = None
    department: Optional[str] = None
    # backward compatibility keys
    date: Optional[str] = None
    time: Optional[str] = None
    type: Optional[str] = "meeting"

class TimetableClassSchema(BaseModel):
    id: Optional[str] = None
    subject_name: str
    time_slot: str
    classroom: str
    day_of_week: str
    # backward compatibility keys
    subject: Optional[str] = None
    time: Optional[str] = None
    class_: Optional[str] = None
    day: Optional[str] = None

    class Config:
        populate_by_name = True

# In-memory holidays cache
holidays_cache = {}

@router.get("/api/calendar/holidays")
async def get_calendar_holidays() -> List[dict]:
    import httpx
    current_year = datetime.datetime.now().year
    if current_year < 2026:
        current_year = 2026

    if current_year in holidays_cache:
        print(f"[HOLIDAY CACHE] Returning cached holidays for year {current_year}")
        return holidays_cache[current_year]

    fallback_holidays = [
        {"date": f"{current_year}-01-26", "name": "Republic Day", "localName": "Republic Day"},
        {"date": f"{current_year}-03-02", "name": "Holi", "localName": "Holi"},
        {"date": f"{current_year}-04-02", "name": "Good Friday", "localName": "Good Friday"},
        {"date": f"{current_year}-04-14", "name": "Ambedkar Jayanti", "localName": "Ambedkar Jayanti"},
        {"date": f"{current_year}-05-01", "name": "May Day", "localName": "May Day"},
        {"date": f"{current_year}-08-15", "name": "Independence Day", "localName": "Independence Day"},
        {"date": f"{current_year}-09-04", "name": "Janmashtami", "localName": "Janmashtami"},
        {"date": f"{current_year}-10-02", "name": "Gandhi Jayanti", "localName": "Gandhi Jayanti"},
        {"date": f"{current_year}-10-20", "name": "Dussehra", "localName": "Dussehra"},
        {"date": f"{current_year}-11-08", "name": "Diwali", "localName": "Diwali"},
        {"date": f"{current_year}-12-25", "name": "Christmas Day", "localName": "Christmas Day"}
    ]

    url = f"https://date.nager.at/api/v3/PublicHolidays/{current_year}/IN"
    print(f"[HOLIDAY API] Fetching holidays asynchronously from {url}...")
    try:
        async with httpx.AsyncClient() as client:
            res = await client.get(url, timeout=10.0)
            if res.status_code == 200:
                data = res.json()
                if data and len(data) > 0:
                    holidays_cache[current_year] = data
                    print(f"[HOLIDAY API] Successfully fetched and cached {len(data)} holidays.")
                    return data
    except Exception as e:
        print(f"[HOLIDAY API ERROR] Failed to fetch holidays: {e}")

    holidays_cache[current_year] = fallback_holidays
    return fallback_holidays


# ------------------ MEETINGS ENDPOINTS ------------------
@router.get("/api/calendar/meetings")
def get_calendar_meetings() -> List[dict]:
    print("[GET /api/calendar/meetings] Fetching meetings...")
    store = LocalStateStore()
    state = store.load_state()
    
    # Try fetching from Supabase 'meetings' table first
    from supabase import create_client
    supabase_url = os.getenv("SUPABASE_URL", "").strip()
    supabase_key = os.getenv("SUPABASE_KEY", "").strip()
    if supabase_url and supabase_key:
        try:
            client = create_client(supabase_url, supabase_key)
            res = client.table("meetings").select("id, title, description, event_date, event_time, departments, department").execute()
            if res.data:
                for m in res.data:
                    m["date"] = m.get("event_date")
                    m["time"] = m.get("event_time")
                    m["type"] = "meeting"
                return res.data
        except Exception as e:
            print(f"[Supabase Warning] Failed to fetch meetings table: {e}")
            
    # Fallback to local state
    if "meetings" not in state:
        if "events" in state:
            state["meetings"] = state["events"]
        else:
            state["meetings"] = [
                {"id": "1", "event_date": "2026-01-05", "title": "Spring Semester Begins", "event_time": "09:00", "description": "Classes commence"},
                {"id": "2", "event_date": "2026-01-15", "title": "HOD Meeting", "event_time": "14:30", "description": "Monthly Department Head assembly"},
                {"id": "3", "event_date": "2026-02-12", "title": "Mid-Term Syllabus Review", "event_time": "11:00", "description": "Syllabus progress checks"},
                {"id": "4", "event_date": "2026-03-09", "title": "Research Seminar", "event_time": "15:00", "description": "Presentation on Emerging AI"},
                {"id": "5", "event_date": "2026-03-20", "title": "Board of Studies Meeting", "event_time": "10:00", "description": "Curriculum planning board meeting"},
                {"id": "6", "event_date": "2026-04-15", "title": "Internal Assessment-1", "event_time": "09:00", "description": "First mid-term assessment cycle"},
                {"id": "7", "event_date": "2026-05-18", "title": "End Semester Exams Start", "event_time": "09:30", "description": "Theory exam cycle start"},
                {"id": "8", "event_date": "2026-06-10", "title": "Grading & Evaluation Committee", "event_time": "14:00", "description": "Final grading review meeting"},
                {"id": "9", "event_date": "2026-07-06", "title": "Monsoon Semester Registration", "event_time": "09:00", "description": "Monsoon semester registration & fees payment"},
                {"id": "10", "event_date": "2026-07-15", "title": "Faculty Orientation Program", "event_time": "10:00", "description": "Orientation for new faculty & guidelines"},
                {"id": "11", "event_date": "2026-07-24", "title": "Academic Council Meeting", "event_time": "11:30", "description": "Review of academic procedures & results"},
                {"id": "12", "event_date": "2026-08-10", "title": "Unit Test 1", "event_time": "09:00", "description": "First academic unit test cycle"},
                {"id": "13", "event_date": "2026-08-25", "title": "Department Review", "event_time": "15:30", "description": "August department review agenda"},
                {"id": "14", "event_date": "2026-09-05", "title": "Teacher's Day Celebration", "event_time": "16:00", "description": "Teachers Day events"},
                {"id": "15", "event_date": "2026-09-22", "title": "Mid-Semester Feedback", "event_time": "14:00", "description": "Faculty performance review based on student feedback"},
                {"id": "16", "event_date": "2026-10-15", "title": "Project Phase-1 Review", "event_time": "10:00", "description": "Review of final year projects stage 1"},
                {"id": "17", "event_date": "2026-10-28", "title": "Practical Exams", "event_time": "09:00", "description": "Lab examinations"},
                {"id": "18", "event_date": "2026-11-16", "title": "End Semester Theory Exams", "event_time": "09:30", "description": "Final theory exam cycles"},
                {"id": "19", "event_date": "2026-12-10", "title": "Winter Vacation Commences", "event_time": "17:00", "description": "Start of winter break"},
                {"id": "20", "event_date": "2026-12-18", "title": "Annual Review Meeting", "event_time": "10:30", "description": "Year end progress review"}
            ]
        store.save_state(state)
        
    for m in state["meetings"]:
        m["date"] = m.get("event_date") or m.get("date")
        m["time"] = m.get("event_time") or m.get("time")
        m["type"] = "meeting"
        
    return state["meetings"]

@router.post("/api/calendar/meetings")
def add_calendar_meeting(meeting: MeetingSchema) -> dict:
    print(f"[POST /api/calendar/meetings] Adding meeting: {meeting.title}...")
    store = LocalStateStore()
    state = store.load_state()
    
    meeting_dict = meeting.model_dump()
    if not meeting_dict.get("id"):
        import uuid
        meeting_dict["id"] = str(uuid.uuid4())
        
    # Support client sending date/time
    if not meeting_dict.get("event_date") and meeting_dict.get("date"):
        meeting_dict["event_date"] = meeting_dict.get("date")
    if not meeting_dict.get("event_time") and meeting_dict.get("time"):
        meeting_dict["event_time"] = meeting_dict.get("time")
        
    if not meeting_dict.get("event_date"):
        raise HTTPException(status_code=400, detail="Event date is required.")
    if not meeting_dict.get("event_time"):
        raise HTTPException(status_code=400, detail="Event time is required.")

    if meeting_dict.get("departments"):
        meeting_dict["department"] = ", ".join(meeting_dict["departments"])
    elif meeting_dict.get("department"):
        meeting_dict["departments"] = [d.strip() for d in meeting_dict["department"].split(",") if d.strip()]
        
    meeting_dict["created_at"] = meeting_dict.get("created_at") or datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    
    # Try Supabase first
    from supabase import create_client
    supabase_url = os.getenv("SUPABASE_URL", "").strip()
    supabase_key = os.getenv("SUPABASE_KEY", "").strip()
    if supabase_url and supabase_key:
        try:
            client = create_client(supabase_url, supabase_key)
            res = client.table("meetings").insert(meeting_dict).execute()
            if res.data:
                return {"status": "success", "event": res.data[0]}
        except Exception as e:
            print(f"[Supabase Warning] Failed to insert meeting: {e}")
            
    # Fallback to local state
    if "meetings" not in state:
        get_calendar_meetings()
        state = store.load_state()
        
    state["meetings"].append(meeting_dict)
    store.save_state(state)
    write_log("ADMIN_CALENDAR", f"Added meeting: '{meeting_dict['title']}' on {meeting_dict['event_date']}")
    return {"status": "success", "event": meeting_dict}

@router.put("/api/calendar/meetings/{id}")
def update_calendar_meeting(id: str, meeting: MeetingSchema) -> dict:
    print(f"[PUT /api/calendar/meetings/{id}] Updating meeting: {meeting.title}...")
    store = LocalStateStore()
    state = store.load_state()
    
    meeting_dict = meeting.model_dump()
    meeting_dict["id"] = id
    
    if not meeting_dict.get("event_date") and meeting_dict.get("date"):
        meeting_dict["event_date"] = meeting_dict.get("date")
    if not meeting_dict.get("event_time") and meeting_dict.get("time"):
        meeting_dict["event_time"] = meeting_dict.get("time")

    if not meeting_dict.get("event_date"):
        raise HTTPException(status_code=400, detail="Event date is required.")
    if not meeting_dict.get("event_time"):
        raise HTTPException(status_code=400, detail="Event time is required.")

    if meeting_dict.get("departments"):
        meeting_dict["department"] = ", ".join(meeting_dict["departments"])
    elif meeting_dict.get("department"):
        meeting_dict["departments"] = [d.strip() for d in meeting_dict["department"].split(",") if d.strip()]

    # Try Supabase first
    from supabase import create_client
    supabase_url = os.getenv("SUPABASE_URL", "").strip()
    supabase_key = os.getenv("SUPABASE_KEY", "").strip()
    if supabase_url and supabase_key:
        try:
            client = create_client(supabase_url, supabase_key)
            res = client.table("meetings").update(meeting_dict).eq("id", id).execute()
            if res.data:
                return {"status": "success", "event": res.data[0]}
        except Exception as e:
            print(f"[Supabase Warning] Failed to update meeting: {e}")
            
    # Fallback to local state
    if "meetings" not in state:
        get_calendar_meetings()
        state = store.load_state()
        
    for i, m in enumerate(state["meetings"]):
        if str(m.get("id")) == str(id):
            state["meetings"][i] = meeting_dict
            store.save_state(state)
            write_log("ADMIN_CALENDAR", f"Updated meeting ID {id}: '{meeting.title}'")
            return {"status": "success", "event": state["meetings"][i]}
            
    raise HTTPException(status_code=404, detail="Meeting not found.")

@router.delete("/api/calendar/meetings/{id}")
def delete_calendar_meeting(id: str) -> dict:
    print(f"[DELETE /api/calendar/meetings/{id}] Deleting meeting...")
    store = LocalStateStore()
    state = store.load_state()
    
    # Try Supabase first
    from supabase import create_client
    supabase_url = os.getenv("SUPABASE_URL", "").strip()
    supabase_key = os.getenv("SUPABASE_KEY", "").strip()
    if supabase_url and supabase_key:
        try:
            client = create_client(supabase_url, supabase_key)
            res = client.table("meetings").delete().eq("id", id).execute()
            if res.data:
                return {"status": "success", "message": "Meeting deleted successfully."}
        except Exception as e:
            print(f"[Supabase Warning] Failed to delete meeting: {e}")
            
    # Fallback to local state
    if "meetings" not in state:
        get_calendar_meetings()
        state = store.load_state()
        
    for i, m in enumerate(state["meetings"]):
        if str(m.get("id")) == str(id):
            deleted = state["meetings"].pop(i)
            store.save_state(state)
            write_log("ADMIN_CALENDAR", f"Deleted meeting: '{deleted['title']}' ID {id}")
            return {"status": "success", "message": "Meeting deleted successfully."}
            
    raise HTTPException(status_code=404, detail="Meeting not found.")


# ------------------ TIMETABLE ENDPOINTS ------------------
@router.get("/api/calendar/timetable")
def get_calendar_timetable() -> List[dict]:
    print("[GET /api/calendar/timetable] Fetching timetable...")
    store = LocalStateStore()
    state = store.load_state()
    
    # Try fetching from Supabase 'timetable_classes' table first
    from supabase import create_client
    supabase_url = os.getenv("SUPABASE_URL", "").strip()
    supabase_key = os.getenv("SUPABASE_KEY", "").strip()
    if supabase_url and supabase_key:
        try:
            client = create_client(supabase_url, supabase_key)
            res = client.table("timetable_classes").select("id, subject_name, time_slot, classroom, day_of_week").execute()
            if res.data:
                for c in res.data:
                    c["subject"] = c.get("subject_name")
                    c["time"] = c.get("time_slot")
                    c["class"] = c.get("classroom")
                    c["day"] = c.get("day_of_week")
                return res.data
        except Exception as e:
            print(f"[Supabase Warning] Failed to fetch timetable_classes table: {e}")
            
    # Fallback to local state
    if "timetable_classes" not in state:
        # Load from default teacher schedule if exists
        teacher = state.get("teachers", {}).get("teacher", {})
        if "schedule" in teacher:
            raw_sched = teacher["schedule"]
            migrated = []
            for s in raw_sched:
                migrated.append({
                    "id": str(len(migrated) + 1),
                    "subject_name": s.get("subject"),
                    "time_slot": s.get("time"),
                    "classroom": s.get("class"),
                    "day_of_week": s.get("day")
                })
            state["timetable_classes"] = migrated
        else:
            state["timetable_classes"] = []
        store.save_state(state)
        
    for c in state["timetable_classes"]:
        c["subject"] = c.get("subject_name")
        c["time"] = c.get("time_slot")
        c["class"] = c.get("classroom")
        c["day"] = c.get("day_of_week")
        
    return state["timetable_classes"]

@router.post("/api/calendar/timetable")
def add_timetable_class(t_class: TimetableClassSchema) -> dict:
    print(f"[POST /api/calendar/timetable] Adding class session: {t_class.subject_name}...")
    store = LocalStateStore()
    state = store.load_state()
    
    t_dict = t_class.model_dump()
    if not t_dict.get("id"):
        import uuid
        t_dict["id"] = str(uuid.uuid4())
        
    # Support legacy keys
    if not t_dict.get("subject_name") and t_dict.get("subject"):
        t_dict["subject_name"] = t_dict.get("subject")
    if not t_dict.get("time_slot") and t_dict.get("time"):
        t_dict["time_slot"] = t_dict.get("time")
    if not t_dict.get("classroom") and t_dict.get("class_"):
        t_dict["classroom"] = t_dict.get("class_")
    if not t_dict.get("day_of_week") and t_dict.get("day"):
        t_dict["day_of_week"] = t_dict.get("day")

    # Try Supabase first
    from supabase import create_client
    supabase_url = os.getenv("SUPABASE_URL", "").strip()
    supabase_key = os.getenv("SUPABASE_KEY", "").strip()
    if supabase_url and supabase_key:
        try:
            client = create_client(supabase_url, supabase_key)
            res = client.table("timetable_classes").insert(t_dict).execute()
            if res.data:
                update_legacy_teacher_schedule(state, store)
                return {"status": "success", "class": res.data[0]}
        except Exception as e:
            print(f"[Supabase Warning] Failed to insert timetable class: {e}")
            
    # Fallback to local state
    if "timetable_classes" not in state:
        get_calendar_timetable()
        state = store.load_state()
        
    state["timetable_classes"].append(t_dict)
    store.save_state(state)
    
    update_legacy_teacher_schedule(state, store)
    
    write_log("ADMIN_CALENDAR", f"Added class session: '{t_dict['subject_name']}' on {t_dict['day_of_week']}")
    return {"status": "success", "class": t_dict}

@router.put("/api/calendar/timetable/{id}")
def update_timetable_class(id: str, t_class: TimetableClassSchema) -> dict:
    print(f"[PUT /api/calendar/timetable/{id}] Updating class session: {t_class.subject_name}...")
    store = LocalStateStore()
    state = store.load_state()
    
    t_dict = t_class.model_dump()
    t_dict["id"] = id
    
    if not t_dict.get("subject_name") and t_dict.get("subject"):
        t_dict["subject_name"] = t_dict.get("subject")
    if not t_dict.get("time_slot") and t_dict.get("time"):
        t_dict["time_slot"] = t_dict.get("time")
    if not t_dict.get("classroom") and t_dict.get("class_"):
        t_dict["classroom"] = t_dict.get("class_")
    if not t_dict.get("day_of_week") and t_dict.get("day"):
        t_dict["day_of_week"] = t_dict.get("day")

    # Try Supabase first
    from supabase import create_client
    supabase_url = os.getenv("SUPABASE_URL", "").strip()
    supabase_key = os.getenv("SUPABASE_KEY", "").strip()
    if supabase_url and supabase_key:
        try:
            client = create_client(supabase_url, supabase_key)
            res = client.table("timetable_classes").update(t_dict).eq("id", id).execute()
            if res.data:
                update_legacy_teacher_schedule(state, store)
                return {"status": "success", "class": res.data[0]}
        except Exception as e:
            print(f"[Supabase Warning] Failed to update timetable class: {e}")
            
    # Fallback to local state
    if "timetable_classes" not in state:
        get_calendar_timetable()
        state = store.load_state()
        
    for i, c in enumerate(state["timetable_classes"]):
        if str(c.get("id")) == str(id):
            state["timetable_classes"][i] = t_dict
            store.save_state(state)
            update_legacy_teacher_schedule(state, store)
            write_log("ADMIN_CALENDAR", f"Updated class session ID {id}: '{t_class.subject_name}'")
            return {"status": "success", "class": state["timetable_classes"][i]}
            
    raise HTTPException(status_code=404, detail="Class session not found.")

@router.delete("/api/calendar/timetable/{id}")
def delete_timetable_class(id: str) -> dict:
    print(f"[DELETE /api/calendar/timetable/{id}] Deleting class session...")
    store = LocalStateStore()
    state = store.load_state()
    
    # Try Supabase first
    from supabase import create_client
    supabase_url = os.getenv("SUPABASE_URL", "").strip()
    supabase_key = os.getenv("SUPABASE_KEY", "").strip()
    if supabase_url and supabase_key:
        try:
            client = create_client(supabase_url, supabase_key)
            res = client.table("timetable_classes").delete().eq("id", id).execute()
            if res.data:
                update_legacy_teacher_schedule(state, store)
                return {"status": "success", "message": "Class session deleted successfully."}
        except Exception as e:
            print(f"[Supabase Warning] Failed to delete timetable class: {e}")
            
    # Fallback to local state
    if "timetable_classes" not in state:
        get_calendar_timetable()
        state = store.load_state()
        
    for i, c in enumerate(state["timetable_classes"]):
        if str(c.get("id")) == str(id):
            deleted = state["timetable_classes"].pop(i)
            store.save_state(state)
            update_legacy_teacher_schedule(state, store)
            write_log("ADMIN_CALENDAR", f"Deleted class session: '{deleted['subject_name']}' ID {id}")
            return {"status": "success", "message": "Class session deleted successfully."}
            
    raise HTTPException(status_code=404, detail="Class session not found.")

def update_legacy_teacher_schedule(state: dict, store: LocalStateStore):
    # Keep Dr. Jane Doe's legacy timetable schedule field in sync
    if "teachers" in state and "teacher" in state["teachers"]:
        classes = state.get("timetable_classes", [])
        migrated = []
        for c in classes:
            migrated.append({
                "day": c.get("day_of_week") or c.get("day"),
                "time": c.get("time_slot") or c.get("time"),
                "class": c.get("classroom") or c.get("class"),
                "subject": c.get("subject_name") or c.get("subject")
            })
        state["teachers"]["teacher"]["schedule"] = migrated
        store.save_state(state)

# Backward Compatibility Event endpoints mapping to meetings
@router.get("/api/calendar/events")
def get_calendar_events() -> List[dict]:
    return get_calendar_meetings()

@router.post("/api/calendar/events")
def add_calendar_event(event: MeetingSchema) -> dict:
    return add_calendar_meeting(event)

@router.put("/api/calendar/events/{id}")
def update_calendar_event(id: str, event: MeetingSchema) -> dict:
    return update_calendar_meeting(id, event)

@router.delete("/api/calendar/events/{id}")
def delete_calendar_event(id: str) -> dict:
    return delete_calendar_meeting(id)

# Legacy teacher schedule POST handler mapping to timetable classes
@router.post("/api/teacher/schedule")
def update_teacher_schedule(payload: dict) -> dict:
    store = LocalStateStore()
    state = store.load_state()
    
    teacher_username = payload.get("teacher_username", "teacher")
    schedule_data = payload.get("schedule", [])
    
    if "teachers" not in state or teacher_username not in state["teachers"]:
        raise HTTPException(status_code=404, detail="Teacher not found.")
        
    state["teachers"][teacher_username]["schedule"] = schedule_data
    
    # Also update timetable classes table mapping
    migrated = []
    for idx, s in enumerate(schedule_data):
        migrated.append({
            "id": str(idx + 1),
            "subject_name": s.get("subject"),
            "time_slot": s.get("time"),
            "classroom": s.get("class"),
            "day_of_week": s.get("day")
        })
    state["timetable_classes"] = migrated
    store.save_state(state)
    write_log("ADMIN_CALENDAR", f"Updated class schedule for teacher '{teacher_username}'")
    return {"status": "success", "schedule": schedule_data}

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


class BankDetails(BaseModel):
    account_name: str
    account_number: str
    ifsc_code: str
    bank_name: str

@router.get("/api/teacher/{username}/bank")
def get_bank_details(username: str) -> dict:
    store = LocalStateStore()
    state = store.load_state()
    if not state or "teachers" not in state or username not in state["teachers"]:
        raise HTTPException(status_code=404, detail="Teacher not found.")
    
    teacher_data = state["teachers"][username]
    bank_details = teacher_data.get("bank_details", {})
    return {"status": "success", "bank_details": bank_details}

@router.post("/api/teacher/{username}/bank")
def update_bank_details(username: str, data: BankDetails) -> dict:
    store = LocalStateStore()
    state = store.load_state()
    if not state or "teachers" not in state or username not in state["teachers"]:
        raise HTTPException(status_code=404, detail="Teacher not found.")
    
    state["teachers"][username]["bank_details"] = data.dict()
    store.save_state(state)
    return {"status": "success", "message": "Bank details updated"}

@router.get("/api/teacher/{username}/salary")
def get_salary_history(username: str) -> dict:
    store = LocalStateStore()
    state = store.load_state()
    if not state or "teachers" not in state or username not in state["teachers"]:
        raise HTTPException(status_code=404, detail="Teacher not found.")
    
    teacher_data = state["teachers"][username]
    history = teacher_data.get("salary_history", [])
    
    return {"status": "success", "history": history}

class SalaryPushReq(BaseModel):
    username: str
    amount: str
    month: str

@router.post("/api/hr/salary/push")
def push_salary(data: SalaryPushReq) -> dict:
    store = LocalStateStore()
    state = store.load_state()
    if not state or "teachers" not in state or data.username not in state["teachers"]:
        raise HTTPException(status_code=404, detail="Teacher not found.")
        
    teacher_data = state["teachers"][data.username]
    if "salary_history" not in teacher_data:
        teacher_data["salary_history"] = []
        
    import secrets
    record = {
        "month": data.month,
        "amount": data.amount,
        "transaction_id": f"TXN-{secrets.token_hex(4).upper()}",
        "status": "Credited"
    }
    
    # Prepend to history
    teacher_data["salary_history"].insert(0, record)
    store.save_state(state)
    return {"status": "success", "record": record}
