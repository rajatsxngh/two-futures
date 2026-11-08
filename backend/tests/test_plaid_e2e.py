"""End to end against the real Plaid sandbox: public token -> exchange -> customer -> every engine endpoint.

Skipped automatically when the Plaid keys aren't available (frontend/.env.local or the environment), so
offline runs still pass. Uses /sandbox/public_token/create instead of the Link UI (testing only).
"""

import pytest
from fastapi.testclient import TestClient

from app import connected, plaid_client
from app.main import app

ready, why = plaid_client.configured()
pytestmark = pytest.mark.skipif(not ready, reason=f"Plaid sandbox not configured: {why}")

client = TestClient(app)


def test_sandbox_bank_end_to_end():
    try:
        public_token = plaid_client.sandbox_public_token()  # First Platypus Bank, user_good
        r = client.post("/api/plaid/exchange", json={"public_token": public_token})
        assert r.status_code == 200, r.json().get("detail")
        summary = r.json()
        assert summary["customer"] == "sandbox" and summary["institution"]
        assert summary["accounts"] and summary["transactions"] > 0
        assert "access" not in r.text  # no token comes back

        status = client.get("/api/plaid/status").json()
        assert status["configured"] and status["connection"]["customer"] == "sandbox"

        q = {"customer": "sandbox"}
        for path in ("/api/profile", "/api/health"):
            assert client.get(path, params=q).status_code == 200, path
        if summary["forecast_ready"]:
            for path in ("/api/forecast", "/api/futures"):
                assert client.get(path, params=q).status_code == 200, path
        bt = client.get("/api/backtest", params=q)
        assert bt.status_code == (200 if summary["backtest_ready"] else 422)
        assert client.post("/api/update_plan", json={"customer": "sandbox", "description": "spend less",
                                                     "spending_change_monthly": -100}).status_code == (
            200 if summary["forecast_ready"] else 422)

        # a made-up public token: a plain error from Plaid's code, nothing raw
        bad = client.post("/api/plaid/exchange", json={"public_token": "public-sandbox-00000000-0000-0000-0000-000000000000"})
        assert bad.status_code in (400, 502) and "error_message" not in bad.text
    finally:
        client.post("/api/plaid/disconnect")
    assert client.get("/api/profile", params={"customer": "sandbox"}).status_code == 404
    assert connected.current() is None
