"use client";

import type { TransferResponse } from "@/lib/api";
import { proposeTransfer, stopTransfer } from "@/lib/actions";
import { useApp } from "@/lib/store";
import { Card, MetricValue, longDate, usd } from "../ui";

export function NextStepScreen() {
  const futures = useApp((s) => s.futures)!;
  const profile = useApp((s) => s.profile)!;
  const transfer = useApp((s) => s.transfer);
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
          {step.amount_metric ? (
            <MetricValue metric={step.amount_metric} className="text-[44px] font-semibold leading-none text-navy" />
          ) : (
            <span className="tabular text-[44px] font-semibold leading-none text-navy">{usd(step.amount)}</span>
          )}
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

        {transfer?.status === "scheduled" ? (
          <ScheduledBadge transfer={transfer} />
        ) : (
          <>
            {transfer?.status === "stopped" && (
              <p className="mt-4 text-center text-sm text-muted" aria-live="polite">
                {transfer.sentence}
              </p>
            )}
            <button
              onClick={() =>
                proposeTransfer(
                  { amount: step.amount, from_account_id: step.from_account_id, to_account_id: step.to_account_id, frequency: step.frequency },
                  "tap",
                )
              }
              className="mt-4 w-full rounded-2xl bg-accent py-3.5 text-lg font-semibold text-white shadow-lg shadow-accent/25 hover:bg-accent-dark"
            >
              Start this
            </button>
          </>
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
    </div>
  );
}

function ScheduledBadge({ transfer }: { transfer: TransferResponse }) {
  const pending = useApp((s) => s.transferPending);
  const error = useApp((s) => s.error);
  return (
    <div className="mt-4 text-center" aria-live="polite">
      <span className="pop-in inline-flex items-center gap-1.5 rounded-full bg-navy px-4 py-2 text-base font-semibold text-white">
        <svg viewBox="0 0 20 20" className="h-5 w-5 text-accent" fill="currentColor" aria-hidden>
          <path d="M10 1.5a8.5 8.5 0 1 0 0 17 8.5 8.5 0 0 0 0-17Zm4.03 6.28-4.6 5.5a.75.75 0 0 1-1.11.05l-2.4-2.4a.75.75 0 1 1 1.06-1.06l1.82 1.82 4.08-4.87a.75.75 0 0 1 1.15.96Z" />
        </svg>
        Scheduled · simulated
      </span>
      <p className="mt-2 text-sm text-navy">{transfer.sentence}</p>
      <p className="text-xs text-muted">First transfer {longDate(transfer.first_date)}</p>
      {error && <p className="mt-1 text-sm text-bad">{error}</p>}
      <button
        onClick={() => void stopTransfer()}
        disabled={pending}
        className="mt-3 rounded-full border border-line px-4 py-1.5 text-sm font-semibold text-navy hover:border-navy disabled:opacity-50"
      >
        {pending ? "Stopping..." : "Stop"}
      </button>
    </div>
  );
}
