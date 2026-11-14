// POST /api/chat  {mode:"understand", text, state}      -> {f}  (slots the frontend merges)
// POST /api/chat  {mode:"answer", text, state, history} -> {reply, used, hits}
// GET  /api/chat                                        -> {ok, ai}
import { geminiJSON, hasKey, scrubIds, limited } from "../lib/gemini.js";
import { SRC, FEES, SVC, retrieve } from "../lib/kb.js";

const UNDERSTAND = `You read one message a citizen wrote to Sheba AI, a guide for Bangladesh government services. The message may be Bangla, Banglish (Bangla in Latin letters) or English, often informal or misspelled.
Use the conversation state for context (e.g. a short reply like "dhaka" answers the earlier location question).
Supported services:
- nid_correction: fixing wrong information on a National ID (name, date of birth, address...)
- nid_lost: a lost or damaged National ID card
- passport: new e-passport or renewal
- passport_lost: a lost, stolen or damaged passport
Anything else government-related (trade license, land, birth registration, tax...) is "unsupported"; small talk or unclear is "unknown".
Return ONLY this JSON (null when not stated, never guess):
{"service":"nid_correction|nid_lost|passport|passport_lost|unsupported|unknown",
 "unsupported_name_bn":string|null,
 "location":"bd|abroad"|null,
 "country_bn":string|null,
 "nid_field":"dob|name|address"|null,
 "passport_kind":"new|renew"|null,
 "pages":48|64|null, "validity":5|10|null, "delivery":"regular|express|super"|null,
 "broker":boolean, "broker_amount_bdt":number|null,
 "mentions_secret":boolean}
broker = someone (dalal, middleman, office staff, agent) asks for money beyond the official fee. mentions_secret = the message mentions an OTP, password or PIN.`;

const ANSWER = `You are Sheba AI, a guide for Bangladesh government services.
Rules:
- Answer ONLY from the numbered SOURCES and the FACTS block. If they don't answer the question, say plainly that you are not sure and point to the official portal. Never guess fees, dates, offices or requirements.
- Never ask for passwords, OTPs or ID numbers. Never repeat an ID number.
- Reply in the user's language: Bangla script if they wrote Bangla or Banglish, English if they wrote English. Simple words, short sentences, at most 120 words, no headings, no markdown.
- Answer the user's actual question first, then give one short next step.
- Don't paste URLs or list sources; the app shows them.
Return ONLY JSON: {"reply": string, "used": [source numbers you relied on]}`;

function send(res, code, obj) { res.statusCode = code; res.setHeader("content-type", "application/json; charset=utf-8"); res.end(JSON.stringify(obj)); }

async function readBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  let raw = ""; for await (const c of req) raw += c; return raw ? JSON.parse(raw) : {};
}

function stateLine(s = {}) {
  return JSON.stringify({ service: s.svc || null, location: s.loc || null, country: s.country || null, nid_field: s.field || null,
    pages: s.pages || null, validity: s.validity || null, delivery: s.delivery || null, kind: s.kind || null });
}

export default async function handler(req, res) {
  if (req.method === "GET") return send(res, 200, { ok: true, ai: hasKey() });
  if (req.method !== "POST") return send(res, 405, { error: "method_not_allowed" });
  if (limited(req)) return send(res, 429, { error: "rate_limited" });
  let body; try { body = await readBody(req); } catch { return send(res, 400, { error: "bad_json" }); }
  const text = String(body.text || "").slice(0, 600);
  const state = body.state || {};
  if (!text) return send(res, 400, { error: "empty" });

  try {
    if (body.mode === "understand") {
      const { json, model } = await geminiJSON({
        system: UNDERSTAND,
        parts: [{ text: `Conversation state: ${stateLine(state)}\nLast question Sheba AI asked: ${body.lastQuestion || "none"}\nMessage: ${text}` }],
        temperature: 0, speed: "fast", timeoutMs: 9000, perTryMs: 6000,
      });
      const j = json || {};
      const f = {};
      if (["nid_correction", "nid_lost", "passport", "passport_lost"].includes(j.service)) f.svc = j.service;
      if (j.service === "unsupported") f.soon = j.unsupported_name_bn || "এই সেবা";
      if (j.location === "bd" || j.location === "abroad") f.loc = j.location;
      if (j.country_bn && j.location === "abroad") f.country = String(j.country_bn).slice(0, 40);
      if (["dob", "name", "address"].includes(j.nid_field)) f.field = j.nid_field;
      if ([48, 64].includes(j.pages)) f.pages = j.pages;
      if ([5, 10].includes(j.validity)) f.validity = j.validity;
      if (["regular", "express", "super"].includes(j.delivery)) f.delivery = j.delivery;
      if (["new", "renew"].includes(j.passport_kind)) f.kind = j.passport_kind;
      if (j.broker) f.broker = Number.isFinite(j.broker_amount_bdt) && j.broker_amount_bdt >= 50 ? Math.round(j.broker_amount_bdt) : true;
      if (j.mentions_secret) f.secret = true;
      return send(res, 200, { f, model });
    }

    if (body.mode === "answer") {
      const svc = SVC[state.svc] ? state.svc : null;
      const history = (Array.isArray(body.history) ? body.history : []).slice(-6).join(" ");
      const hits = retrieve(`${history} ${text}`, svc, state.loc, 5);
      const sources = hits.map((h, i) => `[${i + 1}] ${h.c.t} (${SRC[h.c.src].t})`).join("\n");
      let facts = `Service: ${svc ? SVC[svc].name : "unknown"}. Official portal: ${svc ? SVC[svc].portalName : "-"}. User location: ${state.loc === "abroad" ? (state.country || "abroad") : state.loc === "bd" ? "Bangladesh" : "unknown"}.`;
      if (svc === "passport" && state.loc !== "abroad" && state.pages && state.validity && state.delivery)
        facts += ` Official fee for the user's choice (${state.pages} pages, ${state.validity} years, ${state.delivery}): BDT ${FEES[state.pages][state.validity][state.delivery]} including VAT.`;
      const { json, model } = await geminiJSON({ system: ANSWER, parts: [{ text: `FACTS: ${facts}\nSOURCES:\n${sources}\n\n${history ? `Earlier messages from the user (for context): ${history}\n` : ""}User: ${text}` }], temperature: 0.2, speed: "fast", timeoutMs: 15000, perTryMs: 9000 });
      const used = (Array.isArray(json.used) ? json.used : []).map(n => hits[n - 1]).filter(Boolean).map(h => h.c.src);
      return send(res, 200, {
        reply: scrubIds(String(json.reply || "")).slice(0, 1500),
        used: [...new Set(used)],
        hits: hits.map(h => ({ id: h.c.id, t: h.c.t, src: h.c.src, s: Number(h.s.toFixed(2)) })),
        model,
      });
    }
    return send(res, 400, { error: "unknown_mode" });
  } catch (e) {
    return send(res, e.code === "no_key" ? 503 : 502, { error: e.code || "ai_failed", detail: String(e.message).slice(0, 200) });
  }
}
