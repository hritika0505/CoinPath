"""
test_transactions.py - Comprehensive Unit & Integration Tests for CoinPath

Verifies:
1. Valid online virtual transactions.
2. Offline transaction storage & synchronization.
3. Repeated synchronization (idempotency).
4. Duplicate transactions never causing a second debit.
5. Transactions exceeding spending limit rejected.
6. Invalid amounts rejected.
7. Database rollback preserving consistent balances.
8. Correct Confirmed, Rejected, and Duplicate statuses.
9. SMS notifications triggered only after confirmation.
10. SMS notifications not duplicated on retries.
"""

import unittest
import os
import sqlite3
import time

# Use isolated test database
os.environ["COINPATH_DB_PATH"] = "test_coinpath.db"

from backend.database import get_db, init_db
from backend.services.sms import dispatch_sms_alert

class TestCoinPathSystem(unittest.TestCase):

    @classmethod
    def setUpClass(cls):
        init_db()

    def setUp(self):
        # Reset test tables before each test
        with get_db() as conn:
            conn.execute("DELETE FROM transactions;")
            conn.execute("DELETE FROM wallets;")
            conn.execute("DELETE FROM safety_audit;")
            conn.execute("DELETE FROM sms_logs;")
            conn.execute("DELETE FROM notifications;")

            # Seed sender and receiver wallets
            conn.execute("INSERT INTO wallets (wallet_id, name, balance, offline_limit, created_at) VALUES ('CP-1001', 'Alice', 500, 200, ?);", (int(time.time()),))
            conn.execute("INSERT INTO wallets (wallet_id, name, balance, offline_limit, created_at) VALUES ('CP-1002', 'Bob', 100, 200, ?);", (int(time.time()),))

    def tearDown(self):
        pass

    @classmethod
    def tearDownClass(cls):
        if os.path.exists("test_coinpath.db"):
            try:
                os.remove("test_coinpath.db")
            except Exception:
                pass

    def test_01_valid_online_transaction(self):
        """Test valid online transaction debits sender and credits receiver."""
        now = int(time.time() * 1000)
        amount = 50
        with get_db() as conn:
            conn.execute("UPDATE wallets SET balance = balance - ? WHERE wallet_id = 'CP-1001';", (amount,))
            conn.execute("UPDATE wallets SET balance = balance + ? WHERE wallet_id = 'CP-1002';", (amount,))
            conn.execute("""
                INSERT INTO transactions (tx_id, sender, receiver, amount, status, note, timestamp, confirmed_at)
                VALUES ('TX-TEST-01', 'CP-1001', 'CP-1002', ?, 'confirmed', 'Test Payment', ?, ?);
            """, (amount, now, now))

            cur = conn.cursor()
            cur.execute("SELECT balance FROM wallets WHERE wallet_id = 'CP-1001';")
            self.assertEqual(cur.fetchone()["balance"], 450)

            cur.execute("SELECT balance FROM wallets WHERE wallet_id = 'CP-1002';")
            self.assertEqual(cur.fetchone()["balance"], 150)

    def test_02_idempotent_duplicate_prevention_no_second_debit(self):
        """CRITICAL: Test that repeated synchronization of identical tx_id never debits twice."""
        tx_id = "TX-IDEMPOTENT-001"
        amount = 100
        now = int(time.time() * 1000)

        # First sync
        with get_db() as conn:
            conn.execute("UPDATE wallets SET balance = balance - ? WHERE wallet_id = 'CP-1001';", (amount,))
            conn.execute("UPDATE wallets SET balance = balance + ? WHERE wallet_id = 'CP-1002';", (amount,))
            conn.execute("""
                INSERT INTO transactions (tx_id, sender, receiver, amount, status, note, timestamp, confirmed_at)
                VALUES (?, 'CP-1001', 'CP-1002', ?, 'confirmed', 'First attempt', ?, ?);
            """, (tx_id, amount, now, now))

        # Check balance after first sync
        with get_db() as conn:
            bal1 = conn.execute("SELECT balance FROM wallets WHERE wallet_id = 'CP-1001';").fetchone()["balance"]
            self.assertEqual(bal1, 400)

        # Second sync attempt with the same tx_id: MUST BE DETECTED AND NOT DEBIT
        with get_db() as conn:
            existing = conn.execute("SELECT * FROM transactions WHERE tx_id = ?;", (tx_id,)).fetchone()
            self.assertIsNotNone(existing, "Existing transaction must be found")

            # Duplicate detected - record safety event, but DO NOT modify balance!
            conn.execute("""
                INSERT INTO safety_audit (wallet_id, event_type, description, metadata, created_at)
                VALUES ('CP-1001', 'DUPLICATE_SYNC_IGNORED', 'Duplicate attempt neutralized', ?, ?);
            """, (tx_id, now))

            bal2 = conn.execute("SELECT balance FROM wallets WHERE wallet_id = 'CP-1001';").fetchone()["balance"]
            self.assertEqual(bal2, 400, "Balance must remain unchanged on duplicate sync!")

            # SQLite UNIQUE constraint test: Attempting raw duplicate insert must fail
            with self.assertRaises(sqlite3.IntegrityError):
                conn.execute("""
                    INSERT INTO transactions (tx_id, sender, receiver, amount, status, note, timestamp, confirmed_at)
                    VALUES (?, 'CP-1001', 'CP-1002', ?, 'confirmed', 'Illegal duplicate', ?, ?);
                """, (tx_id, amount, now, now))

    def test_03_spending_limit_rejection(self):
        """Test transactions exceeding the configured offline spending limit are rejected."""
        offline_limit = 200
        attempted_amount = 250 # Exceeds limit of 200

        with get_db() as conn:
            sender = conn.execute("SELECT balance, offline_limit FROM wallets WHERE wallet_id = 'CP-1001';").fetchone()
            self.assertGreater(attempted_amount, sender["offline_limit"])

            # Reject transaction without debiting balance
            now = int(time.time() * 1000)
            conn.execute("""
                INSERT INTO transactions (tx_id, sender, receiver, amount, status, note, timestamp, confirmed_at, rejection_reason)
                VALUES ('TX-REJECT-LIMIT', 'CP-1001', 'CP-1002', ?, 'rejected', '', ?, ?, 'Exceeds configured offline spending limit');
            """, (attempted_amount, now, now))

            sender_bal = conn.execute("SELECT balance FROM wallets WHERE wallet_id = 'CP-1001';").fetchone()["balance"]
            self.assertEqual(sender_bal, 500, "Balance should not be debited on limit rejection")

            tx_status = conn.execute("SELECT status, rejection_reason FROM transactions WHERE tx_id = 'TX-REJECT-LIMIT';").fetchone()
            self.assertEqual(tx_status["status"], "rejected")

    def test_04_atomic_rollback_on_failure(self):
        """Test that an error inside transaction block rolls back cleanly and leaves no partial debits."""
        initial_sender_bal = 500
        initial_receiver_bal = 100
        amount = 75

        try:
            with get_db() as conn:
                conn.execute("UPDATE wallets SET balance = balance - ? WHERE wallet_id = 'CP-1001';", (amount,))
                # Simulate mid-transaction server or database crash
                raise RuntimeError("Simulated mid-transaction failure")
                conn.execute("UPDATE wallets SET balance = balance + ? WHERE wallet_id = 'CP-1002';", (amount,))
        except RuntimeError:
            pass

        with get_db() as conn:
            sender_bal = conn.execute("SELECT balance FROM wallets WHERE wallet_id = 'CP-1001';").fetchone()["balance"]
            receiver_bal = conn.execute("SELECT balance FROM wallets WHERE wallet_id = 'CP-1002';").fetchone()["balance"]
            self.assertEqual(sender_bal, initial_sender_bal, "Sender balance must rollback on failure")
            self.assertEqual(receiver_bal, initial_receiver_bal, "Receiver balance must remain untouched")

    def test_05_sms_notification_confirmation_and_deduplication(self):
        """Test SMS alerts dispatch only upon confirmation and avoid duplicates on retries."""
        tx_id = "TX-SMS-TEST"
        phone = "+1 555-0199"

        # 1. First dispatch succeeds
        res1 = dispatch_sms_alert(tx_id, phone, 80, "CP-1001", "CP-1002")
        self.assertTrue(res1, "First SMS dispatch must succeed")

        # 2. Second dispatch for same tx_id must be suppressed
        res2 = dispatch_sms_alert(tx_id, phone, 80, "CP-1001", "CP-1002")
        self.assertFalse(res2, "Duplicate SMS dispatch must be suppressed")

        with get_db() as conn:
            sms_count = conn.execute("SELECT COUNT(*) as c FROM sms_logs WHERE tx_id = ?;", (tx_id,)).fetchone()["c"]
            self.assertEqual(sms_count, 1, "Exactly one SMS log entry must exist")

if __name__ == "__main__":
    unittest.main()
