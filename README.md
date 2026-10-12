# CoinPath — Offline Transaction & Safety System

CoinPath is an offline-first virtual payment and safety architecture designed for technology exhibitions, college projects, and mobile demonstrations. It enables users to perform authenticated peer-to-peer virtual payments even when internet connectivity is completely unavailable, and safely reconciles transactions with an authoritative SQLite/FastAPI backend upon reconnection.

---

## 1. Project Overview & Architecture

### Reused Frontend & Design Continuity
- **Visual Identity Preserved**: Kept the clean navy (`#0e1f38`), paper canvas (`#f4f2eb`), and subtle cyan (`#2bbfd4`) aesthetic.
- **Components Retained**: Responsive card layouts, QR code generator (`qrcode.js`), QR camera scanner (`jsQR.js`), user account manager (`store.js`), and transaction dialogs.
- **New Capabilities Added**:
  1. **Safety Dashboard**: Real-time spending limit usage meter, cryptographic verification count, duplicate detection metrics, and audit log.
  2. **Offline Spending Limit Controls**: Configurable cap preventing unauthorized or accidental overspending while offline.
  3. **Alerts & SMS Notifications Center**: In-app notifications and SMS alerts dispatched only after authoritative server confirmation.
  4. **Cryptographic Signing Engine (`js/offlineApi.js`)**: Web Crypto API (ECDSA/HMAC) signing, IndexedDB persistence, and duplicate protection.

---

## 2. Directory & File Structure

```
├── backend/
│   ├── main.py                     # FastAPI application entry point with CORS
│   ├── database.py                 # SQLite database engine with WAL mode & transactions
│   ├── schemas.py                  # Pydantic request/response models
│   ├── routers/
│   │   ├── wallets.py              # Wallet balance, profile & limit endpoints
│   │   ├── transactions.py         # Online payment & idempotent offline sync
│   │   ├── safety.py               # Safety dashboard metrics & audit history
│   │   └── notifications.py        # Notification listing & read status
│   ├── services/
│   │   ├── crypto.py               # Signature verification and hash algorithms
│   │   └── sms.py                  # SMS dispatcher (Twilio & Mock mode)
│   ├── tests/
│   │   └── test_transactions.py    # Unit & integration test suite (unittest)
│   └── requirements.txt            # Python dependencies
├── css/
│   └── style.css                   # Responsive layout & theme styles
├── js/
│   ├── vendor/
│   │   ├── qrcode.js               # Client-side QR code generator
│   │   └── jsQR.js                 # Camera & image QR decoder
│   ├── config.js                   # Dynamic API Base URL configuration
│   ├── store.js                    # Local accounts, passwords, and balances
│   ├── offlineApi.js               # IndexedDB storage, signatures, & sync engine
│   └── app.js                      # Application routing, screens, & event handlers
├── index.html                      # HTML entry point
├── server.ts                       # Full-Stack Node/Express & SQLite server on port 3000
├── capacitor.config.json           # Capacitor Android packaging configuration
├── metadata.json                   # App capabilities & identification
├── package.json                    # Node dependencies & build scripts
├── .env.example                    # Environment variable template
└── README.md                       # Comprehensive guide
```

---

## 3. How Core Features Work

### A. Offline Transactions
1. Sender selects **Pay Offline by QR**.
2. Frontend checks the **Offline Spending Limit** against existing pending offline transactions. If the transaction exceeds the limit, creation is blocked with a clear warning.
3. A globally unique `tx_id` (e.g., `CPTX-L9X4B-A1F9`) and a random cryptographic nonce are generated.
4. The private key in IndexedDB generates a digital signature over the canonical message `COINPATH:v1|tx_id|sender|receiver|amount|timestamp|nonce`.
5. The signed payload is converted into a compact QR code.
6. The receiver scans the QR code in **Scan**. The receiver's device validates the signature and saves it into IndexedDB as **Pending Sync**.

### B. Idempotent Synchronization & Duplicate Prevention
1. When internet connectivity returns, `offlineApi.js` automatically calls `POST /api/transactions/sync`.
2. The server wraps the batch update inside an atomic SQLite transaction (`BEGIN TRANSACTION` ... `COMMIT`).
3. SQLite enforces a `UNIQUE(tx_id)` constraint on the `transactions` table.
4. **Repeated Sync Protection**: If a transaction with the same `tx_id` is submitted again, the server recognizes it, updates nothing, returns status `duplicate`, and does **not** debit the wallet a second time.
5. Confirmed transactions are marked `confirmed` and update the authoritative balances.

### C. Offline Spending Limit
- Configured through the **Safety Dashboard** or wallet settings.
- Tracked locally in IndexedDB and validated on the backend.
- Prevents unbounded exposure while disconnected from the network.

### D. SMS & In-App Notification System
- An SMS is dispatched **only** after authoritative confirmation on the server.
- Unsent or offline pending transactions never trigger an SMS.
- If Twilio credentials are not provided, CoinPath runs in **Safe Mock Mode**, outputting formatted SMS alerts to the console and in-app Notification Inbox without billing or external errors.

---

## 4. Beginner Step-by-Step Guide (Windows & VS Code)

### Prerequisites
1. **Node.js** (v18 or higher): Download from [nodejs.org](https://nodejs.org).
2. **Python** (v3.10 or higher): Download from [python.org](https://python.org). Check "Add Python to PATH" during installation.
3. **VS Code**: Download from [code.visualstudio.com](https://code.visualstudio.com).

### Step 1: Open the Project in VS Code
1. Open VS Code.
2. Select **File > Open Folder...** and select the `coinpath` folder.
3. Open a terminal via **Terminal > New Terminal** (PowerShell).

### Step 2: Run the Web Application
Run the full-stack application (frontend + built-in SQLite server):
```powershell
npm install
npm run dev
```
Open your browser at `http://localhost:3000`. You can test creating wallets, generating offline payment codes, scanning, adjusting spending limits, and syncing.

### Step 3: Run the Python FastAPI Backend (Optional / Exhibition Mode)
If you wish to run the standalone Python FastAPI backend on port 8000:
```powershell
# Create Python virtual environment
python -m venv venv
.\venv\Scripts\Activate.ps1

# Install requirements
pip install -r backend\requirements.txt

# Start FastAPI with Uvicorn
uvicorn backend.main:app --reload --port 8000
```
FastAPI Swagger documentation will be available at `http://localhost:8000/docs`.

### Step 4: Run the Verification Tests
To run the automated test suite verifying duplicate prevention, spending limits, and database rollback:
```powershell
python -m unittest discover backend/tests
```
Expected output:
```
.....
----------------------------------------------------------------------
Ran 5 tests in 0.016s
OK
```

---

## 5. Packaging as an Android App with Capacitor

To package CoinPath as an Android APK:

### 1. Build the Web Assets
```powershell
npm run build
```
This generates the optimized production files in the `/dist` folder.

### 2. Install Capacitor CLI & Android Platform
```powershell
npm install @capacitor/core @capacitor/cli @capacitor/android
npx cap init CoinPath com.coinpath.offlineapp --web-dir=dist
npx cap add android
```

### 3. Sync Web Assets with Android Project
Whenever you make updates to the HTML/CSS/JS:
```powershell
npm run build
npx cap sync
```

### 4. Open in Android Studio & Run on Phone
```powershell
npx cap open android
```
1. Android Studio will open the native project.
2. Connect your Android phone via USB with **USB Debugging** enabled (or start an Android Emulator).
3. Click the green **Run (Play)** button in Android Studio to install and run CoinPath directly on your phone!

---

## 6. Security Analysis for Technology Exhibition

| Security Measure | Status in Prototype | Production Recommendation |
| :--- | :--- | :--- |
| **Tamper-Proof Data** | Implemented via Web Crypto digital signatures | Hardware Security Module / Android Keystore backed private keys |
| **Duplicate Prevention** | Implemented via SQLite UNIQUE constraints & idempotent sync | Distributed Redis locking + transactional RDBMS |
| **Offline Spending Limit** | Implemented & enforced both on client and server | Cryptographic counter certificates signed by central authority |
| **Double Spending Mitigation** | Mitigated via device spending caps & serial server sync | Requires online consensus or secure hardware enclave (TEE) |
| **Notification Privacy** | Server-side SMS credentials & in-app inbox | End-to-end encrypted push notifications (FCM) |
