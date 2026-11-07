"""Settings shared across the back end."""

import datetime as dt
import os

from dotenv import load_dotenv

load_dotenv()

# The demo's "today". Fixed so every run (and every rehearsal) shows the same numbers.
DEMO_TODAY = dt.date(2026, 11, 8)

CUSTOMERS = ("maya", "household")

# USE_FIXTURES=1 forces every endpoint to serve app/fixtures/*.json (handy for
# front-end work without the engine). Otherwise everything runs on the engine.
USE_FIXTURES = os.getenv("USE_FIXTURES", "0") == "1"

ALLOWED_ORIGINS = os.getenv("ALLOWED_ORIGINS", "http://localhost:3000,http://127.0.0.1:3000").split(",")
