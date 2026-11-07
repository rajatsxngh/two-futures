"use client";

import { useState } from "react";
import type { NextStep } from "@/lib/api";
import { startTransfer } from "@/lib/actions";
import { useApp } from "@/lib/store";
import { Card, MetricValue, longDate, usd } from "../ui";

const FREQUENCY_TEXT = { payday: "Every payday", monthly: "Every month", once: "Once" } as const;

export function NextStepScreen() {
  const futures = useApp((s) => s.futures)!;
  const profile = useApp((s) => s.profile)!;
  const transfer = useApp((s) => s.transfer);
  const [confirming, setConfirming] = useState(false);
  const step = futures.next_step;
  const nameOf = (id: string) => profile.accounts.find((a) => a.id === id)?.name ?? id;
  const action = futures.plan.actions.find((a) => a.id === step.action_id);

  return (
    <div className="space-y-4 px-4 py-4">
      <div>
        <h1 className="text-2xl font-semibold text-navy">Your next step</h1>
        <p className="text-sm text-muted">One small move that starts the plan.</p>
      </div>

      <Card className="border-2 border-accent/30">
        <p className="text-xs font-semibold uppercase tracking-wide text-accent">Step 1 of the plan</p>
        <p className="mt-1 text-xl font-semibold leading-snug text-navy">{step.title}</p>
        {action && <p className="mt-1 text-sm leading-snug text-muted">{action.description}</p>}

        <div className="mt-3 flex items-end gap-2">
          <span className="tabular text-[44px] font-semibold leading-none text-navy">{usd(step.amount)}</span>
          <span className="pb-1 text-sm text-muted">
            {nameOf(step.from_account_id)} → {nameOf(step.to_account_id)}
          </span>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-2">
          {step.effects.map((m) => (
            <div key={m.id} className="rounded-xl bg-surface p-2.5">
              <p className="text-[11px] font-medium text-muted">{m.label}</p>
              <MetricValue metric={m} className="text-xl font-semibold text-navy" />
            </div>
          ))}
        </div>

        {transfer ? (
          <ScheduledBadge sentence={transfer.sentence} firstDate={transfer.first_date} />
        ) : (
          <button
            onClick={() => setConfirming(true)}
            className="mt-4 w-full rounded-2xl bg-accent py-3.5 text-lg font-semibold text-white shadow-lg shadow-accent/25 hover:bg-accent-dark"
          >
            Start this
          </button>
        )}
      </Card>

      {futures.plan.actions.length > 1 && (
        <div>
          <p className="mb-1 text-sm font-semibold uppercase tracking-wide text-muted">Then the plan does this</p>
          <ol className="space-y-2">
            {futures.plan.actions
              .filter((a) => a.id !== step.action_id)
              .map((a) => (
                <li key={a.id} className="flex gap-3 rounded-xl border border-line p-3">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-surface text-xs font-semibold text-navy">{a.rule}</span>
                  <span>
                    <span className="block text-sm font-medium text-navy">{a.title}</span>
                    <span className="block text-xs text-muted">{a.description}</span>
                  </span>
                </li>
              ))}
          </ol>
        </div>
      )}

      {confirming && !transfer && <ConfirmSheet step={step} nameOf={nameOf} onClose={() => setConfirming(false)} />}
    </div>
  );
}

function ConfirmSheet({ step, nameOf, onClose }: { step: NextStep; nameOf: (id: string) => string; onClose: () => void }) {
  const pending = useApp((s) => s.transferPending);
  const error = useApp((s) => s.error);

  const confirm = async () => {
    try {
      await startTransfer({
        amount: step.amount,
        from_account_id: step.from_account_id,
        to_account_id: step.to_account_id,
        frequency: step.frequency,
        confirmed: true,
      });
      onClose();
    } catch {
      // error is shown from the store
    }
  };

  const rows: [string, string][] = [
    ["Amount", usd(step.amount)],
    ["From", nameOf(step.from_account_id)],
    ["To", nameOf(step.to_account_id)],
    ["How often", FREQUENCY_TEXT[step.frequency]],
    ["First transfer", longDate(step.first_date)],
  ];

  return (
    <div className="absolute inset-0 z-30 flex flex-col justify-end">
      <button aria-label="Cancel" className="fade-in absolute inset-0 bg-navy/30" onClick={onClose} />
      <div role="dialog" aria-label="Confirm transfer" className="sheet-up relative rounded-t-3xl bg-white px-4 pb-5 pt-3 shadow-2xl">
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-line" />
        <h2 className="text-lg font-semibold text-navy">Confirm your transfer</h2>
        <dl className="mt-3 divide-y divide-line rounded-2xl border border-line">
          {rows.map(([k, v]) => (
            <div key={k} className="flex justify-between px-3 py-2.5 text-sm">
              <dt className="text-muted">{k}</dt>
              <dd className="font-semibold text-navy">{v}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-2 text-xs text-muted">This is a demo: no real money moves. You can stop it any time.</p>
        {error && <p className="mt-2 text-sm text-bad">{error}</p>}
        <div className="mt-4 grid grid-cols-2 gap-2">
          <button onClick={onClose} className="rounded-2xl border border-line py-3 text-sm font-semibold text-navy">
            Not now
          </button>
          <button onClick={() => void confirm()} disabled={pending} className="rounded-2xl bg-accent py-3 text-sm font-semibold text-white disabled:opacity-50">
            {pending ? "Scheduling..." : "Yes, schedule it"}
          </button>
        </div>
      </div>
    </div>
  );
}

function ScheduledBadge({ sentence, firstDate }: { sentence: string; firstDate: string }) {
  return (
    <div className="mt-4 text-center" aria-live="polite">
      <span className="pop-in inline-flex items-center gap-1.5 rounded-full bg-navy px-4 py-2 text-base font-semibold text-white">
        <svg viewBox="0 0 20 20" className="h-5 w-5 text-accent" fill="currentColor" aria-hidden>
          <path d="M10 1.5a8.5 8.5 0 1 0 0 17 8.5 8.5 0 0 0 0-17Zm4.03 6.28-4.6 5.5a.75.75 0 0 1-1.11.05l-2.4-2.4a.75.75 0 1 1 1.06-1.06l1.82 1.82 4.08-4.87a.75.75 0 0 1 1.15.96Z" />
        </svg>
        Scheduled
      </span>
      <p className="mt-2 text-sm text-navy">{sentence}</p>
      <p className="text-xs text-muted">First transfer {longDate(firstDate)}</p>
    </div>
  );
}
