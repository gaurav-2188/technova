
import json
import os
import time
from typing import Any, Dict
from supabase import create_client, Client



class LocalStateStore:
    def __init__(self, filepath="state_store.json"):
        self.filepath = filepath
        self.supabase_url = os.getenv("SUPABASE_URL", "").strip()
        self.supabase_key = os.getenv("SUPABASE_KEY", "").strip()
        self.client = None
        if self.supabase_url and self.supabase_key:
            try:
                self.client = create_client(self.supabase_url, self.supabase_key)
            except Exception as e:
                print(f"[SUPABASE ERROR] Failed to initialize Supabase client: {e}")

    def get_default_state(self) -> Dict[str, Any]:
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
                    "present_days": 24,
                    "attendance": [
                        {"date": "2026-06-15", "status": "Absent", "reason": "Sick Leave"},
                        {"date": "2026-06-28", "status": "Absent", "reason": "Casual Leave"}
                    ],
                    "documents": ["PhD_Cert.pdf", "Joining_Letter.pdf"],
                    "projects": [],
                    "applied_leaves": [],
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

    def load_state(self) -> Dict[str, Any]:
        local_state = {}
        if os.path.exists(self.filepath):
            try:
                with open(self.filepath, "r") as f:
                    local_state = json.load(f)
            except Exception:
                pass

        supabase_state = {}
        if self.client:
            try:
                res = self.client.table("app_state").select("state").eq("id", "main_state").execute()
                if res.data and len(res.data) > 0:
                    supabase_state = res.data[0]["state"]
            except Exception as e:
                print(f"[SUPABASE ERROR] Failed to load state: {e}")

        # Compare timestamps to return the latest state
        local_time = local_state.get("last_updated", 0)
        supabase_time = supabase_state.get("last_updated", 0)
        
        state = supabase_state if supabase_time > local_time else local_state
        if not state:
            state = supabase_state if supabase_state else local_state

        # Fallback to default state if empty or missing teachers
        if not state or "teachers" not in state:
            state = self.get_default_state()
            self.save_state(state)
            
        # Sync local file with the newer state if needed
        if supabase_time > local_time:
            try:
                with open(self.filepath, "w") as f:
                    json.dump(state, f, indent=2)
            except Exception:
                pass

        return state

    def save_state(self, state_dict: Dict[str, Any]):
        # Add timestamp
        state_dict["last_updated"] = time.time()
        
        # Always write to local storage first
        try:
            with open(self.filepath, "w") as f:
                json.dump(state_dict, f, indent=2)
        except Exception as e:
            print(f"[LOCAL STORE ERROR] Failed to save state locally: {e}")

        if self.client:
            try:
                self.client.table("app_state").upsert({"id": "main_state", "state": state_dict}).execute()
            except Exception as e:
                print(f"[SUPABASE ERROR] Failed to save state to Supabase: {e}")

    def update_field(self, key: str, value: Any):
        state = self.load_state()
        state[key] = value
        self.save_state(state)
