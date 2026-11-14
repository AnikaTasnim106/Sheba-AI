# Sheba AI

A Bangla-first AI assistant that walks citizens, at home or abroad, through Bangladesh government services, and checks their documents before they apply. Every answer is grounded in cited sources.

Team **Inverse** · International AI Builders Congress 2026 · CivicSphere AI → Citizen First

## What it does

- **Understands any phrasing** in Bangla, Banglish or English. An LLM turns each message into structured slots (service, location, country, wrong NID field, passport options, broker mention). The app then decides the next step deterministically, so the flow stays predictable.
- **Asks only the follow-up that changes the answer**: in Bangladesh or abroad, which NID field is wrong.
- **Grounded answers (RAG)**: BM25 retrieval over a curated knowledge base (26 passages, 17 sources), then the LLM answers only from the retrieved passages and returns which ones it used. Those are shown as source chips; "কেন এই উত্তর?" shows the retrieved passages with scores.
- **Document check**: upload a photo of the NID and of the SSC certificate or birth registration. A vision model reads both, finds mismatches (e.g. date of birth 12 March on the NID vs 21 March on the SSC), says which document supports the correction, and fills the correction form draft.
- **Case file**: steps, document checklist, official fee, time, form draft, sources with a last-verified date.
- **Exact passport fees** for any pages / validity / delivery option.
- **Broker guard**: compares what a middleman asks for with the official fee.
- **Privacy by design**: ID-number-like digits are masked in the browser before anything is sent; the server strips ID numbers from AI output; document photos are processed in memory and never stored; the app never asks for passwords or OTPs.
- **Honest limits**: services not yet covered get a clear "not yet", never a guess.
- **Works without the AI server too**: if the API is unreachable, the page falls back to keyword understanding and answers straight from the knowledge base.

Covered services: NID correction, lost NID, e-passport (new / renew, in Bangladesh and abroad), lost passport.

## Deploy (free, about 10 minutes)

1. **Get a Gemini API key**: go to https://aistudio.google.com/apikey, sign in, click *Create API key*, copy it. Never put the key in the code or in GitHub.
2. **Push this folder to a GitHub repo** (public is fine; the key is not in the code).
3. **Import into Vercel**: https://vercel.com/new → import the repo → Framework Preset: *Other* → leave build settings empty.
4. **Add the key**: in the import screen (or later in Settings → Environment Variables) add `GEMINI_API_KEY` = your key. Optional: `GEMINI_MODEL` to force a model.
5. **Deploy.** Open the URL. The pill at the top should say "লাইভ AI · যাচাই করা সূত্র". If it says "যাচাই করা তথ্যভান্ডার", the key is missing; add it and redeploy.

The server tries `gemini-3.8-flash`, then `gemini-3.6-flash`, `gemini-3.5-flash-lite`, `gemini-2.5-flash` until one answers, so it keeps working if a model is not on your plan.

**Run locally:** `GEMINI_API_KEY=your-key node dev/server.mjs`, then open http://localhost:3000 (Node 20+, no install needed).

## Layout

| Path | What |
| --- | --- |
| `public/index.html` | The app: chat, case file, document check, offline fallback |
| `public/samples/` | Two clearly labelled **sample** documents (fictional person) to try the document check |
| `api/chat.js` | `understand` (LLM slot extraction) and `answer` (retrieval + grounded LLM answer) |
| `api/vision.js` | Document check: read, compare, recommend; ID numbers removed |
| `lib/kb.js` | Knowledge base, passport fee table, BM25 retrieval (shared with the frontend) |
| `lib/gemini.js` | Gemini REST client with model fallback, JSON parsing, ID scrubbing, rate limit |
| `kb/knowledge-base.json` | The same knowledge base as JSON |
| `prompts/` | The three system prompts used in production |

## Data and limits

Facts come from official government pages and published news reports, last checked 14 Nov 2026. Rules and fees change; the app always asks users to confirm on the official portal. NID correction fees vary by correction type, so the app links to the official fee page instead of quoting a number. Abroad passport fees are set per mission in USD.

## Next, for the final round

- Scheduled re-crawl of official pages with change detection
- More services: trade license, land mutation (e-namjari), birth registration
- Bangla voice answers for low-literacy users
- Evaluation set of real citizen questions with hand-checked answers
