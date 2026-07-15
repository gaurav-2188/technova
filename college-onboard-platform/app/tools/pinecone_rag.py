import os
import requests
from dotenv import load_dotenv
from pinecone import Pinecone
from app.core.privacy import DataMaskingMiddleware

class PineconeRAGService:
    def __init__(self):
        load_dotenv(override=True)
        self.api_key = os.getenv("PINECONE_API_KEY", "")
        self.env = os.getenv("PINECONE_ENV", "")
        self.gemini_key = os.getenv("GEMINI_API_KEY", "")

    def query_rules(self, document_content: str) -> str:
        # Mask PII input context before performing any LLM/vector storage lookup
        scrubbed = DataMaskingMiddleware.redact_pii(document_content)
        
        if not self.api_key or not self.gemini_key:
            return self.get_fallback_brief(scrubbed)

        try:
            # 1. Get query embedding from Gemini (3072 dimensions)
            embed_url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent?key={self.gemini_key}"
            headers = {"Content-Type": "application/json"}
            data = {
                "model": "models/gemini-embedding-001",
                "content": {"parts": [{"text": scrubbed}]},
                "outputDimensionality": 3072
            }
            res = requests.post(embed_url, headers=headers, json=data, timeout=15.0)
            if res.status_code == 200:
                vector = res.json()["embedding"]["values"]
                
                # 2. Connect to Pinecone and Query index
                pc = Pinecone(api_key=self.api_key)
                index_name = "working"
                idx = pc.Index(index_name)
                
                query_res = idx.query(vector=vector, top_k=3, include_metadata=True)
                
                # 3. Parse and format retrieved text chunks
                context_pieces = []
                for match in query_res.matches:
                    if match.metadata and "text" in match.metadata:
                        context_pieces.append(f"- {match.metadata['text'].strip()}")
                
                if context_pieces:
                    return f"[Pinecone Index: {index_name}] RETRIEVED REAL-TIME RULES:\n" + "\n".join(context_pieces)
        except Exception:
            pass

        return self.get_fallback_brief(scrubbed)

    def get_fallback_brief(self, scrubbed: str) -> str:
        return (
            f"[Pinecone Search (Simulation)] RETRIEVED RULES CONTEXT:\n"
            f"- Data Input (PII Scrubbed): {scrubbed}\n"
            "- Joining guidelines: Submit original verification documents within 30 days.\n"
            "- Campus ethics: Absolute professionalism in research and teaching duties."
        )
