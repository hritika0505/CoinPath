"""
routers/notifications.py - In-app notification management and alert preferences
"""

from fastapi import APIRouter
from backend.database import get_db

router = APIRouter(prefix="/api/notifications", tags=["Notifications"])

@router.get("/{wallet_id}")
def get_notifications(wallet_id: str):
    with get_db() as conn:
        cur = conn.cursor()
        cur.execute("SELECT * FROM notifications WHERE wallet_id = ? ORDER BY created_at DESC LIMIT 30", (wallet_id,))
        return [dict(r) for r in cur.fetchall()]

@router.post("/{notification_id}/read")
def mark_notification_read(notification_id: int):
    with get_db() as conn:
        cur = conn.cursor()
        cur.execute("UPDATE notifications SET read = 1 WHERE id = ?", (notification_id,))
        return {"status": "success", "id": notification_id}
