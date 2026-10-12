"""
main.py - CoinPath FastAPI Backend Application Entry Point
"""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from backend.database import init_db
from backend.routers import wallets, transactions, safety, notifications

# Initialize SQLite database tables on startup
init_db()

app = FastAPI(
    title="CoinPath API",
    description="Offline-First Virtual Transaction & Safety System Backend",
    version="1.0.0"
)

# Enable CORS for local dev server and Capacitor Android webview
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Mount modular routers
app.include_router(wallets.router)
app.include_router(transactions.router)
app.include_router(safety.router)
app.include_router(notifications.router)

@app.get("/api/health", tags=["Health"])
def health_check():
    return {
        "status": "healthy",
        "service": "CoinPath FastAPI Backend",
        "database": "SQLite",
        "version": "1.0.0"
    }

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("backend.main:app", host="0.0.0.0", port=8000, reload=True)
