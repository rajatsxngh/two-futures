"""M1 contract tests: every endpoint answers with its declared shape."""

from fastapi.testclient import TestClient

from app.main import app
from app.models import AccountType

client = TestClient(app)

WHAT_IF = {"description": "What if I take the Austin job?", "preset": "new_job",
           "income_change_yearly": 8000, "spending_change_monthly": 300}
TRANSFER = {"amount": 150, "from_account_id": "spend", "to_account_id": "reserve", "frequency": "payday"}


def test_get_endpoints_return_200():
    for path in ("/api/ping", "/api/profile", "/api/health", "/api/forecast", "/api/futures"):
        assert client.get(path).status_code == 200, path


def test_maya_score_is_55_in_fixture():
    body = client.get("/api/health").json()
    assert body["score"]["value"] == 55
    assert body["band"] == "coping"
    assert [p["score"]["value"] for p in body["pillars"]] == [74, 22, 55, 68]
    assert len(body["indicators"]) == 8


def test_every_metric_has_math():
    body = client.get("/api/health").json()
    for ind in body["indicators"]:
        assert ind["value"]["math"]["formula"]
        assert ind["value"]["math"]["thresholds"] is not None


def test_household_covers_all_8_account_types():
    body = client.get("/api/profile", params={"customer": "household"}).json()
    assert {a["type"] for a in body["accounts"]} == {t.value for t in AccountType}


def test_unknown_customer_is_404():
    assert client.get("/api/profile", params={"customer": "nobody"}).status_code == 404


def test_update_plan_returns_sentence():
    body = client.post("/api/update_plan", json=WHAT_IF).json()
    assert body["path"] == "plan"
    assert "$170" in body["sentence"]


def test_transfer_needs_clear_yes():
    assert client.post("/api/start_transfer", json={**TRANSFER, "confirmed": False}).status_code == 400
    ok = client.post("/api/start_transfer", json={**TRANSFER, "confirmed": True})
    assert ok.status_code == 200
    assert ok.json()["status"] == "scheduled"


def test_reset():
    assert client.post("/api/reset").json() == {"ok": True, "customer": "maya"}
