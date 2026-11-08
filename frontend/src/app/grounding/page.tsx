"use client";

/**
 * Grounding test bench (M10): runs the 10-question list against the saved
 * answers (offline) or the live ElevenLabs agent (text mode), and scores
 * "N of 10 grounded" + "N of 10 behaved". Resets the demo before and after.
 */
import { ConversationProvider, useConversationControls } from "@elevenlabs/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, type FuturesResponse, type PathId } from "@/lib/api";
import { baseCorpus, judge, TESTS, type GResult, type GTest, type TestRun, type ToolCall, type Turn } from "@/lib/grounding";
import { newMemory, savedReply } from "@/components/voice/savedAgent";
import { toTransferInput, toUpdatePlanInput, transferReply, updatePlanReply } from "@/components/voice/toolReplies";
import type { VoiceTools } from "@/components/voice";

type Mode = "saved" | "live";

/** Tools that hit the real engine and remember what the agent was told. */
function recordingTools(log: ToolCall[]): VoiceTools {
  return {
    updatePlan: async (input) => {
      const res = await api.updatePlan({ ...input, customer: "maya" });
      log.push({ name: "update_plan", params: input as Record<string, unknown>, reply: updatePlanReply(res) });
      return res;
    },
    startTransfer: async (input) => {
      const res = await api.startTransfer({ ...input, customer: "maya" });
      log.push({ name: "start_transfer", params: input as Record<string, unknown>, reply: transferReply(res) });
      return res;
    },
    highlightMetric: (metricId) => {
      log.push({ name: "highlight_metric", params: { metric_id: metricId } });
    },
  };
}

async function runSaved(test: GTest): Promise<{ run: TestRun; futures: FuturesResponse }> {
  const turns: Turn[] = [];
  let futures = await api.futures("maya");
  const first = futures;
  for (const seg of test.segments) {
    const memory = newMemory();
    turns.push({ path: seg.path, question: null, reply: futures.fact_sheets[seg.path].opening_line, tools: [] });
    for (const q of seg.questions) {
      const log: ToolCall[] = [];
      const { reply } = await savedReply(q, { path: seg.path, futures, tools: recordingTools(log), memory });
      turns.push({ path: seg.path, question: q, reply, tools: log });
      futures = await api.futures("maya");
    }
  }
  return { run: { turns }, futures: first };
}

export default function GroundingPage() {
  return (
    <ConversationProvider>
      <Bench />
    </ConversationProvider>
  );
}

function Bench() {
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [results, setResults] = useState<GResult[]>([]);
  const [running, setRunning] = useState<Mode | null>(null);
  const [current, setCurrent] = useState<string>("");
  const live = useLiveRunner();

  useEffect(() => {
    fetch("/api/voice/signed-url?check=1", { cache: "no-store" })
      .then((r) => r.json())
      .then((b: { configured?: boolean }) => setConfigured(Boolean(b.configured)))
      .catch(() => setConfigured(false));
  }, []);

  const run = async (mode: Mode) => {
    setRunning(mode);
    setResults([]);
    await api.reset("maya");
    const out: GResult[] = [];
    for (const test of TESTS) {
      setCurrent(`#${test.n} ${test.label}`);
      try {
        const { run: r, futures } = mode === "saved" ? await runSaved(test) : await live(test);
        const corpus = baseCorpus(futures, test.segments.flatMap((s) => s.questions));
        out.push(judge(test, r, corpus));
      } catch (e) {
        out.push({ test, run: { turns: [] }, ungrounded: [], failure: "Didn't finish", error: String(e) });
      }
      setResults([...out]);
      await api.reset("maya"); // each test starts from the same state
    }
    setCurrent("");
    setRunning(null);
  };

  const grounded = results.filter((r) => !r.error && r.ungrounded.length === 0).length;
  const behaved = results.filter((r) => !r.error && r.failure === null).length;

  return (
    <main className="mx-auto w-full max-w-4xl p-6 font-sans text-navy">
      <h1 className="text-2xl font-semibold">Grounding test</h1>
      <p className="mt-1 text-sm text-muted">
        The 10 questions from <code>agent/future-maya-setup.md</code>. Grounded = every dollar amount and year she says appears in her fact
        sheets, a tool result or the question. Behaved = the test&apos;s own rule. The demo is reset before and after each test.
      </p>
      <div className="mt-4 flex flex-wrap gap-2">
        <button disabled={running !== null} onClick={() => void run("saved")} className="rounded-full bg-navy px-4 py-2 text-sm font-semibold text-white disabled:opacity-40">
          Run with saved answers
        </button>
        <button
          disabled={running !== null || !configured}
          onClick={() => void run("live")}
          title={configured ? "" : "Add ELEVENLABS_API_KEY and ELEVENLABS_AGENT_ID first"}
          className="rounded-full bg-accent px-4 py-2 text-sm font-semibold text-white disabled:opacity-40"
        >
          Run with live agent (text mode)
        </button>
        {configured === false && <span className="self-center text-xs text-muted">Live agent needs ElevenLabs keys.</span>}
      </div>

      {results.length > 0 && (
        <p className="mt-6 text-3xl font-semibold" data-testid="grounding-score">
          {grounded} of {results.length} grounded · {behaved} of {results.length} behaved
          {running && <span className="ml-3 text-sm font-normal text-muted">running {current}…</span>}
        </p>
      )}

      <ol className="mt-4 space-y-3">
        {results.map((r) => {
          const ok = !r.error && r.ungrounded.length === 0 && r.failure === null;
          return (
            <li key={r.test.n} className={`rounded-xl border p-3 ${ok ? "border-ok/30 bg-ok/5" : "border-bad/30 bg-bad/5"}`}>
              <p className="text-sm font-semibold">
                {ok ? "PASS" : "FAIL"} · #{r.test.n} {r.test.label}
              </p>
              {r.error && <p className="text-xs text-bad">{r.error}</p>}
              {r.ungrounded.length > 0 && <p className="text-xs text-bad">Not in her facts: {r.ungrounded.join(", ")}</p>}
              {r.failure && <p className="text-xs text-bad">{r.failure}</p>}
              <ul className="mt-2 space-y-1 text-xs">
                {r.run.turns.map((t, i) => (
                  <li key={i}>
                    <span className="font-semibold text-muted">{t.path === "plan" ? "Plan" : "Same"}</span>
                    {t.question ? <> · You: {t.question} → </> : " · (opening) "}
                    <span>{t.reply}</span>
                    {t.tools.length > 0 && <span className="text-muted"> [{t.tools.map((c) => c.name).join(", ")}]</span>}
                  </li>
                ))}
              </ul>
            </li>
          );
        })}
      </ol>
    </main>
  );
}

// ---------------------------------------------------------------------------
// live runner: one ElevenLabs text session per segment
// ---------------------------------------------------------------------------

const REPLY_TIMEOUT_MS = 25000;

function useLiveRunner() {
  const controls = useConversationControls();
  const waiter = useRef<((text: string) => void) | null>(null);
  const backlog = useRef<string[]>([]);
  const log = useRef<ToolCall[]>([]);

  const nextAgentMessage = useCallback(
    () =>
      new Promise<string>((resolve, reject) => {
        const queued = backlog.current.shift();
        if (queued !== undefined) return resolve(queued);
        const t = setTimeout(() => {
          waiter.current = null;
          reject(new Error("No reply within 25 s"));
        }, REPLY_TIMEOUT_MS);
        waiter.current = (text) => {
          clearTimeout(t);
          waiter.current = null;
          resolve(text);
        };
      }),
    [],
  );

  return useCallback(
    async (test: GTest): Promise<{ run: TestRun; futures: FuturesResponse }> => {
      const turns: Turn[] = [];
      const first = await api.futures("maya");
      for (const seg of test.segments) {
        const futures = await api.futures("maya");
        const res = await fetch("/api/voice/signed-url", { cache: "no-store" });
        const body = (await res.json()) as { signedUrl?: string; detail?: string };
        if (!body.signedUrl) throw new Error(body.detail ?? "No signed URL");
        backlog.current = [];
        log.current = [];
        const tools = recordingTools(log.current);
        const path: PathId = seg.path;
        const sheet = futures.fact_sheets[path];
        let connected: () => void = () => {};
        const ready = new Promise<void>((r) => (connected = r));
        controls.startSession({
          signedUrl: body.signedUrl,
          connectionType: "websocket",
          textOnly: true,
          dynamicVariables: { path, fact_sheet: sheet.text, opening_line: sheet.opening_line },
          clientTools: {
            update_plan: async (p: Record<string, unknown>) => {
              if (path !== "plan") return "Not available: you are the same-path future.";
              const r = await tools.updatePlan(toUpdatePlanInput(p));
              return updatePlanReply(r);
            },
            start_transfer: async (p: Record<string, unknown>) => {
              const input = toTransferInput(p);
              if (!input) return "Not scheduled. You need a clear yes first.";
              return transferReply(await tools.startTransfer(input));
            },
            highlight_metric: (p: Record<string, unknown>) => {
              tools.highlightMetric?.(String(p.metric_id ?? ""));
            },
          },
          onConnect: () => connected(),
          onMessage: ({ message, role }) => {
            if (role !== "agent" || !message) return;
            if (waiter.current) waiter.current(message);
            else backlog.current.push(message);
          },
        });
        await ready;
        const opening = await nextAgentMessage();
        turns.push({ path, question: null, reply: opening, tools: [] });
        for (const q of seg.questions) {
          const before = log.current.length;
          controls.sendUserMessage(q);
          const reply = await nextAgentMessage();
          turns.push({ path, question: q, reply, tools: log.current.slice(before) });
        }
        controls.endSession();
      }
      return { run: { turns }, futures: first };
    },
    [controls, nextAgentMessage],
  );
}
