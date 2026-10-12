"""
routers/wallets.py - FastAPI endpoints for wallet management
"""

import time
from fastapi import APIRouter, HTTPException, status
from backend.database import get_db
from backend.schemas import WalletCreate, WalletResponse, WalletBalanceResponse, SpendingLimitUpdate

router = APIRouter(prefix="/api/wallets", tags=["Wallets"])

@router.post("", response_model=WalletResponse, status_code=status.HTTP_201_CREATED)
def create_or_get_wallet(payload: WalletCreate):
    now = int(time.time() * 1000)
    with get_db() as conn:
        cur = conn.cursor()
        cur.execute("SELECT * FROM wallets WHERE wallet_id = ?", (payload.wallet_id,))
        row = cur.fetchone()
        if row:
            return dict(row)

        balance = payload.balance if payload.balance is not None else 500
        cur.execute("""
            INSERT INTO wallets (wallet_id, name, balance, offline_limit, created_at)
            VALUES (?, ?, ?, 200, ?)
        """, (payload.wallet_id, payload.name, balance, now))
        
        return {
            "wallet_id": payload.wallet_id,
            "name": payload.name,
            "balance": balance,
            "offline_limit": 200,
            "created_at": now
        }

@router.get("/{wallet_id}", response_model=WalletResponse)
def get_wallet(wallet_id: str):
    with get_db() as conn:
        cur = conn.cursor()
        cur.execute("SELECT * FROM wallets WHERE wallet_id = ?", (wallet_id,))
        row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Wallet not found")
        return dict(row)

@router.get("/{wallet_id}/balance", response_model=WalletBalanceResponse)
def get_wallet_balance(wallet_id: str):
    with get_db() as conn:
        cur = conn.cursor()
        cur.execute("SELECT balance FROM wallets WHERE wallet_id = ?", (wallet_id,))
        row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Wallet not found")
        return {"wallet_id": wallet_id, "balance": row["balance"]}

@router.post("/{wallet_id}/limits")
def update_spending_limit(wallet_id: str, payload: SpendingLimitUpdate):
    with get_db() as conn:
        cur = conn.cursor()
        cur.execute("SELECT balance FROM wallets WHERE wallet_id = ?", (wallet_id,))
        if not cur.fetchone():
            raise HTTPException(status_code=404, detail="Wallet not found")
        
        cur.execute("UPDATE wallets SET offline_limit = ? WHERE wallet_id = ?", (payload.offline_limit, wallet_id))
        cur.execute("""
            INSERT INTO safety_audit (wallet_id, event_type, description, metadata, created_at)
            VALUES (?, 'LIMIT_UPDATED', ?, ?, ?)
        """, (wallet_id, f"Offline limit updated to {payload.offline_limit}", '{"source": "api"}', int(time.time() * 1000)))
        
        return {"wallet_id": wallet_id, "offline_limit": payload.offline_limit}
