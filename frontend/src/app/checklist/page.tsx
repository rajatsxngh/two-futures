"use client";

/**
 * Pre-demo checklist (M10): run it right before judging. Automatic checks run
 * on load (and on "Run again"); the rest are ticks that stay ticked on this
 * device so the team can see what's done.
 */
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { baseCorpus, judge, TESTS, type ToolCall, type Turn } from "@/lib/grounding";
import { newMemory, savedReply } from "@/components/voice/savedAgent";
import { transferReply, updatePlanReply } from "@/components/voice/toolReplies";
import type { VoiceTools } from "@/components/voice";

type Status = "pending" | "ok" | "warn" | "fail";
type Check = { id: string; label: string; status: Status; detail: string };

const MANUAL = [
  { id: "earbuds", label: "Earbuds with a mic plugged in, volume checked" },
  { id: "hotspot", label: "Phone hotspot ready" },
  { id: "video", label: "Backup video open in another tab" },
  { id: "devpost", label: "Devpost submitted (edits close Sunday 12:00 PM)" },
  { id: "rehearsed", label: "Timed run-through under 3:00" },
];
const STORE_KEY = "future-you-checklist";

function tools(log: ToolCall[]): VoiceTools {
  return {
    updatePlan: async (i) => {
      const r = await api.updatePlan({ ...i, customer: "maya" });
      log.push({ name: "update_plan", params: i as Record<string, unknown>, reply: updatePlanReply(r) });
      return r;
    },
    startTransfer: async (i) => {
      const r = await api.startTransfer({ ...i, customer: "maya" });
      log.push({ name: "start_transfer", params: i as Record<string, unknown>, reply: transferReply(r) });
      return r;
    },
    highlightMetric: (id) => {
      log.push({ name: "highlight_metric", params: { metric_id: id } });
    },
  };
}

/** Saved-answers grounding run (same as /grounding, condensed). */
async function savedGrounding(): Promise<{ grounded: number; behaved: number }> {
  let grounded = 0;
  let behaved = 0;
  for (const test of TESTS) {
    await api.reset("maya");
    let futures = await api.futures("maya");
    const first = futures;
    const turns: Turn[] = [];
    for (const seg of test.segments) {
      const memory = newMemory();
      turns.push({ path: seg.path, question: null, reply: futures.fact_sheets[seg.path].opening_line, tools: [] });
      for (const q of seg.questions) {
        const log: ToolCall[] = [];
        const { reply } = await savedReply(q, { path: seg.path, futures, tools: tools(log), memory });
        turns.push({ path: seg.path, question: q, reply, tools: log });
        futures = await api.futures("maya");
      }
    }
    const r = judge(test, { turns }, baseCorpus(first, test.segments.flatMap((s) => s.questions)));
    if (r.ungrounded.length === 0) grounded++;
    if (r.failure === null) behaved++;
  }
  await api.reset("maya");
  return { grounded, behaved };
}

export default function ChecklistPage() {
  const [checks, setChecks] = useState<Check[]>([]);
  const [ticked, setTicked] = useState<Record<string, boolean>>({});
  const [running, setRunning] = useState(false);

  useEffect(() => {
    try {
      setTicked(JSON.parse(localStorage.getItem(STORE_KEY) ?? "{}"));
    } catch {
      // private window or blocked storage: ticks just won't persist
    }
  }, []);

  const tick = (id: string, v: boolean) => {
    const next = { ...ticked, [id]: v };
    setTicked(next);
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(next));
    } catch {
      // ignore
    }
  };

  const run = useCallback(async () => {
    setRunning(true);
    const out: Check[] = [];
    const push = (c: Check) => {
      out.push(c);
      setChecks([...out]);
    };

    try {
      const ping = await fetch("/api/ping", { cache: "no-store" }).then((r) => r.json());
      push({ id: "api", label: "Engine running", status: ping.mode === "engine" ? "ok" : "warn", detail: `Mode: ${ping.mode}, demo date ${ping.today}` });
    } catch (e) {
      push({ id: "api", label: "Engine running", status: "fail", detail: `API unreachable: ${e}. Start it with npm run dev.` });
    }

    try {
      await api.reset("maya");
      const h = await api.health("maya");
      push({ id: "reset", label: "Reset puts Maya at 55", status: h.score.value === 55 ? "ok" : "fail", detail: `Score ${h.score.value} (${h.band})` });
    } catch (e) {
      push({ id: "reset", label: "Reset puts Maya at 55", status: "fail", detail: String(e) });
    }

    try {
      const g = await savedGrounding();
      const ok = g.grounded === TESTS.length && g.behaved === TESTS.length;
      push({ id: "saved", label: "Saved answers ready (offline path)", status: ok ? "ok" : "fail", detail: `${g.grounded} of ${TESTS.length} grounded · ${g.behaved} of ${TESTS.length} behaved` });
    } catch (e) {
      push({ id: "saved", label: "Saved answers ready (offline path)", status: "fail", detail: String(e) });
    }

    try {
      const c = await fetch("/api/voice/signed-url?check=1", { cache: "no-store" }).then((r) => r.json());
      push({
        id: "voice",
        label: "ElevenLabs configured",
        status: c.configured ? "ok" : "warn",
        detail: c.configured ? "Keys present. Run /grounding with the live agent too." : `Missing ${c.missing.join(", ")}. Demo will use saved answers.`,
      });
    } catch (e) {
      push({ id: "voice", label: "ElevenLabs configured", status: "warn", detail: String(e) });
    }

    try {
      const perm = await navigator.permissions?.query({ name: "microphone" as PermissionName });
      push({
        id: "mic",
        label: "Microphone allowed",
        status: perm?.state === "granted" ? "ok" : "warn",
        detail: perm ? `Permission: ${perm.state}${perm.state !== "granted" ? " (click Test mic)" : ""}` : "Can't read permission here; click Test mic",
      });
    } catch {
      push({ id: "mic", label: "Microphone allowed", status: "warn", detail: "Can't read permission here; click Test mic" });
    }

    const voices = typeof window !== "undefined" && "speechSynthesis" in window ? window.speechSynthesis.getVoices().filter((v) => v.lang.startsWith("en")) : [];
    push({
      id: "speech",
      label: "Built-in voice for saved answers",
      status: voices.length ? "ok" : "warn",
      detail: voices.length ? `${voices.length} English voices (e.g. ${voices[0].name})` : "No voices listed yet: captions still work. Reload if needed.",
    });

    push({
      id: "online",
      label: "Internet",
      status: navigator.onLine ? "ok" : "warn",
      detail: navigator.onLine ? "Online. Live voice possible." : "Offline: switch the voice panel to Saved answers.",
    });
    setRunning(false);
  }, []);

  useEffect(() => {
    void run();
  }, [run]);

  const testMic = async () => {
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: true });
      s.getTracks().forEach((t) => t.stop());
      setChecks((cs) => cs.map((c) => (c.id === "mic" ? { ...c, status: "ok", detail: "Mic works" } : c)));
    } catch (e) {
      setChecks((cs) => cs.map((c) => (c.id === "mic" ? { ...c, status: "fail", detail: `Mic blocked: ${e}` } : c)));
    }
  };

  const icon: Record<Status, string> = { pending: "…", ok: "✓", warn: "!", fail: "✗" };
  const color: Record<Status, string> = { pending: "text-muted", ok: "text-ok", warn: "text-warn", fail: "text-bad" };

  return (
    <main className="mx-auto w-full max-w-2xl p-6 font-sans text-navy">
      <h1 className="text-2xl font-semibold">Before every demo</h1>
      <p className="mt-1 text-sm text-muted">Automatic checks first, then the things only a person can check.</p>

      <div className="mt-4 flex flex-wrap gap-2">
        <button onClick={() => void run()} disabled={running} className="rounded-full bg-navy px-4 py-2 text-sm font-semibold text-white disabled:opacity-40">
          {running ? "Checking…" : "Run again"}
        </button>
        <button onClick={() => void testMic()} className="rounded-full border border-line px-4 py-2 text-sm font-semibold">
          Test mic
        </button>
        <Link href="/" className="rounded-full border border-line px-4 py-2 text-sm font-semibold">
          Open the app
        </Link>
        <Link href="/grounding" className="rounded-full border border-line px-4 py-2 text-sm font-semibold">
          Grounding test
        </Link>
      </div>

      <ul className="mt-5 divide-y divide-line rounded-2xl border border-line">
        {checks.map((c) => (
          <li key={c.id} data-check={c.id} data-status={c.status} className="flex items-start gap-3 px-4 py-3">
            <span className={`w-4 text-lg font-bold leading-6 ${color[c.status]}`} aria-hidden>
              {icon[c.status]}
            </span>
            <span>
              <span className="block text-sm font-semibold">{c.label}</span>
              <span className="block text-xs text-muted">{c.detail}</span>
            </span>
          </li>
        ))}
      </ul>

      <h2 className="mt-6 text-sm font-semibold uppercase tracking-wide text-muted">Only a person can check</h2>
      <ul className="mt-2 space-y-2">
        {MANUAL.map((m) => (
          <li key={m.id}>
            <label className="flex items-center gap-3 text-sm">
              <input type="checkbox" className="h-4 w-4" checked={Boolean(ticked[m.id])} onChange={(e) => tick(m.id, e.target.checked)} />
              {m.label}
            </label>
          </li>
        ))}
      </ul>

      <h2 className="mt-6 text-sm font-semibold uppercase tracking-wide text-muted">If something fails</h2>
      <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
        <li>Voice fails: switch the voice panel to Text and say &quot;Same agent, typed.&quot;</li>
        <li>Internet fails: switch it to Saved answers. The main path runs offline.</li>
        <li>Everything fails: play the backup video and take questions over it.</li>
      </ul>
    </main>
  );
}
