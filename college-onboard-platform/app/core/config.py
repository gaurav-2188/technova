import os
from dotenv import load_dotenv

load_dotenv(override=True)

# Application configuration (env reloaded)
PORT = int(os.getenv("PORT", "8000"))
HOST = os.getenv("HOST", "0.0.0.0")
ENV = os.getenv("ENV", "production")

# Pinecone Database configurations
PINECONE_API_KEY = os.getenv("PINECONE_API_KEY", "")
PINECONE_ENV = os.getenv("PINECONE_ENV", "")

# Mock Secrets / External tokens (never logged directly)
HR_EMAIL = os.getenv("HR_EMAIL", "hr@pes.edu")
SMTP_TOKEN = os.getenv("SMTP_TOKEN", "mock-smtp-token")
CALENDAR_TOKEN = os.getenv("CALENDAR_TOKEN", "mock-calendar-token")

# SMTP Configurations
SMTP_HOST = os.getenv("SMTP_HOST", "smtp.gmail.com")
SMTP_PORT = int(os.getenv("SMTP_PORT", "587"))
SMTP_USERNAME = os.getenv("SMTP_USERNAME", "hr@pes.edu")
SMTP_PASSWORD = os.getenv("SMTP_PASSWORD", "mock-password")
CHAIRPERSON_EMAIL = os.getenv("CHAIRPERSON_EMAIL", "chairperson@pes.edu")
IDCARD_EMAIL = os.getenv("IDCARD_EMAIL", "idcards@pes.edu")
IT_EMAIL = os.getenv("IT_EMAIL", "it@pes.edu")
RESEND_API_KEY = os.getenv("RESEND_API_KEY", "")
SENDGRID_API_KEY = os.getenv("SENDGRID_API_KEY", "")

# Human-in-the-Loop Testing Configuration
# WARNING: When True, document verification, interview scheduling, manager approval,
# and credential/provisioning emails are all auto-approved with no human review.
# Keep this False except for local/demo testing. Set BYPASS_HITL_FOR_TESTING=true
# in your .env only when you intentionally want to skip approval gates.
BYPASS_HITL_FOR_TESTING = os.getenv("BYPASS_HITL_FOR_TESTING", "false").strip().lower() == "true"
