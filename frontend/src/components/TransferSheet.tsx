"use client";

/**
 * "Confirm your transfer" sheet. Rendered once in App, over any screen, whenever
 * a transfer is proposed: by the "Start this" button or by an agent (voice, text
 * or saved answers). Its "Yes, schedule it" tap is the only way money moves.
 */
import { confirmTransfer, declineTransfer } from "@/lib/actions";
import { useApp } from "@/lib/store";
import { longDate, usd } from "./ui";

export const FREQUENCY_TEXT = { payday: "Every payday", monthly: "Every month", once: "Once" } as const;

export function TransferSheet() {
  const proposal = useApp((s) => s.transferProposal);
  const profile = useApp((s) => s.profile);
  const step = useApp((s) => s.futures?.next_step ?? null);
  const pending = useApp((s) => s.transferPending);
  const error = useApp((s) => s.error);
  if (!proposal) return null;

  const p = proposal.input;
  const nameOf = (id: string) => profile?.accounts.find((a) => a.id === id)?.name ?? id;
  const rows: [string, string][] = [
    ["Amount", usd(p.amount)],
    ["From", nameOf(p.from_account_id)],
    ["To", nameOf(p.to_account_id)],
    ["How often", FREQUENCY_TEXT[p.frequency]],
  ];
  // The first date comes from the engine's next step; only shown when it's the same schedule.
  if (step && step.frequency === p.frequency) rows.push(["First transfer", longDate(step.first_date)]);

  return (
    <div className="absolute inset-0 z-30 flex flex-col justify-end">
      <button aria-label="Cancel" className="fade-in absolute inset-0 bg-navy/30" onClick={() => !pending && declineTransfer()} />
      <div role="dialog" aria-label="Confirm transfer" className="sheet-up relative rounded-t-3xl bg-white px-4 pb-5 pt-3 shadow-2xl">
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-line" />
        <h2 className="text-lg font-semibold text-navy">Confirm your transfer</h2>
        {proposal.source === "voice" && <p className="text-xs text-muted">Future you suggested this. It only starts if you tap yes.</p>}
        <dl className="mt-3 divide-y divide-line rounded-2xl border border-line">
          {rows.map(([k, v]) => (
            <div key={k} className="flex justify-between px-3 py-2.5 text-sm">
              <dt className="text-muted">{k}</dt>
              <dd className="font-semibold text-navy">{v}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-2 text-xs text-muted">Simulated: no real money moves. You can stop it any time.</p>
        {error && <p className="mt-2 text-sm text-bad">{error}</p>}
        <div className="mt-4 grid grid-cols-2 gap-2">
          <button onClick={declineTransfer} disabled={pending} className="rounded-2xl border border-line py-3 text-sm font-semibold text-navy disabled:opacity-50">
            Not now
          </button>
          <button onClick={() => void confirmTransfer()} disabled={pending} className="rounded-2xl bg-accent py-3 text-sm font-semibold text-white disabled:opacity-50">
            {pending ? "Scheduling..." : "Yes, schedule it"}
          </button>
        </div>
      </div>
    </div>
  );
}
