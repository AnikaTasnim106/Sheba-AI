// POST /api/vision {images:[{mime, data(base64)}]} -> document fields, mismatches and a recommendation.
// Images are processed in memory and never stored. ID numbers are never returned.
import { geminiJSON, scrubIds, limited } from "../lib/gemini.js";

export const config = { api: { bodyParser: { sizeLimit: "4mb" } } };

const SYSTEM = `You check identity documents for a Bangladeshi citizen who wants to correct their National ID (NID).
You get 1 to 3 photos: usually the NID card and a proof document (SSC or equivalent exam certificate, or a birth registration certificate). Text may be Bangla or English.
For each image, read: document type, the holder's name in English and in Bangla, father's name, mother's name, date of birth.
STRICT RULES:
- NEVER output any ID, registration, roll, serial or certificate number, even partly. Only say whether one is present.
- If a field is unreadable or absent, use null. Do not guess.
- Write dates as YYYY-MM-DD.
- Compare the same field across documents. Treat spelling variants of the same name across scripts as matching; flag real differences (different letters in the English spelling, different dates, different parent names).
- Under Bangladesh's NID correction rules, a name or date-of-birth correction is supported by the online birth registration certificate and the SSC (or equivalent) certificate. When the NID disagrees with those, the proof documents' value is the likely correct one.
- If an image is not one of these documents, say so in its notes.
Write explanations in simple Bangla.
Return ONLY JSON:
{"documents":[{"type":"nid|ssc_certificate|birth_certificate|passport|other","label_bn":string,"readable":boolean,"has_id_number":boolean,
  "fields":{"name_en":string|null,"name_bn":string|null,"father":string|null,"mother":string|null,"dob":string|null},"notes_bn":string|null}],
 "mismatches":[{"field":"name_en|name_bn|father|mother|dob","nid_value":string|null,"proof_value":string|null,"proof_doc_index":number|null,"explanation_bn":string}],
 "nid_field_to_correct":"dob|name|null",
 "recommendation_bn":string}`;

function send(res, code, obj) { res.statusCode = code; res.setHeader("content-type", "application/json; charset=utf-8"); res.end(JSON.stringify(obj)); }
async function readBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  let raw = ""; for await (const c of req) raw += c; return raw ? JSON.parse(raw) : {};
}

export default async function handler(req, res) {
  if (req.method !== "POST") return send(res, 405, { error: "method_not_allowed" });
  if (limited(req, 10, "vision")) return send(res, 429, { error: "rate_limited" });
  let body; try { body = await readBody(req); } catch { return send(res, 400, { error: "bad_json" }); }
  const images = (Array.isArray(body.images) ? body.images : []).slice(0, 3)
    .filter(im => /^image\/(jpeg|png|webp)$/.test(im?.mime) && typeof im.data === "string" && im.data.length < 1_800_000);
  if (!images.length) return send(res, 400, { error: "no_images" });
  try {
    const parts = [{ text: `There are ${images.length} document photo(s), in order 0..${images.length - 1}.` },
      ...images.map(im => ({ inlineData: { mimeType: im.mime, data: im.data } }))];
    const { json, model } = await geminiJSON({ system: SYSTEM, parts, temperature: 0, speed: "full", timeoutMs: 55000, perTryMs: 35000 });
    const out = scrubIds(json || {});
    out.documents = (Array.isArray(out.documents) ? out.documents : []).slice(0, 3);
    out.mismatches = (Array.isArray(out.mismatches) ? out.mismatches : []).slice(0, 6);
    return send(res, 200, { ...out, model });
  } catch (e) {
    return send(res, e.code === "no_key" ? 503 : 502, { error: e.code || "ai_failed", detail: String(e.message).slice(0, 200) });
  }
}
