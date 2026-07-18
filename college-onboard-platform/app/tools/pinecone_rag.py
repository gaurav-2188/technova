import os
import logging
import requests
from dotenv import load_dotenv
from pinecone import Pinecone
from app.core.privacy import DataMaskingMiddleware
from app.app_utils.telemetry import track_memory

# Matches below this cosine similarity score are treated as irrelevant and dropped,
# instead of always stuffing the top_k results into the LLM prompt regardless of
# how well they actually match the query.
MIN_RELEVANCE_SCORE = 0.55

class PineconeRAGService:
    def __init__(self):
        load_dotenv(override=True)
        self.api_key = os.getenv("PINECONE_API_KEY", "")
        self.env = os.getenv("PINECONE_ENV", "")
        self.gemini_key = os.getenv("GEMINI_API_KEY", "")

    @track_memory
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
                
                query_res = idx.query(vector=vector, top_k=6, include_metadata=True)
                
                # 3. Parse and format retrieved text chunks, dropping low-relevance matches
                context_pieces = []
                for match in query_res.matches:
                    score = getattr(match, "score", None)
                    if score is not None and score < MIN_RELEVANCE_SCORE:
                        continue
                    if match.metadata and "text" in match.metadata:
                        context_pieces.append(f"- {match.metadata['text'].strip()}")
                
                if context_pieces:
                    return f"[Pinecone Index: {index_name}] RETRIEVED REAL-TIME RULES:\n" + "\n".join(context_pieces)
                else:
                    # Nothing cleared the relevance bar - let the caller's LLM answer
                    # from general knowledge rather than forcing in noisy chunks.
                    return "[Pinecone Index: working] No sufficiently relevant rules found for this query."
            else:
                logging.warning(f"Gemini embedding call returned status {res.status_code}: {res.text[:300]}")
        except Exception as e:
            logging.warning(f"Pinecone RAG lookup failed, using fallback brief: {e}")

        return self.get_fallback_brief(scrubbed)

    def get_fallback_brief(self, scrubbed: str) -> str:
        return (
            f"[Pinecone Search (Simulation)] RETRIEVED RULES CONTEXT:\n"
            f"- Data Input (PII Scrubbed): {scrubbed}\n"
            "- Joining guidelines: Submit original verification documents within 30 days.\n"
            "- Campus ethics: Absolute professionalism in research and teaching duties."
        )
