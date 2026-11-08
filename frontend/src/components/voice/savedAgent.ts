/**
 * Saved answers (F8): an offline stand-in for the ElevenLabs agent.
 *
 * It follows the same rules as the real agent's prompt, and every number it
 * says is read from the engine's data (fact sheets, key numbers, events, tool
 * results). Nothing is computed or invented here, so it's grounded by
 * construction, and it needs no internet: the engine runs locally.
 */
import type { CarPurchase, FuturesResponse, LifeEvent, PathId, PathResult } from "@/lib/api";
import type { ProposalResult, ToolEvent, TransferProposal, VoiceToolName, VoiceTools } from "./types";

export type SavedMemory = { offeredTransfer: boolean; transferScheduled: boolean };

export type SavedContext = {
  path: PathId;
  /** Latest futures (after any what-ifs). */
  futures: FuturesResponse;
  tools: VoiceTools;
  emit?: (e: ToolEvent) => void;
  memory: SavedMemory;
  /** True when a simulated transfer is already scheduled (the user tapped Yes on the sheet). */
  scheduled?: boolean;
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

const WORD_NUM: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, twelve: 12 };

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

const scheduled = (ctx: SavedContext) => ctx.scheduled ?? ctx.memory.transferScheduled;

/** Propose the transfer: opens the confirm sheet. Logged as "proposed" (waiting for the user's tap). */
async function propose(ctx: SavedContext, used: VoiceToolName[], input: TransferProposal): Promise<ProposalResult> {
  const eid = id();
  const t0 = performance.now();
  const params = { ...input, confirmed: true };
  used.push("start_transfer");
  ctx.emit?.({ id: eid, name: "start_transfer", path: ctx.path, phase: "called", params, at: Date.now() });
  try {
    const res = await ctx.tools.proposeTransfer(input);
    const phase = res.status === "awaiting_tap" ? "proposed" : "refused";
    ctx.emit?.({ id: eid, name: "start_transfer", path: ctx.path, phase, params, reply: res.reply, result: res, at: Date.now(), ms: Math.round(performance.now() - t0) });
    return res;
  } catch (e) {
    ctx.emit?.({ id: eid, name: "start_transfer", path: ctx.path, phase: "error", params, error: String(e), at: Date.now(), ms: Math.round(performance.now() - t0) });
    throw e;
  }
}

function highlight(ctx: SavedContext, used: VoiceToolName[], metricId: string) {
  void call(ctx, used, "highlight_metric", { metric_id: metricId }, async () => ctx.tools.highlightMetric?.(metricId));
}

function carAnswer(ctx: SavedContext): string {
  const p = ctx.futures.paths[ctx.path];
  const carEvent = p.events.find((e) => e.title === "Car paid off");
  const car = carEvent ? mon(carEvent.date) : undefined;
  const early = carEvent?.description.match(/\d+ months? early/)?.[0];
  const card = key(p, "card_debt");
  const shared = p.events.find((e) => e.shared);
  const how: LifeEvent | undefined = shared && p.events.find((e) => !e.shared && e.title.startsWith(shared.title));
  const repair = shared && how ? `When the ${shared.title.toLowerCase()} hit in ${mon(shared.date)}, ${lowerFirst(how.description)}` : "";
  if (ctx.path === "same_path") {
    const interest = key(p, "card_interest")?.display;
    const cardLine =
      card && Number(card.value) > 0
        ? ` But that card never really went away: it's still at ${card.display}${interest ? `, and I've paid about ${interest} in interest on it` : ""}.`
        : "";
    return `The car itself? ${car ? `It's been paid off since ${car}.` : "I'm still paying it off."} ${repair}${cardLine}`.replace(/\s+/g, " ").trim();
  }
  const cardPaid = p.events.find((e) => e.title === "Card paid off");
  const cardLine = cardPaid ? `The card's been at $0 since ${mon(cardPaid.date)}` : card ? `The card is at ${card.display}` : "";
  const carLine = car ? `the car was paid off in ${car}${early ? `, ${early}` : ""}` : "";
  const last = [cardLine, carLine].filter(Boolean).join(", and ");
  return `Yes. ${repair}${last ? ` ${last[0].toUpperCase()}${last.slice(1)}.` : ""}`.replace(/\s+/g, " ").trim();
}

/** Yes words; a clear yes is made only of these (e.g. "yes", "yes please", "ok do it"). */
const YES_WORDS = "yes|yeah|yep|yup|sure|ok|okay|alright|all right|please|do it|please do|go ahead|let'?s do it|sounds good|set it up|start it|absolutely|definitely";
const ONLY_YES = new RegExp(`^(?:${YES_WORDS})(?: (?:${YES_WORDS}))*$`);
/** "Yes, move $150 from Spend to savings every payday": a yes that only repeats the offer back. */
const YES_RESTATED = /^(?:yes|yeah|yep|ok|okay|sure) (?:please )?(?:move|set up|schedule|start|transfer|do)\b/;
/** Anything that makes it a question or a condition, not a yes. */
const NOT_A_YES = /\?|\b(but|if|what|how|why|when|wait|maybe|not|no|don'?t|can'?t|later|hold on|unless|instead|lose|job)\b/;

/** Only a clear yes counts: the whole message is a yes phrase (or a yes that repeats the offer exactly). */
export function isClearYes(text: string, offeredAmount?: number): boolean {
  const t = text.toLowerCase().trim();
  if (NOT_A_YES.test(t)) return false;
  const plain = t.replace(/[.,!]+/g, " ").replace(/\s+/g, " ").trim();
  if (ONLY_YES.test(plain)) return true;
  if (!YES_RESTATED.test(plain)) return false;
  // Repeating it back must not change the amount.
  const said = amounts(text);
  return said.length === 0 || (said.length === 1 && said[0] === offeredAmount);
}

/** What a what-if leaves out, said after the engine's sentence. No numbers: those only come from the engine. */
const LEAVES_OUT: Partial<Record<string, string>> = {
  // The engine's home and car sentences already say what they leave out (upkeep; insurance, gas and repairs).
  buy_home: "It's not a loan approval.",
  buy_car: "It's not a loan approval.",
  new_job: "That leaves out things like benefits and moving costs.",
  move: "That leaves out moving costs.",
  job_loss: "That leaves out unemployment pay and any severance.",
  big_purchase: "That leaves out any interest if it goes on the card for long.",
};

/** "Buy a $30,000 car...", "afford a $30k car": a car purchase with a price. Not the car repair or the car loan she has. */
const CAR_BUY = /\b(?:buy|buying|afford|get|getting)\s+(?:a|an)\s+(?:new\s+|used\s+)?(?:\$\s?[\d,]+(?:\.\d+)?k?\s+)?(?:new\s+|used\s+)?(?:car|truck|suv)\b/;

export function isCarPurchase(t: string): boolean {
  return CAR_BUY.test(t) && /\$\s?\d/.test(t) && !/repair|transmission|worth it|paid off|pay off/.test(t);
}

const money = (m: RegExpMatchArray | null) => (m ? Number(m[1].replace(/,/g, "")) * (m[2] ? 1000 : 1) : undefined);

/** Reads the user's own words. Defaults (the app's): $0 down, 8% APR, 60 months. The engine does the math. */
function parseCar(t: string, nums: number[]): CarPurchase {
  const price = money(t.match(/\$\s?([\d,]+(?:\.\d+)?)(k)?\s+(?:new\s+|used\s+)?(?:car|truck|suv)\b/)) ?? Math.max(...nums);
  const down =
    money(t.match(/\$\s?([\d,]+(?:\.\d+)?)(k)?\s*(?:down\b|as a down payment)/)) ??
    (/no money down|nothing down/.test(t) ? 0 : nums.find((x) => x !== price && x < price) ?? 0);
  const apr = Number(t.match(/(\d+(?:\.\d+)?)\s?%(?!\s*down)/)?.[1] ?? 8);
  const mm = t.match(/\b(\d+)\s*-?\s*months?\b/);
  const yy = t.match(/\b(\d+|one|two|three|four|five|six|seven)\s*-?\s*years?\b/);
  const years = yy ? Number(yy[1]) || WORD_NUM[yy[1]] || 0 : 0;
  const term_months = mm ? Number(mm[1]) : years ? years * 12 : 60;
  return { price, down, apr, term_months };
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
  if (/\b(approved?|approval|qualify|eligible|pre-?approv\w*)\b/.test(t)) {
    return done("I can't tell you if you'd be approved for a loan or credit. A PNC banker can look at that with you. This app is just for learning.");
  }
  if (/\d[\d,]*\s*(plus|minus|times|divided by|\+|-|\*|\/)\s*\$?\d/.test(t)) {
    return done("I don't do math in my head. The app can show you that.");
  }

  // Money moves only after a clear yes, and then only when the user taps Yes on the screen.
  if (ctx.memory.offeredTransfer && ctx.path === "plan") {
    if (/^(maybe|not sure|hmm|i don'?t know|i guess)/.test(t)) {
      return done(`No rush. ${offerText(ctx)}`);
    }
    if (/^(no|nope|not now|no thanks)\b/.test(t)) {
      ctx.memory.offeredTransfer = false;
      return done("No problem. It's there whenever you want it.");
    }
    const ns = ctx.futures.next_step;
    if (isClearYes(text, ns.amount)) {
      const input = {
        amount: ns.amount,
        from_account_id: ns.from_account_id,
        to_account_id: ns.to_account_id,
        frequency: ns.frequency,
      };
      ctx.memory.offeredTransfer = false;
      const res = await propose(ctx, used, input);
      if (res.status === "already_scheduled") {
        return done("It's already set up. It's a simulated demo transfer, and you can stop it any time on the Next step screen.");
      }
      if (res.status !== "awaiting_tap") return done("Hmm, that part's fuzzy for me. Can you ask me again?");
      return done("It's on your screen now. Check the details, and tap yes if it looks right. It's a simulated demo transfer, so no real money moves.");
    }
    // Anything else (a question, a "but", a "what if") isn't a yes: answer it below, offer still open.
  }

  // What-ifs: plan path only.
  const isCar = isCarPurchase(t);
  const isWhatIf = isCar || /what if|austin|new job|a raise|pay cut|lose my job|job loss|laid off|save \$|move to|cheaper place|buy a /.test(t);
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
    } else if (isCar) {
      input = { description: text, preset: "buy_car", car: parseCar(t, nums) };
    } else if (/\bbuy (a|an|my first)\b[^.?!]*\b(home|house|condo|place)\b/.test(t)) {
      const price = nums.find((x) => x >= 50000) ?? 250000;
      // "5% down at 6.5%": a percent followed by "down" is the down payment, never the rate.
      const downPct = t.match(/(\d+(?:\.\d+)?)\s?%\s*(?:down|as a down payment)/)?.[1];
      const down = nums.find((x) => x >= 1000 && x < price) ?? Math.round((price * Number(downPct ?? 5)) / 100);
      const rate = Number(t.match(/(\d+(?:\.\d+)?)\s?%(?!\s*(?:down|as a down payment))/)?.[1] ?? 6.5);
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
    let res: Awaited<ReturnType<VoiceTools["updatePlan"]>>;
    try {
      res = await call(ctx, used, "update_plan", input as Record<string, unknown>, () => ctx.tools.updatePlan(input));
    } catch {
      return done("Hmm, that part's fuzzy for me. Can you ask me again?");
    }
    const leavesOut = LEAVES_OUT[input.preset ?? "custom"];
    let reply = `${res.sentence}${leavesOut ? ` ${leavesOut}` : ""} It's a what-if to learn from, not advice.`;
    if (!scheduled(ctx) && ctx.futures.next_step.amount > 0) {
      ctx.memory.offeredTransfer = true;
      reply += ` Want me to set up that ${ctx.futures.next_step.amount.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 })} transfer from Spend to savings, every payday?`;
    }
    return done(reply);
  }

  if (/next step|what should i do|where do i start|transfer|set (it|that) up/.test(t)) {
    if (ctx.path === "same_path") return done("On my path, I never started one. The plan side can set it up with you.");
    if (scheduled(ctx)) return done("It's already set up. It's a simulated demo transfer, so no real money moves, and you can stop it any time.");
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
    asked(/\binterest\b/, ".card_interest", (d) => `About ${d} in card interest since ${ctx.futures.as_of.slice(0, 4)}.`) ??
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
