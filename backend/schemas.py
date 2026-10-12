"""
schemas.py - Pydantic Request & Response Validation Schemas for FastAPI
"""

from typing import List, Optional, Dict, Any
from pydantic import BaseModel, Field

class WalletCreate(BaseModel):
    wallet_id: str = Field(..., pattern=r"^CP-\d{4,8}$", description="Wallet ID (e.g., CP-1234)")
    name: str = Field(..., min_length=2, max_length=50)
    balance: Optional[int] = Field(500, ge=0)

class WalletResponse(BaseModel):
    wallet_id: str
    name: str
    balance: int
    offline_limit: int
    created_at: int

class WalletBalanceResponse(BaseModel):
    wallet_id: str
    balance: int

class SpendingLimitUpdate(BaseModel):
    offline_limit: int = Field(..., ge=10, le=10000, description="New offline spending limit")

class TransactionCreate(BaseModel):
    tx_id: str = Field(..., min_length=5)
    sender: str
    receiver: str
    amount: int = Field(..., gt=0)
    note: Optional[str] = ""
    timestamp: Optional[int] = None

class OfflineTransactionItem(BaseModel):
    tx_id: str
    sender: str
    receiver: str
    amount: int = Field(..., gt=0)
    timestamp: int
    nonce: Optional[str] = None
    signature: Optional[str] = None
    note: Optional[str] = ""

class SyncRequest(BaseModel):
    transactions: List[OfflineTransactionItem]

class SyncItemResult(BaseModel):
    tx_id: str
    status: str # 'confirmed', 'duplicate', 'rejected'
    reason: Optional[str] = None
    confirmed_at: Optional[int] = None

class SyncResponse(BaseModel):
    synced_count: int
    results: List[SyncItemResult]

class SafetyDashboardResponse(BaseModel):
    wallet_id: str
    balance: int
    offline_limit: int
    metrics: Dict[str, int]
    audit_events: List[Dict[str, Any]]
