import json
import os
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

    def load_state(self) -> Dict[str, Any]:
        if self.client:
            try:
                res = self.client.table("app_state").select("state").eq("id", "main_state").execute()
                if res.data and len(res.data) > 0:
                    return res.data[0]["state"]
            except Exception as e:
                print(f"[SUPABASE ERROR] Failed to load state: {e}")
        
        # Fallback to local storage
        if os.path.exists(self.filepath):
            try:
                with open(self.filepath, "r") as f:
                    return json.load(f)
            except Exception:
                return {}
        return {}

    def save_state(self, state_dict: Dict[str, Any]):
        if self.client:
            try:
                # Upsert main state
                self.client.table("app_state").upsert({"id": "main_state", "state": state_dict}).execute()
                return
            except Exception as e:
                print(f"[SUPABASE ERROR] Failed to save state: {e}")

        # Fallback to local storage
        with open(self.filepath, "w") as f:
            json.dump(state_dict, f, indent=2)

    def update_field(self, key: str, value: Any):
        state = self.load_state()
        state[key] = value
        self.save_state(state)
