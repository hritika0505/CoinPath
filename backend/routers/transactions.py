"""
routers/transactions.py - Transaction processing and offline idempotent synchronization
"""

import time
import json
from fastapi import APIRouter, HTTPException, status
from backend.database import get_db
from backend.schemas import TransactionCreate, SyncRequest, SyncResponse, SyncItemResult
from backend.services.sms import dispatch_sms_alert

router = APIRouter(prefix="/api/transactions", tags=["Transactions"])

@router.post("", status_code=status.HTTP_201_CREATED)
def create_online_transaction(payload: TransactionCreate):
    now = int(time.time() * 1000)
    with get_db() as conn:
        cur = conn.cursor()
        # 1. Duplicate check
        cur.execute("SELECT * FROM transactions WHERE tx_id = ?", (payload.tx_id,))
        existing = cur.fetchone()
        if existing:
            return {
                "status": "duplicate",
                "message": "Transaction already processed",
                "tx_id": payload.tx_id
            }

        # 2. Check balance
        cur.execute("SELECT balance FROM wallets WHERE wallet_id = ?", (payload.sender,))
        sender_row = cur.fetchone()
        if not sender_row or sender_row["balance"] < payload.amount:
            raise HTTPException(status_code=400, detail="Insufficient sender balance")

        # 3. Ensure receiver wallet exists
        cur.execute("SELECT wallet_id FROM wallets WHERE wallet_id = ?", (payload.receiver,))
        if not cur.fetchone():
            cur.execute("INSERT INTO wallets (wallet_id, name, balance, offline_limit, created_at) VALUES (?, ?, 500, 200, ?)",
                        (payload.receiver, payload.receiver, now))

        # 4. Atomic debit and credit
        cur.execute("UPDATE wallets SET balance = balance - ? WHERE wallet_id = ?", (payload.amount, payload.sender))
        cur.execute("UPDATE wallets SET balance = balance + ? WHERE wallet_id = ?", (payload.amount, payload.receiver))
        cur.execute("""
            INSERT INTO transactions (tx_id, sender, receiver, amount, status, note, timestamp, confirmed_at)
            VALUES (?, ?, ?, ?, 'confirmed', ?, ?, ?)
        """, (payload.tx_id, payload.sender, payload.receiver, payload.amount, payload.note or '', payload.timestamp or now, now))

    # Trigger SMS notification upon confirmation
    dispatch_sms_alert(payload.tx_id, "+1 555-0199", payload.amount, payload.sender, payload.receiver)

    return {
        "status": "confirmed",
        "tx_id": payload.tx_id,
        "sender": payload.sender,
        "receiver": payload.receiver,
        "amount": payload.amount,
        "confirmed_at": now
    }

@router.post("/sync", response_model=SyncResponse)
def sync_offline_transactions(payload: SyncRequest):
    """
    Idempotent offline transaction synchronization.
    - Uses SQLite transactions and unique constraints.
    - Prevents double debits when the same transaction is synchronized repeatedly.
    - Enforces configured offline spending limits on the server.
    """
    results = []
    now = int(time.time() * 1000)

    with get_db() as conn:
        cur = conn.cursor()

        for item in payload.transactions:
            # Check for existing transaction (Duplicate check)
            cur.execute("SELECT * FROM transactions WHERE tx_id = ?", (item.tx_id,))
            existing = cur.fetchone()
            if existing:
                # Log duplicate attempt for audit safety dashboard
                cur.execute("""
                    INSERT INTO safety_audit (wallet_id, event_type, description, metadata, created_at)
                    VALUES (?, 'DUPLICATE_SYNC_IGNORED', ?, ?, ?)
                """, (item.sender, f"Duplicate attempt neutralized for {item.tx_id}. Wallet balance untouched.", json.dumps({"tx_id": item.tx_id}), now))

                results.append(SyncItemResult(
                    tx_id=item.tx_id,
                    status="duplicate",
                    reason="Transaction already settled on server. Idempotent check prevented double debit.",
                    confirmed_at=existing["confirmed_at"]
                ))
                continue

            # Ensure sender and receiver exist
            cur.execute("SELECT * FROM wallets WHERE wallet_id = ?", (item.sender,))
            sender_wallet = cur.fetchone()
            if not sender_wallet:
                cur.execute("INSERT INTO wallets (wallet_id, name, balance, offline_limit, created_at) VALUES (?, ?, 500, 200, ?)",
                            (item.sender, item.sender, now))
                cur.execute("SELECT * FROM wallets WHERE wallet_id = ?", (item.sender,))
                sender_wallet = cur.fetchone()

            cur.execute("SELECT * FROM wallets WHERE wallet_id = ?", (item.receiver,))
            receiver_wallet = cur.fetchone()
            if not receiver_wallet:
                cur.execute("INSERT INTO wallets (wallet_id, name, balance, offline_limit, created_at) VALUES (?, ?, 500, 200, ?)",
                            (item.receiver, item.receiver, now))

            # Validate offline spending limit
            if item.amount > sender_wallet["offline_limit"]:
                cur.execute("""
                    INSERT INTO transactions (tx_id, sender, receiver, amount, status, note, timestamp, confirmed_at, rejection_reason, signature)
                    VALUES (?, ?, ?, ?, 'rejected', ?, ?, ?, 'Exceeds configured offline spending limit', ?)
                """, (item.tx_id, item.sender, item.receiver, item.amount, item.note or '', item.timestamp, now, item.signature or ''))

                results.append(SyncItemResult(
                    tx_id=item.tx_id,
                    status="rejected",
                    reason=f"Exceeds sender's offline spending limit of {sender_wallet['offline_limit']} coins"
                ))
                continue

            # Validate authoritative server balance
            if sender_wallet["balance"] < item.amount:
                cur.execute("""
                    INSERT INTO transactions (tx_id, sender, receiver, amount, status, note, timestamp, confirmed_at, rejection_reason, signature)
                    VALUES (?, ?, ?, ?, 'rejected', ?, ?, ?, 'Insufficient balance on authoritative server', ?)
                """, (item.tx_id, item.sender, item.receiver, item.amount, item.note or '', item.timestamp, now, item.signature or ''))

                results.append(SyncItemResult(
                    tx_id=item.tx_id,
                    status="rejected",
                    reason="Insufficient balance on authoritative server"
                ))
                continue

            # Execute atomic transfer
            cur.execute("UPDATE wallets SET balance = balance - ? WHERE wallet_id = ?", (item.amount, item.sender))
            cur.execute("UPDATE wallets SET balance = balance + ? WHERE wallet_id = ?", (item.amount, item.receiver))
            cur.execute("""
                INSERT INTO transactions (tx_id, sender, receiver, amount, status, note, timestamp, confirmed_at, signature)
                VALUES (?, ?, ?, ?, 'confirmed', ?, ?, ?, ?)
            """, (item.tx_id, item.sender, item.receiver, item.amount, item.note or '', item.timestamp, now, item.signature or ''))

            # Record audit event
            cur.execute("""
                INSERT INTO safety_audit (wallet_id, event_type, description, metadata, created_at)
                VALUES (?, 'OFFLINE_TX_CONFIRMED', ?, ?, ?)
            """, (item.sender, f"Offline payment {item.tx_id} validated and credited", json.dumps({"amount": item.amount, "receiver": item.receiver}), now))

            # Add in-app notification
            cur.execute("""
                INSERT INTO notifications (wallet_id, title, message, type, metadata, created_at)
                VALUES (?, 'Payment Confirmed', ?, 'success', ?, ?)
            """, (item.receiver, f"Received {item.amount} coins from {item.sender} (Ref: {item.tx_id})", json.dumps({"tx_id": item.tx_id, "amount": item.amount}), now))

            results.append(SyncItemResult(
                tx_id=item.tx_id,
                status="confirmed",
                confirmed_at=now
            ))

            # Dispatch SMS notification after confirmation
            dispatch_sms_alert(item.tx_id, "+1 555-0199", item.amount, item.sender, item.receiver)

    synced_count = len([r for r in results if r.status == "confirmed"])
    return SyncResponse(synced_count=synced_count, results=results)

@router.get("/{wallet_id}")
def get_wallet_transactions(wallet_id: str):
    with get_db() as conn:
        cur = conn.cursor()
        cur.execute("""
            SELECT * FROM transactions
            WHERE sender = ? OR receiver = ?
            ORDER BY confirmed_at DESC
        """, (wallet_id, wallet_id))
        return [dict(r) for r in cur.fetchall()]
