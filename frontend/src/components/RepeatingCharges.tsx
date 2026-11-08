"use client";

/**
 * "Repeating charges I found": subscriptions the engine detected in the
 * transactions (same merchant, about monthly, about the same amount). The
 * app can't know if you still use them, so it asks. A "No" lets plan rule 3
 * cancel it, and the plan and both futures re-run. Reset restores the
 * pre-filled answers.
 */
import { useState } from "react";
import type { SetupAnswers } from "@/lib/api";
import { answerSetup } from "@/lib/actions";
import { useApp } from "@/lib/store";
import { MetricValue } from "./ui";

export function RepeatingCharges() {
  const subs = useApp((s) => s.profile?.subscriptions);
  const setup = useApp((s) => s.profile?.customer.setup);
  const [saving, setSaving] = useState<string | null>(null);
  if (!subs?.length || !setup) return null;

  const answer = async (id: string, stillUsing: boolean) => {
    const next: SetupAnswers = { ...setup, subscriptions: { ...(setup.subscriptions ?? {}), [id]: stillUsing } };
    setSaving(id);
    try {
      await answerSetup(next);
    } finally {
      setSaving(null);
    }
  };

  return (
    <section className="rounded-2xl border border-line bg-white p-4" aria-label="Repeating charges I found">
      <p className="text-sm font-semibold text-navy">Repeating charges I found</p>
      <p className="text-xs text-muted">Same merchant, about every month, about the same amount. Still using them?</p>
      <ul className="mt-2 divide-y divide-line">
        {subs.map((s) => (
          <li key={s.id} className="flex items-center justify-between gap-2 py-1.5">
            <div className="min-w-0">
              <p className="truncate text-sm text-navy">
                {s.merchant}
                {s.price_change && (
                  <span className="ml-1.5 rounded-full bg-warn/10 px-1.5 py-0.5 text-[10px] font-semibold text-warn">Price up</span>
                )}
              </p>
              <MetricValue metric={s.metric} className="text-xs text-muted" />
            </div>
            <div className="flex shrink-0 gap-1" role="group" aria-label={`Still using ${s.merchant}?`}>
              {([true, false] as const).map((v) => {
                const on = s.still_using === v;
                return (
                  <button
                    key={String(v)}
                    aria-pressed={on}
                    disabled={saving !== null}
                    onClick={() => !on && void answer(s.id, v)}
                    className={`rounded-full border px-2.5 py-0.5 text-xs font-medium ${on ? "border-accent bg-accent-soft text-accent-dark" : "border-line text-muted"}`}
                  >
                    {v ? "Yes" : "No"}
                  </button>
                );
              })}
            </div>
          </li>
        ))}
      </ul>
      <p className="mt-1 text-[11px] text-muted">
        {saving ? "Updating your plan…" : "Your answer, not a guess: the plan only cancels the ones you say no to."}
      </p>
    </section>
  );
}
