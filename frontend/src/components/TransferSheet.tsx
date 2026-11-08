"use client";

/**
 * "Confirm your transfer" sheet. Rendered once in App, over any screen, whenever
 * a transfer is proposed: by the "Start this" button or by an agent (voice, text
 * or saved answers). Its "Yes, schedule it" tap is the only way money moves.
 */
import type { Account } from "@/lib/api";
import { confirmTransfer, declineTransfer } from "@/lib/actions";
import { useApp } from "@/lib/store";
import { ACCOUNT_ICON, IconBank, IconMic, IconShield } from "./icons";
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
  const accountOf = (id: string) => profile?.accounts.find((a) => a.id === id);
  const nameOf = (id: string) => accountOf(id)?.name ?? id;
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
      <button aria-label="Cancel" className="fade-in absolute inset-0 bg-black/60 backdrop-blur-[2px]" onClick={() => !pending && declineTransfer()} />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Confirm transfer"
        className="sheet-up relative rounded-t-[32px] bg-white px-5 pb-[max(28px,env(safe-area-inset-bottom))] pt-2.5 text-ink shadow-[0_-24px_60px_rgba(0,0,0,0.45)]"
      >
        <div aria-hidden className="mx-auto h-[5px] w-10 rounded-full bg-hair" />
        <h2 className="mt-4 text-[24px] font-semibold tracking-[-0.03em]">Confirm your transfer</h2>
        {proposal.source === "voice" && (
          <p className="mt-1.5 flex items-center gap-2 text-[13px] text-ink-3">
            <span aria-hidden className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-ember-soft text-ember-ink">
              <IconMic className="h-[11px] w-[11px]" strokeWidth={2.2} />
            </span>
            Future you suggested this. It only starts if you tap yes.
          </p>
        )}

        <div aria-hidden className="mt-5 grid grid-cols-[1fr_auto_1fr] items-center gap-2">
          <Party account={accountOf(p.from_account_id)} fallback={nameOf(p.from_account_id)} tile="bg-ink text-snow" />
          <span className="flex flex-col items-center gap-0.5 pb-6">
            <span className="tabular text-[28px] font-semibold tracking-[-0.04em]">{usd(p.amount)}</span>
            <svg width="96" height="12" viewBox="0 0 96 12" fill="none">
              <path d="M2 6h88" stroke="#FF6B1A" strokeWidth="2" strokeLinecap="round" strokeDasharray="1 5" />
              <path d="M86 1.5 91.5 6 86 10.5" stroke="#FF6B1A" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
          <Party account={accountOf(p.to_account_id)} fallback={nameOf(p.to_account_id)} tile="bg-ember text-ink" />
        </div>

        <dl className="mt-[18px] rounded-[22px] bg-tile-2 px-4">
          {rows.map(([k, v], i) => (
            <div key={k} className={`flex min-h-12 items-center justify-between gap-3 text-sm ${i ? "border-t border-[#eaeaed]" : ""}`}>
              <dt className="text-ink-3">{k}</dt>
              <dd className="text-right font-semibold">{v}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-3 flex items-center gap-2 text-[12.5px] text-ink-3">
          <IconShield className="h-[15px] w-[15px] shrink-0 text-[#71717a]" strokeWidth={1.7} />
          Simulated: no real money moves. You can stop it any time.
        </p>
        {error && <p className="mt-2 text-sm text-poor-ink">{error}</p>}
        <div className="mt-[18px] grid grid-cols-2 gap-2.5">
          <button
            onClick={declineTransfer}
            disabled={pending}
            className="h-14 rounded-full border border-hair bg-white text-[15px] font-semibold text-ink transition hover:border-ink-3/40 disabled:opacity-50"
          >
            Not now
          </button>
          <button
            onClick={() => void confirmTransfer()}
            disabled={pending}
            className="h-14 rounded-full bg-ember text-[15px] font-semibold text-ink shadow-[0_12px_30px_-12px_rgba(255,107,26,0.8)] transition hover:brightness-105 disabled:opacity-50"
          >
            {pending ? "Scheduling…" : "Yes, schedule it"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Party({ account, fallback, tile }: { account?: Account; fallback: string; tile: string }) {
  const Icon = (account && ACCOUNT_ICON[account.type]) || IconBank;
  return (
    <span className="flex min-w-0 flex-col items-center gap-1.5 text-center">
      <span className={`flex h-12 w-12 items-center justify-center rounded-full ${tile}`}>
        <Icon className="h-[21px] w-[21px]" strokeWidth={1.7} />
      </span>
      <span className="max-w-full truncate text-sm font-semibold">{account?.name ?? fallback}</span>
      {account && <span className="tabular -mt-1 text-xs text-ink-3">{usd(account.balance)}</span>}
    </span>
  );
}
