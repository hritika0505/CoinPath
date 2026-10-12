"""
sms.py - SMS notification service with Twilio integration & safe mock mode
Guarantees:
- Secrets kept exclusively in backend environment variables
- No SMS sent for pending transactions
- Deduplication prevents repeated SMS messages on synchronization retries
"""

import os
import time
import urllib.request
import urllib.parse
import base64
from backend.database import get_db

def dispatch_sms_alert(tx_id: str, phone: str, amount: int, sender: str, receiver: str):
    """
    Dispatches SMS notification upon confirmed backend transaction.
    Checks database uniqueness constraint on (tx_id, recipient_phone) to prevent duplicate SMS alerts.
    """
    account_sid = os.environ.get("TWILIO_ACCOUNT_SID")
    auth_token = os.environ.get("TWILIO_AUTH_TOKEN")
    from_phone = os.environ.get("TWILIO_PHONE_NUMBER")

    message_text = f"[CoinPath Alert] Payment of {amount} coins successfully confirmed. Sender: {sender}, Receiver: {receiver}. Ref: {tx_id}"

    with get_db() as conn:
        # Check if already sent for this transaction
        cur = conn.cursor()
        cur.execute("SELECT id FROM sms_logs WHERE tx_id = ? AND recipient_phone = ?", (tx_id, phone))
        if cur.fetchone():
            print(f"[SMS Service] Duplicate SMS suppressed for confirmed transaction {tx_id}")
            return False

        if account_sid and auth_token and from_phone:
            # Twilio Cloud API integration
            try:
                url = f"https://api.twilio.com/2010-04-01/Accounts/{account_sid}/Messages.json"
                auth = base64.b64encode(f"{account_sid}:{auth_token}".encode("utf-8")).decode("ascii")
                data = urllib.parse.urlencode({
                    "To": phone,
                    "From": from_phone,
                    "Body": message_text
                }).encode("utf-8")

                req = urllib.request.Request(url, data=data, method="POST")
                req.add_header("Authorization", f"Basic {auth}")
                req.add_header("Content-Type", "application/x-www-form-urlencoded")

                with urllib.request.urlopen(req, timeout=5) as response:
                    status = "sent" if response.status in (200, 201) else "failed"

                cur.execute("""
                    INSERT OR IGNORE INTO sms_logs (tx_id, recipient_phone, message_text, status, provider, created_at)
                    VALUES (?, ?, ?, ?, 'twilio', ?)
                """, (tx_id, phone, message_text, status, int(time.time() * 1000)))
                return True
            except Exception as e:
                print(f"[SMS Service] Twilio request failed: {e}")
                cur.execute("""
                    INSERT OR IGNORE INTO sms_logs (tx_id, recipient_phone, message_text, status, provider, created_at)
                    VALUES (?, ?, ?, 'failed', 'twilio', ?)
                """, (tx_id, phone, message_text, int(time.time() * 1000)))
                return False
        else:
            # Safe mock notification mode for development & exhibition testing
            print(f"[SMS Service (Mock Mode)] Notification sent to {phone}: '{message_text}'")
            cur.execute("""
                INSERT OR IGNORE INTO sms_logs (tx_id, recipient_phone, message_text, status, provider, created_at)
                VALUES (?, ?, ?, 'mock_sent', 'mock_sandbox', ?)
            """, (tx_id, phone, message_text, int(time.time() * 1000)))
            return True
