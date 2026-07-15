# Verification Artifact: initial_interview

- **API Action**: Email HR & Candidate Interview Confirmation
- **Interrupt ID**: `approve_initial_interview`

### State context:
```json
{
  "api_action": "Email HR & Candidate Interview Confirmation",
  "target_node": "initial_interview",
  "state_at_trigger": {
    "__session_metadata__": "{'displayName': 'Hello'}",
    "candidate_name": "Dr. Jane Doe",
    "active_stage": "Credentials-Sent",
    "confirmation_email_sent": "False",
    "credentials_sent": "True",
    "documents": "['file-example_PDF_500_kB.pdf', 'file-sample_150kB.pdf', 'file-example_PDF_1MB.pdf']",
    "policy_brief": "[Pinecone Search (Simulation)] RETRIEVED RULES CONTEXT:\n- Data Input (PII Scrubbed): file-example_PDF_1MB.pdf\n- Joining guidelines: Submit original verification documents within 30 days.\n- Campus ethics: Absolute professionalism in research and teaching duties.",
    "manager_interview_scheduled": "False",
    "chairperson_notified": "False",
    "final_approval_flag": "False",
    "allotment_criteria": "{}",
    "it_notified": "False",
    "admin_notified": "False",
    "leave_balance": "30",
    "email": "1321harikrishna@gmail.com",
    "username": "teacher",
    "password": "password",
    "employee_id": "PES1TE25CS183",
    "document_statuses": "{'aadhaar_card': 'approved', 'appointment_letter': 'approved', 'teacher_eligibility_test': 'approved'}",
    "document_paths": "{'aadhaar_card': 'file-example_PDF_500_kB.pdf', 'appointment_letter': 'file-sample_150kB.pdf', 'teacher_eligibility_test': 'file-example_PDF_1MB.pdf'}",
    "pending_tally": "0",
    "current_stage": "policy_review",
    "onboarding_status_message": "Verified by HR, details forwarded for teacher onboarding"
  }
}
```

Please approve this action by resuming with: `{"approved": true}`.
