"""Create the Future Maya agent in ElevenLabs from the files in agent/, and save its id.

    npm run agent:create          (from the repo root)

Reads ELEVENLABS_API_KEY from frontend/.env.local (or the environment), creates
the three client tools from agent/tools.json, creates the agent with the
system prompt, first message {{opening_line}}, dynamic variables, a voice, and
authentication on (the app connects through a signed URL), then writes
ELEVENLABS_AGENT_ID into frontend/.env.local.

The key is never printed. Re-running when an agent id is already saved does
nothing unless you pass --force (which creates a new agent).

Optional overrides (environment or .env.local): ELEVENLABS_VOICE_ID, ELEVENLABS_LLM.
"""

from __future__ import annotations

import json
import os
import re
import sys
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
ENV_FILE = ROOT / "frontend" / ".env.local"
AGENT_DIR = ROOT / "agent"
API = "https://api.elevenlabs.io/v1/convai"

# A warm library voice (ElevenLabs' documented default). Never a clone of a real person.
DEFAULT_VOICE = "cjVigY5qzO86Huf0OWal"


def read_env() -> dict[str, str]:
    values: dict[str, str] = {}
    if ENV_FILE.exists():
        for line in ENV_FILE.read_text(encoding="utf-8").splitlines():
            m = re.match(r"^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$", line)
            if m and not line.lstrip().startswith("#"):
                values[m.group(1)] = m.group(2).strip().strip('"').strip("'")
    for k in ("ELEVENLABS_API_KEY", "ELEVENLABS_AGENT_ID", "ELEVENLABS_VOICE_ID", "ELEVENLABS_LLM"):
        if os.environ.get(k):
            values[k] = os.environ[k]
    return values


def save_agent_id(agent_id: str) -> None:
    text = ENV_FILE.read_text(encoding="utf-8") if ENV_FILE.exists() else ""
    if re.search(r"^ELEVENLABS_AGENT_ID=.*$", text, flags=re.M):
        text = re.sub(r"^ELEVENLABS_AGENT_ID=.*$", f"ELEVENLABS_AGENT_ID={agent_id}", text, flags=re.M)
    else:
        text = text.rstrip("\n") + f"\nELEVENLABS_AGENT_ID={agent_id}\n"
    ENV_FILE.write_text(text, encoding="utf-8")


def post(path: str, body: dict, key: str) -> dict:
    req = urllib.request.Request(
        f"{API}{path}", data=json.dumps(body).encode("utf-8"), method="POST",
        headers={"xi-api-key": key, "Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as res:
            return json.loads(res.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8", errors="replace")[:2000]
        hint = {401: "The API key was rejected. Check it in frontend/.env.local.",
                403: "The key doesn't have access to Agents (ElevenAgents / Conversational AI). Give it that permission."
                }.get(e.code, "")
        sys.exit(f"ElevenLabs returned {e.code} for {path}. {hint}\n{detail}")
    except urllib.error.URLError as e:
        sys.exit(f"Couldn't reach ElevenLabs: {e.reason}")


CLIENT_EVENTS = ["audio", "interruption", "agent_response", "user_transcript", "agent_response_correction",
                 "agent_tool_response", "agent_chat_response_part"]


def request(method: str, path: str, key: str, body: dict | None = None) -> dict:
    req = urllib.request.Request(
        f"{API}{path}", data=json.dumps(body).encode("utf-8") if body is not None else None, method=method,
        headers={"xi-api-key": key, "Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as res:
            return json.loads(res.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        sys.exit(f"ElevenLabs returned {e.code} for {method} {path}.\n{e.read().decode('utf-8', errors='replace')[:2000]}")


TURN_TIMEOUT_SECS = 20  # how long she waits for you to speak before re-engaging (push-to-talk needs room)


def update(env: dict[str, str], key: str) -> None:
    """Push agent/ to the saved agent: system prompt, tool definitions, caption events and turn timing."""
    agent_id = env.get("ELEVENLABS_AGENT_ID")
    if not agent_id:
        sys.exit("No ELEVENLABS_AGENT_ID saved yet. Run `npm run agent:create` first.")
    current = request("GET", f"/agents/{agent_id}", key)
    prompt_cfg = dict(current["conversation_config"]["agent"]["prompt"])
    prompt_cfg["prompt"] = (AGENT_DIR / "future-maya-system-prompt.txt").read_text(encoding="utf-8")

    # tools: match the agent's attached tools by name and push agent/tools.json over them
    wanted = {t["name"]: {k: v for k, v in t.items() if not k.startswith("_")}
              for t in json.loads((AGENT_DIR / "tools.json").read_text(encoding="utf-8"))["tools"]}
    for tool_id in prompt_cfg.get("tool_ids") or []:
        name = request("GET", f"/tools/{tool_id}", key)["tool_config"]["name"]
        if name in wanted:
            request("PATCH", f"/tools/{tool_id}", key, {"tool_config": wanted.pop(name)})
            print(f"updated tool {name}")
    if wanted:
        print(f"warning: not attached to the agent, so not updated: {', '.join(wanted)}")

    request("PATCH", f"/agents/{agent_id}", key, {"conversation_config": {
        "agent": {"prompt": {k: prompt_cfg[k] for k in ("prompt", "llm", "temperature", "tool_ids") if k in prompt_cfg}},
        "conversation": {"client_events": CLIENT_EVENTS},
        "turn": {"turn_timeout": TURN_TIMEOUT_SECS},
    }})
    print(f"updated agent {agent_id}: system prompt pushed ({len(prompt_cfg['prompt'])} chars), "
          f"streaming captions on, turn timeout {TURN_TIMEOUT_SECS}s")


def main() -> None:
    env = read_env()
    key = env.get("ELEVENLABS_API_KEY", "")
    if not key:
        sys.exit(f"No ELEVENLABS_API_KEY found. Paste your key into {ENV_FILE.relative_to(ROOT)} after "
                 "ELEVENLABS_API_KEY= and run this again.")
    if "--update" in sys.argv:
        update(env, key)
        return
    if env.get("ELEVENLABS_AGENT_ID") and "--force" not in sys.argv:
        print(f"An agent id is already saved ({env['ELEVENLABS_AGENT_ID']}). Nothing to do. "
              "Pass --force to create a new agent.")
        return

    tools = json.loads((AGENT_DIR / "tools.json").read_text(encoding="utf-8"))["tools"]
    tool_ids = []
    for t in tools:
        cfg = {k: v for k, v in t.items() if not k.startswith("_")}
        res = post("/tools", {"tool_config": cfg}, key)
        tool_ids.append(res["id"])
        print(f"created tool {cfg['name']}: {res['id']}")

    prompt = (AGENT_DIR / "future-maya-system-prompt.txt").read_text(encoding="utf-8")
    agent_prompt: dict = {"prompt": prompt, "temperature": 0.2, "tool_ids": tool_ids}
    if env.get("ELEVENLABS_LLM"):
        agent_prompt["llm"] = env["ELEVENLABS_LLM"]
    body = {
        "name": "Future Maya (Two Futures demo)",
        "tags": ["hackutd", "future-you"],
        "conversation_config": {
            "agent": {
                "first_message": "{{opening_line}}",
                "language": "en",
                "dynamic_variables": {"dynamic_variable_placeholders": {
                    "path": "plan",
                    "fact_sheet": "No facts were loaded. Say you can't see your numbers right now.",
                    "opening_line": "Hey... it's me. Well, it's you, five years from now.",
                }},
                "prompt": agent_prompt,
            },
            "tts": {"voice_id": env.get("ELEVENLABS_VOICE_ID") or DEFAULT_VOICE},
        },
        "platform_settings": {
            "auth": {"enable_auth": True},  # private agent: the app connects with a signed URL
            "overrides": {"conversation_config_override": {"conversation": {"text_only": True}}},
        },
    }
    res = post("/agents/create", body, key)
    agent_id = res["agent_id"]
    save_agent_id(agent_id)
    print(f"created agent: {agent_id}")
    print(f"saved ELEVENLABS_AGENT_ID to {ENV_FILE.relative_to(ROOT)}")
    print(f"open it: https://elevenlabs.io/app/agents/agents/{agent_id}")
    print("Next: restart `npm run dev`, then open http://localhost:3000/checklist")


if __name__ == "__main__":
    main()
