// Minimal Gemini REST client: JSON output, optional images, model fallback.
const BASE = process.env.GEMINI_BASE || "https://generativelanguage.googleapis.com/v1beta";
const MODELS = [process.env.GEMINI_MODEL, "gemini-3.8-flash", "gemini-3.6-flash", "gemini-3.5-flash-lite", "gemini-2.5-flash"].filter(Boolean);
let working = null; // remember the first model that answered

export function hasKey() { return Boolean(process.env.GEMINI_API_KEY); }

export function parseJSON(text) {
  let t = String(text || "").trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
  try { return JSON.parse(t); } catch {}
  const s = Math.min(...["{", "["].map(c => t.indexOf(c)).filter(i => i >= 0));
  const e = Math.max(t.lastIndexOf("}"), t.lastIndexOf("]"));
  if (Number.isFinite(s) && e > s) return JSON.parse(t.slice(s, e + 1));
  throw new Error("invalid_json");
}

export async function geminiJSON({ system, parts, temperature = 0.2 }) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) { const e = new Error("GEMINI_API_KEY is not set"); e.code = "no_key"; throw e; }
  const order = [...new Set(working ? [working, ...MODELS] : MODELS)];
  let lastErr;
  for (const model of order) {
    const res = await fetch(`${BASE}/models/${model}:generateContent`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: "user", parts }],
        generationConfig: { responseMimeType: "application/json", temperature },
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      lastErr = new Error(`Gemini ${model} ${res.status}: ${body.slice(0, 300)}`);
      lastErr.status = res.status;
      // Model missing, not on this plan, or rate-limited: try the next model.
      if ([403, 404, 429, 500, 503].includes(res.status)) continue;
      throw lastErr;
    }
    const data = await res.json();
    const text = (data.candidates?.[0]?.content?.parts || []).map(p => p.text || "").join("");
    if (!text) { lastErr = new Error(`Gemini ${model}: empty reply`); continue; }
    working = model;
    return { json: parseJSON(text), model };
  }
  throw lastErr || new Error("No Gemini model answered");
}

// Remove anything that looks like an ID number (10–17 digits) from model output.
export function scrubIds(value) {
  if (typeof value === "string") return value.replace(/[0-9০-৯][0-9০-৯\s-]{8,20}[0-9০-৯]/g, m => (m.replace(/\D/g, "").length >= 10 || /[০-৯]{10,}/.test(m.replace(/\s|-/g, ""))) ? "•••••" : m);
  if (Array.isArray(value)) return value.map(scrubIds);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, scrubIds(v)]));
  return value;
}

// Best-effort per-instance rate limit so a public demo key isn't drained.
const hits = new Map();
export function limited(req, max = 30, bucket = "chat", windowMs = 60_000) {
  const ip = (req.headers["x-forwarded-for"] || "").split(",")[0] || req.socket?.remoteAddress || "x";
  const now = Date.now();
  const k = bucket + ":" + ip;
  const arr = (hits.get(k) || []).filter(t => now - t < windowMs);
  arr.push(now); hits.set(k, arr);
  return arr.length > max;
}
