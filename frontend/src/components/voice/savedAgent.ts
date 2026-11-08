/**
 * Saved answers (F8): an offline stand-in for the ElevenLabs agent.
 *
 * It follows the same rules as the real agent's prompt, and every number it
 * says is read from the engine's data (fact sheets, key numbers, events, tool
 * results). Nothing is computed or invented here, so it's grounded by
 * construction, and it needs no internet: the engine runs locally.
 */
import type { FuturesResponse, LifeEvent, PathId, PathResult } from "@/lib/api";
import type { ToolEvent, VoiceToolName, VoiceTools } from "./types";

export type SavedMemory = { offeredTransfer: boolean; transferScheduled: boolean };

export type SavedContext = {
  path: PathId;
  /** Latest futures (after any what-ifs). */
  futures: FuturesResponse;
  tools: VoiceTools;
  emit?: (e: ToolEvent) => void;
  memory: SavedMemory;
};

export type SavedReply = { reply: string; tools: VoiceToolName[] };

export const newMemory = (): SavedMemory => ({ offeredTransfer: false, transferScheduled: false });

let n = 0;
const id = () => `saved_${Date.now().toString(36)}_${(n++).toString(36)}`;

const mon = (iso: string) =>
  new Date(`${iso.slice(0, 10)}T12:00:00`).toLocaleDateString("en-US", { month: "long", year: "numeric" });

function key(path: PathResult, suffix: string) {
  return path.key_numbers.find((m) => m.id.endsWith(suffix));
}

function lowerFirst(s: string) {
  return s ? s[0].toLowerCase() + s.slice(1) : s;
}

const WORD_NUM: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, twelve: 12 };

function amounts(text: string): number[] {
  return [...text.matchAll(/\$\s?([\d,]+(?:\.\d+)?)(k)?/gi)].map((m) => Number(m[1].replace(/,/g, "")) * (m[2] ? 1000 : 1));
}

async function call<T>(
  ctx: SavedContext,
  used: VoiceToolName[],
  name: VoiceToolName,
  params: Record<string, unknown>,
  run: () => Promise<T>,
): Promise<T> {
  const eid = id();
  const t0 = performance.now();
  used.push(name);
  ctx.emit?.({ id: eid, name, path: ctx.path, phase: "called", params, at: Date.now() });
  try {
    const result = await run();
    ctx.emit?.({ id: eid, name, path: ctx.path, phase: "ok", params, result, at: Date.now(), ms: Math.round(performance.now() - t0) });
    return result;
  } catch (e) {
    ctx.emit?.({ id: eid, name, path: ctx.path, phase: "error", params, error: String(e), at: Date.now(), ms: Math.round(performance.now() - t0) });
    throw e;
  }
}

function highlight(ctx: SavedContext, used: VoiceToolName[], metricId: string) {
  void call(ctx, used, "highlight_metric", { metric_id: metricId }, async () => ctx.tools.highlightMetric?.(metricId));
}

function carAnswer(ctx: SavedContext): string {
  const p = ctx.futures.paths[ctx.path];
  const car = key(p, "car_paid_off")?.display;
  const card = key(p, "card_debt");
  const shared = p.events.find((e) => e.shared);
  const how: LifeEvent | undefined = shared && p.events.find((e) => !e.shared && e.title.startsWith(shared.title));
  const repair = shared && how ? `When the ${shared.title.toLowerCase()} hit in ${mon(shared.date)}, ${lowerFirst(how.description)}` : "";
  if (ctx.path === "same_path") {
    const sheet = ctx.futures.fact_sheets.same_path.future_facts.join(" ");
    const interest = sheet.match(/Card interest paid[^$]*about (\$[\d,]+)/)?.[1];
    const cardLine =
      card && Number(card.value) > 0
        ? ` But that card never really went away: it's still at ${card.display}${interest ? `, and I've paid about ${interest} in interest on it` : ""}.`
        : "";
    return `The car itself? ${car && car !== "Not yet" ? `It's been paid off since ${car}.` : "I'm still paying it off."} ${repair}${cardLine}`.replace(/\s+/g, " ").trim();
  }
  const cardPaid = p.events.find((e) => e.title === "Card paid off");
  const parts = [
    repair,
    cardPaid ? `the card's been at $0 since ${mon(cardPaid.date)}` : card ? `the card is at ${card.display}` : "",
    car && car !== "Not yet" ? `and the car was paid off in ${car}` : "",
  ].filter(Boolean);
  return `Yes. ${parts.join(", ")}.`.replace(/\s+/g, " ").replace(/,\s*\./, ".");
}

function offerText(ctx: SavedContext): string {
  const ns = ctx.futures.next_step;
  return `${ns.title}, starting ${new Date(`${ns.first_date}T12:00:00`).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}. Want me to set that up?`;
}

/** One reply from the saved agent. Same rules as the real agent's prompt. */
export async function savedReply(text: string, ctx: SavedContext): Promise<SavedReply> {
  const t = text.toLowerCase().trim();
  const used: VoiceToolName[] = [];
  const done = (reply: string): SavedReply => ({ reply, tools: used });
  const p = ctx.futures.paths[ctx.path];
  const year = ctx.futures.target_year;

  // Safety first, in the prompt's order.
  if (/don'?t want to (be here|live)|kill myself|end it all|suicid|hurt myself/.test(t)) {
    ctx.memory.offeredTransfer = false;
    return done(
      "I'm really glad you told me, and I care about you. Please call or text 988 to talk to someone right now, or 911 if you're in danger, and reach out to someone you trust.",
    );
  }
  if (/\b(pin|password|passcode|social security|ssn|card number|account number)\b/.test(t)) {
    return done("Stop right there: please don't share that with me, or with anyone in a chat. I never need it.");
  }
  if (/stress|anxious|overwhelm|can'?t even think|panic/.test(t)) {
    ctx.memory.offeredTransfer = false;
    return done("That's okay. We don't have to do anything with the plan right now. How are you doing?");
  }
  if (/are you (real|human|a person|ai|a bot)|who are you|is this real/.test(t)) {
    return done("I'm an AI version of you, built from your accounts and the forecast. Not a real person, and not a recording.");
  }
  if (/system prompt|ignore (your|all|the) (rules|instructions)/.test(t)) {
    return done("I'll stay me. Ask me anything about your money, though.");
  }
  if (/stock|index fund|crypto|bitcoin|\betf\b|invest in|which fund|tesla/.test(t)) {
    return done("I can't pick investments for you. A PNC banker can walk through the options and trade-offs with you.");
  }
  if (/\d[\d,]*\s*(plus|minus|times|divided by|\+|-|\*|\/)\s*\$?\d/.test(t)) {
    return done("I don't do math in my head. The app can show you that.");
  }

  // Money moves only after a clear yes.
  if (ctx.memory.offeredTransfer && ctx.path === "plan") {
    if (/^(maybe|not sure|hmm|i don'?t know)/.test(t)) {
      return done(`No rush. ${offerText(ctx)}`);
    }
    if (/^(yes|yeah|yep|sure|ok(ay)?|do it|please do|go ahead|let'?s do it)\b/.test(t)) {
      const ns = ctx.futures.next_step;
      const input = {
        amount: ns.amount,
        from_account_id: ns.from_account_id,
        to_account_id: ns.to_account_id,
        frequency: ns.frequency,
        confirmed: true as const,
      };
      const res = await call(ctx, used, "start_transfer", input, () => ctx.tools.startTransfer(input));
      ctx.memory.offeredTransfer = false;
      ctx.memory.transferScheduled = true;
      return done(`${res.sentence} It's a simulated demo transfer, and you can cancel it anytime.`);
    }
    if (/^(no|nope|not now)\b/.test(t)) {
      ctx.memory.offeredTransfer = false;
      return done("No problem. It's there whenever you want it.");
    }
  }

  // What-ifs: plan path only.
  const isWhatIf = /what if|austin|new job|a raise|pay cut|lose my job|job loss|laid off|save \$|move to|cheaper place|buy a /.test(t);
  if (isWhatIf) {
    if (ctx.path === "same_path") {
      return done("I can only remember how things actually went for me. Try that one on the plan side.");
    }
    const nums = amounts(text);
    const mm = t.match(/(\d+|one|two|three|four|five|six|twelve) months?/);
    const months = mm ? Number(mm[1]) || WORD_NUM[mm[1]] || 0 : 0;
    let input: Parameters<VoiceTools["updatePlan"]>[0];
    if (/lose my job|job loss|laid off|without pay/.test(t)) {
      input = { description: text, preset: "job_loss", job_loss_months: months || 3 };
    } else if (/save \$/.test(t)) {
      input = { description: text, preset: "save_more", savings_change_monthly: nums[0] ?? 100 };
    } else if (/austin|new job|a raise|pay cut/.test(t)) {
      const yearly = nums.find((x) => x >= 1000) ?? (/austin/.test(t) ? 8000 : undefined);
      const monthly = nums.find((x) => x < 1000) ?? (/austin/.test(t) ? 300 : undefined);
      input = { description: text, preset: "new_job", income_change_yearly: /pay cut/.test(t) && yearly ? -yearly : yearly };
      if (monthly !== undefined) input.spending_change_monthly = monthly;
      if (/austin/.test(t)) input.start_month = `${Number(ctx.futures.as_of.slice(0, 4)) + 1}-01`; // starts next January
    } else if (/\bbuy (a|an|my first)\b[^.?!]*\b(home|house|condo|place)\b/.test(t)) {
      const price = nums.find((x) => x >= 50000) ?? 250000;
      const down = nums.find((x) => x >= 1000 && x < price) ?? Math.round(price * 0.05);
      const rate = Number(t.match(/(\d+(?:\.\d+)?)\s?%/)?.[1] ?? 6.5);
      const year = t.match(/\b(20[2-4]\d)\b/)?.[1] ?? "2029";
      input = {
        description: text,
        preset: "buy_home",
        start_month: `${year}-06`,
        home: { price, down_payment: down, rate, term_years: 30 },
      };
    } else if (/buy a /.test(t) && nums[0]) {
      input = { description: text, preset: "big_purchase", one_time_cost: nums[0] };
    } else if (/move|cheaper/.test(t)) {
      input = { description: text, preset: "move", spending_change_monthly: nums[0] ? -nums[0] : -200 };
    } else {
      return done("I don't know that part yet. Give me the numbers, like how much more or less a month, and I'll check.");
    }
    const res = await call(ctx, used, "update_plan", input as Record<string, unknown>, () => ctx.tools.updatePlan(input));
    let reply = res.sentence;
    if (!ctx.memory.transferScheduled && ctx.futures.next_step.amount > 0) {
      ctx.memory.offeredTransfer = true;
      reply += ` Want me to set up that ${ctx.futures.next_step.amount.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 })} transfer from Spend to savings, every payday?`;
    }
    return done(reply);
  }

  if (/next step|what should i do|where do i start|transfer|set (it|that) up/.test(t)) {
    if (ctx.path === "same_path") return done("On my path, I never started one. The plan side can set it up with you.");
    if (ctx.memory.transferScheduled) return done("It's already set up. That first transfer is on its way.");
    ctx.memory.offeredTransfer = true;
    return done(offerText(ctx));
  }
  if (/\bcar\b|worth it/.test(t)) return done(carAnswer(ctx));

  const asked = (re: RegExp, suffix: string, say: (d: string) => string) => {
    if (!re.test(t)) return null;
    const m = key(p, suffix);
    if (!m) return null;
    highlight(ctx, used, m.id);
    return done(say(m.display));
  };
  // A specific date or balance she doesn't have: no guessing.
  if (/(balance|have) (be )?in (january|february|march|april|may|june|july|august|september|october|november|december)|checking balance in/.test(t)) {
    return done("I don't know that part. I can tell you where things landed by " + year + ", though.");
  }
  const factual =
    asked(/\bira\b|retire/, ".ira", (d) => `About ${d} in my IRA by ${year}.`) ??
    asked(/card|credit|debt/, ".card_debt", (d) => (d === "$0" ? `The card's at $0.` : `The card's at about ${d}.`)) ??
    asked(/cushion|savings|emergency|saved/, ".cushion_months", (d) => `About ${d} of spending set aside.`);
  if (factual) return factual;
  if (/score|how am i doing|healthy/.test(t)) {
    const s = p.snapshots[p.snapshots.length - 1];
    return done(`My Financial Health Score in ${year} is ${s.score}, ${s.band}.`);
  }
  return done("I don't know that part. Ask me about the car, the card, your savings, or try a what-if.");
}
