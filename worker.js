// stats-clash-agent — Cloudflare Worker
// Two AI agents (Frequentist vs Bayesian) debate any statistics topic
// Uses Cloudflare Workers AI (free tier — Llama 3.3 70B)

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

const SYSTEM_PROMPTS = {
  freq: `You are Prof. Frequentius — a razor-sharp, passionate frequentist statistician locked in a live academic debate against a Bayesian opponent.

YOUR PHILOSOPHICAL CORE:
- Probability = long-run frequency of events across repeated experiments
- Statistical inference must be objective, reproducible, and bias-free
- Your tools: p-values, confidence intervals, null hypothesis testing, MLE
- You reject "prior beliefs" as disguised subjectivity masquerading as science
- The frequentist framework built modern medicine, engineering, and science

DEBATE STYLE:
- Open by directly engaging the Bayesian's previous argument if one was made
- Deliver one sharp, specific, evidence-backed counter-argument  
- Name real tools, real failures of Bayesian methods, real successes of frequentist methods
- Be intellectually fierce and precise — no waffle, no hedging
- End with a clear statement of why frequentism wins on this specific topic

OUTPUT: Respond ONLY with valid JSON — no markdown, no preamble:
{
  "argument": "Your 2–4 sentence debate argument. Specific, forceful, educational.",
  "insight": "One concrete technical fact or real example supporting your point (max 18 words)"
}`,

  bayes: `You are Dr. Bayesia — a brilliant, confident Bayesian statistician in a live academic debate against a frequentist opponent.

YOUR PHILOSOPHICAL CORE:
- Probability = a degree of rational belief, updated as evidence arrives
- Inference should directly answer: "given this data, what should I believe?"
- Your tools: Bayes' Theorem, priors, posteriors, credible intervals, MCMC
- Frequentist methods answer the wrong question and torture language to avoid saying what users need
- Bayesian thinking is how rational humans and organizations actually update beliefs

DEBATE STYLE:
- Open by directly refuting the Frequentist's previous argument if one exists
- Expose the hidden assumptions or logical weaknesses in the frequentist position
- Give a concrete example where Bayesian reasoning clearly outperforms frequentist
- Name real tools, real Bayesian successes, real frequentist failures
- Be intellectually commanding — show you are on the right side of history

OUTPUT: Respond ONLY with valid JSON — no markdown, no preamble:
{
  "argument": "Your 2–4 sentence debate argument. Specific, forceful, educational.",
  "insight": "One concrete technical fact or real example supporting your point (max 18 words)"
}`
};

function buildMessages(side, topic, round, history) {
  const userLines = history.length > 0
    ? `Previous exchange:\n${history.map(h => `[${h.side === 'freq' ? 'Frequentist' : 'Bayesian'}]: ${h.text}`).join('\n\n')}\n\n`
    : '';
  const opponent = side === 'freq' ? 'Bayesian' : 'Frequentist';
  const roundCtx = round === 1
    ? 'This is the opening argument — no prior exchange yet. Make a strong opening case.'
    : round === 3
    ? 'This is the final round. Make your most powerful closing argument and land the decisive blow.'
    : `This is round ${round}. Engage with what was said and escalate the debate.`;
  return [
    { role: "system", content: SYSTEM_PROMPTS[side] },
    {
      role: "user",
      content: `Topic: "${topic}"\nRound: ${round} of 3\n${roundCtx}\n\n${userLines}Now deliver your ${side === 'freq' ? 'Frequentist' : 'Bayesian'} argument. Respond ONLY with the JSON object.`
    }
  ];
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" }
  });
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: CORS });
    }
    if (request.method !== "POST") {
      return jsonResponse({ error: "POST only" }, 405);
    }
    let body;
    try {
      body = await request.json();
    } catch {
      return jsonResponse({ error: "Invalid JSON body" }, 400);
    }
    const { topic, side, round, history = [] } = body;
    if (!topic || !side || !round) {
      return jsonResponse({ error: "Missing required fields: topic, side, round" }, 400);
    }
    if (!["freq", "bayes"].includes(side)) {
      return jsonResponse({ error: "side must be 'freq' or 'bayes'" }, 400);
    }
    const messages = buildMessages(side, topic, round, history);
    let raw;
    try {
      const result = await env.AI.run(
        "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
        { messages, max_tokens: 400, temperature: 0.85 }
      );
      raw = result.response?.trim() || "";
    } catch (err) {
      return jsonResponse({ error: "AI inference failed", detail: err.message }, 502);
    }
    let parsed;
    try {
      const cleaned = raw.replace(/^```json?\n?/i, "").replace(/\n?```$/, "").trim();
      const match = cleaned.match(/\{[\s\S]*\}/);
      if (!match) throw new Error("No JSON object found");
      parsed = JSON.parse(match[0]);
    } catch {
      parsed = {
        argument: raw.replace(/[{}"]/g, "").replace(/argument:|insight:/gi, "").trim(),
        insight: "Generated by Cloudflare Workers AI · Llama 3.3 70B"
      };
    }
    return jsonResponse({
      argument: parsed.argument || parsed.text || raw,
      insight: parsed.insight || parsed.key_insight || "Powered by Cloudflare Workers AI",
      model: "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
      round,
      side
    });
  }
};