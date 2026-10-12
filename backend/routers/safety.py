"""
routers/safety.py - Safety Dashboard metrics and security audit logs
"""

from fastapi import APIRouter
from backend.database import get_db

router = APIRouter(prefix="/api/safety", tags=["Safety"])

@router.get("/{wallet_id}")
def get_safety_metrics(wallet_id: str):
    with get_db() as conn:
        cur = conn.cursor()
        cur.execute("SELECT balance, offline_limit FROM wallets WHERE wallet_id = ?", (wallet_id,))
        wallet_row = cur.fetchone()
        balance = wallet_row["balance"] if wallet_row else 0
        offline_limit = wallet_row["offline_limit"] if wallet_row else 200

        cur.execute("SELECT COUNT(*) as c FROM transactions WHERE (sender = ? OR receiver = ?) AND status = 'confirmed'", (wallet_id, wallet_id))
        confirmed_count = cur.fetchone()["c"]

        cur.execute("SELECT COUNT(*) as c FROM transactions WHERE (sender = ? OR receiver = ?) AND status = 'rejected'", (wallet_id, wallet_id))
        rejected_count = cur.fetchone()["c"]

        cur.execute("SELECT COUNT(*) as c FROM safety_audit WHERE wallet_id = ? AND event_type = 'DUPLICATE_SYNC_IGNORED'", (wallet_id,))
        duplicates_count = cur.fetchone()["c"]

        cur.execute("SELECT * FROM safety_audit WHERE wallet_id = ? OR wallet_id = '' ORDER BY created_at DESC LIMIT 25", (wallet_id,))
        audit_events = [dict(r) for r in cur.fetchall()]

        return {
            "wallet_id": wallet_id,
            "balance": balance,
            "offline_limit": offline_limit,
            "metrics": {
                "confirmed": confirmed_count,
                "rejected": rejected_count,
                "duplicates_neutralized": duplicates_count
            },
            "audit_events": audit_events
        }
