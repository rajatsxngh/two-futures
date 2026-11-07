"use client";

/**
 * /voice-lab: test bench for the Future Maya voice agent (M8 build half).
 * Loads the engine's fact sheets, lets you pick a path, talk or type, read
 * captions, and see every client tool call. Tool handlers here are stubs that
 * call the API directly; M8's wire step swaps in the screens' functions.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { VoiceSession, type ToolEvent, type VoiceTools } from "@/components/voice";
import { toTransferInput, toUpdatePlanInput, transferReply, updatePlanReply } from "@/components/voice/toolReplies";
import { api, type FactSheet, type FuturesResponse, type Metric, type PathId } from "@/lib/api";

type Config = { configured: boolean; missing: string[] } | null;

const PATHS: { id: PathId; label: string; tone: string }[] = [
  { id: "same_path", label: "Same path", tone: "bg-slate-500" },
  { id: "plan", label: "With a plan", tone: "bg-orange-500" },
];

const AUSTIN = {
  description: "What if I take the Austin job? $8,000 more a year, but rent is $300 higher.",
  preset: "new_job",
  income_change_yearly: 8000,
  spending_change_monthly: 300,
};
const TRANSFER = { amount: 150, from_account_id: "spend", to_account_id: "reserve", frequency: "payday", confirmed: true };

export default function VoiceLabPage() {
  const [config, setConfig] = useState<Config>(null);
  const [futures, setFutures] = useState<FuturesResponse | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [path, setPath] = useState<PathId>("plan");
  // The plan fact sheet changes after a what-if; the next session gets the new one.
  const [planSheet, setPlanSheet] = useState<FactSheet | null>(null);
  const [planNumbers, setPlanNumbers] = useState<Metric[] | null>(null);
  const [highlight, setHighlight] = useState<string | null>(null);
  const [log, setLog] = useState<ToolEvent[]>([]);
  const [status, setStatus] = useState("idle");
  const dryCount = useRef(0);
  const highlightTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const f = await api.futures();
      setFutures(f);
      setPlanSheet(f.fact_sheets.plan);
      setPlanNumbers(f.paths.plan.key_numbers);
    } catch (e) {
      setLoadError(String(e));
    }
  }, []);

  useEffect(() => {
    let alive = true;
    fetch("/api/voice/signed-url?check=1", { cache: "no-store" })
      .then((r) => r.json())
      .then((c: Config) => alive && setConfig(c))
      .catch(() => alive && setConfig({ configured: false, missing: ["ELEVENLABS_API_KEY", "ELEVENLABS_AGENT_ID"] }));
    void Promise.resolve().then(() => {
      if (alive) void load();
    });
    return () => {
      alive = false;
    };
  }, [load]);

  const tools: VoiceTools = useMemo(
    () => ({
      updatePlan: async (input) => {
        const res = await api.updatePlan({ ...input, customer: "maya" });
        setPlanSheet(res.fact_sheet);
        setPlanNumbers(res.result.key_numbers);
        return res;
      },
      startTransfer: (input) => api.startTransfer({ ...input, customer: "maya" }),
      highlightMetric: (id) => {
        setHighlight(id);
        clearTimeout(highlightTimer.current);
        highlightTimer.current = setTimeout(() => setHighlight(null), 2500);
      },
    }),
    [],
  );

  const onToolEvent = useCallback((e: ToolEvent) => setLog((l) => [e, ...l].slice(0, 50)), []);

  // Run the same handlers without ElevenLabs, to check the app side of each tool.
  const dryRun = async (name: "update_plan" | "start_transfer" | "highlight_metric") => {
    const id = `dry_${Date.now()}_${(dryCount.current += 1)}`;
    const params: Record<string, unknown> =
      name === "update_plan" ? AUSTIN : name === "start_transfer" ? TRANSFER : { metric_id: `${path}.2031.ira` };
    const base = { id, name, path, params, at: Date.now() } as const;
    onToolEvent({ ...base, phase: "called" });
    const t0 = performance.now();
    try {
      if (name === "update_plan") {
        if (path !== "plan") return onToolEvent({ ...base, phase: "refused", reply: "Same path: update_plan is refused." });
        const res = await tools.updatePlan(toUpdatePlanInput(params));
        onToolEvent({ ...base, phase: "ok", reply: updatePlanReply(res), result: res, ms: Math.round(performance.now() - t0) });
      } else if (name === "start_transfer") {
        const input = toTransferInput(params);
        if (!input) return onToolEvent({ ...base, phase: "refused" });
        const res = await tools.startTransfer(input);
        onToolEvent({ ...base, phase: "ok", reply: transferReply(res), result: res, ms: Math.round(performance.now() - t0) });
      } else {
        tools.highlightMetric?.(String(params.metric_id));
        onToolEvent({ ...base, phase: "ok" });
      }
    } catch (e) {
      onToolEvent({ ...base, phase: "error", error: String(e) });
    }
  };

  const reset = async () => {
    try {
      await api.reset();
      setLog([]);
      await load();
    } catch (e) {
      setLoadError(String(e));
    }
  };

  const factSheet = futures ? (path === "plan" ? (planSheet ?? futures.fact_sheets.plan) : futures.fact_sheets.same_path) : null;
  const keyNumbers = futures ? (path === "plan" ? (planNumbers ?? futures.paths.plan.key_numbers) : futures.paths.same_path.key_numbers) : [];

  return (
    <div className="flex-1 bg-slate-100">
    <main className="mx-auto grid w-full max-w-6xl gap-6 p-4 text-[#1b2a4a] md:grid-cols-[400px_1fr] md:p-8">
      <header className="md:col-span-2">
        <h1 className="text-2xl font-bold">Voice lab</h1>
        <p className="text-sm text-slate-600">
          Future Maya test bench: pick a path, talk or type, watch captions and tool calls. Status: <b>{status}</b>
        </p>
      </header>

      {config && !config.configured && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm md:col-span-2" role="alert">
          <p className="font-semibold">Live voice is off: add ELEVENLABS_API_KEY and ELEVENLABS_AGENT_ID.</p>
          <p className="mt-1">
            Put them in <code>frontend/.env.local</code> (missing: {config.missing.join(", ")}), then restart{" "}
            <code>npm run dev</code>. Create the agent by following <code>agent/future-maya-setup.md</code>. The tool
            dry-run buttons below still work without a key.
          </p>
        </div>
      )}
      {loadError && (
        <div className="rounded-xl border border-red-300 bg-red-50 p-4 text-sm md:col-span-2" role="alert">
          Couldn&apos;t load fact sheets from the API ({loadError}). Is the backend running (<code>npm run dev</code>)?{" "}
          <button className="underline" onClick={() => void load()}>
            Retry
          </button>
        </div>
      )}

      {/* Phone-sized session column */}
      <section className="flex flex-col gap-4 rounded-[2rem] border border-slate-200 bg-white p-4 shadow-xl">
        <div className="grid grid-cols-2 gap-2" role="tablist" aria-label="Which future">
          {PATHS.map((p) => (
            <button
              key={p.id}
              role="tab"
              aria-selected={path === p.id}
              onClick={() => setPath(p.id)}
              className={`rounded-xl px-3 py-2 text-sm font-semibold ${
                path === p.id ? `${p.tone} text-white` : "bg-slate-100 text-slate-600"
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>

        <ul className="grid grid-cols-2 gap-2">
          {keyNumbers.map((m) => (
            <li
              key={m.id}
              className={`rounded-xl border p-2 transition ${
                highlight === m.id ? "border-orange-400 bg-orange-50 ring-4 ring-orange-200" : "border-slate-200"
              }`}
            >
              <span className="block text-xs text-slate-500">{m.label}</span>
              <span className="text-lg font-bold">{m.display}</span>
            </li>
          ))}
        </ul>

        {factSheet ? (
          <VoiceSession
            path={path}
            factSheet={factSheet}
            tools={tools}
            onToolEvent={onToolEvent}
            onStatusChange={setStatus}
          />
        ) : (
          <p className="text-sm text-slate-500">{loadError ? "No fact sheet." : "Loading fact sheets…"}</p>
        )}
      </section>

      {/* Inspector */}
      <section className="flex min-w-0 flex-col gap-4">
        <div className="flex flex-wrap gap-2 text-sm">
          <span className="self-center text-slate-500">Dry-run tools ({path}):</span>
          <button className="rounded-full border px-3 py-1" onClick={() => void dryRun("update_plan")}>
            update_plan (Austin)
          </button>
          <button className="rounded-full border px-3 py-1" onClick={() => void dryRun("start_transfer")}>
            start_transfer ($150)
          </button>
          <button className="rounded-full border px-3 py-1" onClick={() => void dryRun("highlight_metric")}>
            highlight_metric
          </button>
          <button className="rounded-full border border-red-300 px-3 py-1 text-red-700" onClick={() => void reset()}>
            Reset demo
          </button>
        </div>

        <div>
          <h2 className="mb-1 font-semibold">Tool calls</h2>
          {log.length === 0 ? (
            <p className="text-sm text-slate-500">No tool calls yet.</p>
          ) : (
            <ol className="flex flex-col gap-2 text-sm" aria-label="Tool call log">
              {log.map((e) => (
                <li key={`${e.id}_${e.phase}`} className="rounded-lg border border-slate-200 p-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <PhaseBadge phase={e.phase} />
                    <code className="font-semibold">{e.name}</code>
                    <span className="text-slate-500">{e.path}</span>
                    {e.ms !== undefined && <span className="text-slate-400">{e.ms} ms</span>}
                    <span className="ml-auto text-xs text-slate-400">{new Date(e.at).toLocaleTimeString()}</span>
                  </div>
                  {e.phase === "called" && <pre className="mt-1 overflow-x-auto text-xs text-slate-600">{JSON.stringify(e.params)}</pre>}
                  {e.reply && <pre className="mt-1 whitespace-pre-wrap text-xs text-slate-700">→ {e.reply}</pre>}
                  {e.error && <p className="mt-1 text-xs text-red-600">{e.error}</p>}
                </li>
              ))}
            </ol>
          )}
        </div>

        {factSheet && (
          <details open>
            <summary className="cursor-pointer font-semibold">Dynamic variables sent on start</summary>
            <dl className="mt-2 text-xs">
              <dt className="font-semibold">path</dt>
              <dd className="mb-2 font-mono">{path}</dd>
              <dt className="font-semibold">opening_line</dt>
              <dd className="mb-2">{factSheet.opening_line}</dd>
              <dt className="font-semibold">fact_sheet</dt>
              <dd>
                <pre className="whitespace-pre-wrap rounded-lg bg-slate-50 p-2">{factSheet.text}</pre>
              </dd>
            </dl>
          </details>
        )}
      </section>
    </main>
    </div>
  );
}

function PhaseBadge({ phase }: { phase: ToolEvent["phase"] }) {
  const tone = {
    called: "bg-sky-100 text-sky-800",
    ok: "bg-green-100 text-green-800",
    refused: "bg-amber-100 text-amber-800",
    error: "bg-red-100 text-red-800",
  }[phase];
  return <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${tone}`}>{phase}</span>;
}
