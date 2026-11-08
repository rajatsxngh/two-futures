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
import { MetricValue, SectionTitle } from "./ui";

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
    <section className="mt-7" aria-label="Repeating charges I found">
      <SectionTitle right={<span className="text-[13px] text-ink-3">{subs.length} found</span>}>Repeating charges</SectionTitle>
      <p className="mt-1.5 text-[13px] leading-[1.45] text-ink-3">Same merchant, about every month, about the same amount. Still using them?</p>
      <ul className="mt-1.5">
        {subs.map((s) => (
          <li key={s.id} className="flex min-h-16 items-center gap-3.5 border-b border-[#f0f0f2] py-2.5 last:border-b-0">
            <span aria-hidden className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-tile text-[15px] font-semibold text-ink">
              {s.merchant.charAt(0).toUpperCase()}
            </span>
            <div className="min-w-0 flex-1">
              <p className="flex min-w-0 items-center gap-1.5 text-[15px] font-medium tracking-[-0.01em] text-ink">
                <span className="truncate">{s.merchant}</span>
                {s.price_change && <span className="shrink-0 rounded-full bg-fair-soft px-1.5 py-0.5 text-[10px] font-semibold text-fair-ink">Price up</span>}
              </p>
              <MetricValue metric={s.metric} className="text-[13px] text-ink-3" />
            </div>
            <div className="flex shrink-0 rounded-full bg-tile p-1" role="group" aria-label={`Still using ${s.merchant}?`}>
              {([true, false] as const).map((v) => {
                const on = s.still_using === v;
                return (
                  <button
                    key={String(v)}
                    aria-pressed={on}
                    disabled={saving !== null}
                    onClick={() => !on && void answer(s.id, v)}
                    className={`h-10 min-w-12 rounded-full px-3 text-[13px] font-semibold transition disabled:opacity-60 ${on ? "bg-ink text-snow shadow-sm" : "text-ink-3 hover:text-ink"}`}
                  >
                    {v ? "Yes" : "No"}
                  </button>
                );
              })}
            </div>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-xs leading-snug text-ink-3">
        {saving ? "Updating your plan…" : "Your answer, not a guess: the plan only cancels the ones you say no to."}
      </p>
    </section>
  );
}
