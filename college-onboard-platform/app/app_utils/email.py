import smtplib
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
import logging
from app.core.config import SMTP_HOST, SMTP_PORT, SMTP_USERNAME, SMTP_PASSWORD

def send_email(to_email: str, subject: str, body: str, is_html: bool = False) -> bool:
    """Send an email using standard SMTP or SMTP_SSL if port is 465."""
    try:
        msg = MIMEMultipart("alternative")
        msg["Subject"] = subject
        msg["From"] = SMTP_USERNAME
        msg["To"] = to_email
        msg.attach(MIMEText(body, "html" if is_html else "plain"))
        
        print(f"[DEBUG SMTP] Destination email address: {to_email}")
        
        if SMTP_PORT == 465:
            print("SMTP_SSL Connection Attempting...")
            with smtplib.SMTP_SSL(SMTP_HOST, SMTP_PORT, timeout=15) as server:
                server.login(SMTP_USERNAME, SMTP_PASSWORD)
                server.sendmail(SMTP_USERNAME, to_email, msg.as_string())
        else:
            print("SMTP STARTTLS Connection Attempting...")
            with smtplib.SMTP(SMTP_HOST, SMTP_PORT, timeout=15) as server:
                server.starttls()
                server.login(SMTP_USERNAME, SMTP_PASSWORD)
                server.sendmail(SMTP_USERNAME, to_email, msg.as_string())
                
        logging.info(f"Successfully dispatched email to {to_email}")
        return True
    except Exception as e:
        logging.error(f"Failed to dispatch email to {to_email}: {e}")
        return False
