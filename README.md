# NyayaDesk — Agentic Client Intake for Law Firms

**Aerophilia 2026 · Agentic AI Hackathon · Track: Client Intake Agent (Legal / Professional Services)**

NyayaDesk is an AI intake agent for a law firm. It handles a prospect's first contact over chat, email or a web form and works through the whole intake on its own:

1. Classifies the legal matter and detects urgency.
2. Runs the intake questions for that practice area and stores the answers as structured data.
3. Runs a **conflict-of-interest check** against the firm's client and adverse-party records.
4. **Screens** the matter against the firm's criteria: practice area, jurisdiction, limitation period, minimum value.
5. **Books** a consultation with the right attorney and writes an **attorney brief**.
6. Answers fee and scope questions from the firm's fee sheet, and never gives legal advice.
7. **Declines** unqualified inquiries with a useful referral, so no staff time is spent on them.

Attorneys only meet qualified prospects, and they get the brief before the meeting.

## Demo

**Live:** https://agentxteam.netlify.app · **Video:** <add YouTube link>

The site opens in **Gemini live mode** by default. Use the scenario buttons:

| Scenario | What the agent does |
|---|---|
| ✅ Qualified → booked | Property / builder-delay case → all 7 fields → conflict clear → screening pass → slots → booking → attorney brief. It also answers a fee question in the middle of the chat. |
| ⚠️ Conflict of interest | Employment case against **Coastal Builders**, an existing client → stops and sends the matter to human review, **without telling the prospect** who the conflicting client is |
| ⛔ Out of scope | Criminal / bail inquiry → recognised as urgent and out of scope → declined at once with a free legal-aid referral |
| 🌍 Outside jurisdiction | Tenancy case in Kochi below the value threshold → declined with the reasons and a referral |

The **Attorney Dashboard** shows the pipeline (intake → qualified/booked → human review → declined) and KPIs, including estimated staff hours saved. Click any card to see the full brief, screening checks and transcript.

## Roles: Client · Advocate · Admin

Sign in with email and password. Click **View demo accounts** below the Sign in button to see every mock login and fill the form with one click:

| Role | Email | Password | What they see |
|---|---|---|---|
| **Client** | `sunita.bhat@client.demo`, `rahul.kamath@client.demo`, `vikram.hegde@client.demo`, `sneha.kamath@client.demo` (or any other email) | `client123` | Intake chat with the AI agent, plus **My Cases** with live status |
| **Advocate** | `priya.rao@karavalilaw.in`, `kiran.shetty@karavalilaw.in`, `meera.pai@karavalilaw.in` | `adv123` | **My Dashboard**: cases flagged for human review (with **Approve / Not approved**), upcoming consultations and past decisions |
| **Admin** | `admin@karavalilaw.in` | `admin123` | Firm dashboard, **Activity Log** of every notification, firm database, agent settings |

**Shared data across devices:** all roles read and write one shared store in **Netlify Blobs** through `netlify/functions/store.mjs`, so the client, advocate and admin can each use a **different laptop**. Each device checks for updates every 2.5 seconds, and the header shows **☁ Synced across devices**. If the server can't be reached, the app falls back to sharing between tabs of one browser (**💻 This device only**). The admin's **Reset demo data** button (Activity Log) clears every device and reloads the sample data.
- When a consultation is **booked**, the advocate, the admin and the client get a 🔔 notification.
- When the agent flags a case for **human review** (for example a conflict of interest), it goes to the advocate for that practice area.
- If the advocate clicks **Not approved**, the client's chat and My Cases update at once with a polite decline and a referral.
- If the advocate clicks **Approve**, the client gets slot buttons. Picking one books the consultation through the agent, and the advocate is notified.

**Demo flow:** Tab 1, `sunita.bhat@client.demo`: run ⚠️ Conflict of interest. Tab 2, `meera.pai@karavalilaw.in`: the case appears; click Not approved. Tab 1 updates live. Tab 3, `admin@karavalilaw.in`: the Activity Log shows every step.

## Agentic architecture

```
Prospect message
      │
      ▼
 ┌──────────┐   update_plan        ┌────────────────────────────┐
 │ OBSERVE  │─────────────────────▶│ PLAN (6-step live plan)    │
 └──────────┘                      └────────────┬───────────────┘
      ▲                                         ▼
      │                         ┌──────────────────────────────────┐
      │                         │ ACT — choose next tool:          │
      │   tool results          │ classify_matter                  │
      └─────────────────────────│ get_intake_questions             │
                                │ extract_entities                 │
                                │ save_intake_field                │
                                │ run_conflict_check   (firm DB)   │
                                │ verify_location  (India Post API)│
                                │ screen_matter        (rules)     │
                                │ search_fee_faq       (KB)        │
                                │ check_attorney_availability      │
                                │ book_consultation  (calendar+.ics)│
                                │ generate_attorney_brief          │
                                │ flag_for_human_review            │
                                │ send_decline                     │
                                └──────────────────────────────────┘
```

The loop is **observe → plan → act → observe** and repeats until it reaches one of three outcomes: **booked + briefed**, **human review**, or **declined + referred**. Each step (reasoning, tool call, tool result) appears live in the trace panel.

There are two interchangeable "brains". Both use the **same tools and state**:

- **Gemini live mode (default).** The LLM plans and picks tools through native function calling (`gemini-3.5-flash-lite`). Requests go through a Netlify serverless function (`netlify/functions/gemini.mjs`) that adds the API key on the server (from the `GEMINI_API_KEY` environment variable), so the key never reaches the browser.
- **Offline planner.** A deterministic policy that needs no API key, so the demo still works if the Wi-Fi drops on stage. If a live call fails, the agent falls back to this planner automatically for that turn.

### Robustness
- If Gemini returns 429 or 5xx, the agent retries twice with backoff, then falls back to the offline planner for that turn.
- When a tool returns an error, the agent reads it, corrects itself and tries again.
- If the India Post API is down, `verify_location` uses a local city list and records the source it used.

### Guardrails
- The conflict check always runs before screening or booking. A conflict hit stops the autonomous flow and sends the matter to a human.
- Other clients' names are never shown to a prospect.
- Fee and scope answers come only from the firm's knowledge base, and the agent gives no legal advice.
- Every decision records its rule, the result and the reason, so it can be audited.

## Tech
- Frontend: a single `index.html`, vanilla JS, no dependencies, about 1,000 lines.
- Backend: one Netlify Function (`netlify/functions/gemini.mjs`) that proxies calls to the Gemini API and keeps the key server-side.
- External APIs: Google Gemini (`generateContent` with function calling) for reasoning, and the **India Post PIN code API** (`api.postalpincode.in`) as a tool the agent calls to verify the prospect's real state and district for the jurisdiction check.
- Booking creates a real **.ics calendar invite** that the prospect can download.
- **Multilingual:** the agent replies in English, Kannada, Hindi, Tulu or Malayalam, and always stores intake fields in English.
- Mock firm data (clients, adverse parties, attorneys, rules, fee sheet) is defined in the file. **All data is fictional.**
- The conflict check uses fuzzy name matching: Jaccard + Levenshtein after removing legal suffixes such as Pvt Ltd and LLP.
- Intake parsing understands Indian formats: ₹ lakh/crore amounts, relative dates and Karnataka place names.

## Run / Deploy
1. Fork or clone this repo and connect it to Netlify (*Add new site → Import from Git*).
2. In *Site configuration → Environment variables*, add `GEMINI_API_KEY` with a key from [Google AI Studio](https://aistudio.google.com).
3. Deploy. The site runs in live mode with no key typed into the browser.

To run locally: `npm i -g netlify-cli`, put `GEMINI_API_KEY=...` in a `.env` file (git-ignored), then run `netlify dev`.
Without a key, switch to **Offline planner** in *Agent settings*. Opening `index.html` directly also works in offline mode.

```
├── index.html                  # UI, agent loop, tools, mock firm DB
├── netlify/functions/gemini.mjs # server-side Gemini proxy (holds the API key)
├── netlify/functions/pincode.mjs# India Post PIN code lookup (external tool)
├── netlify/functions/store.mjs  # shared cross-device data (Netlify Blobs)
├── package.json                # @netlify/blobs dependency
└── netlify.toml
```

## How this meets the judging criteria

| Criterion | Weight | What we built |
|---|---|---|
| Agentic architecture | 30% | A true observe → plan → act loop. The LLM writes and updates its own plan (`update_plan`), picks from 14 tools through function calling, runs up to 12 steps a turn, recovers from tool errors, and decides on its own whether to book, decline or escalate. Guardrails are enforced in code, not only in the prompt: booking is refused unless screening is `qualified`. |
| Technical execution | 25% | Works live. The API key is server-side, calls retry with backoff, there is an offline fallback brain, and the external-API fallback records its source. All 4 scenarios were tested end to end. |
| Problem fit & impact | 20% | Covers the whole track: structured intake, then screening (conflict, practice area, verified jurisdiction, limitation period, minimum value), then a booked consultation, a calendar invite and an attorney brief. The dashboard shows estimated staff hours saved. |
| Innovation | 15% | Built for Indian law firms: ₹ lakh/crore and Karnataka places, jurisdiction checked against the real India Post directory, multilingual intake (Kannada/Hindi/Tulu/Malayalam), and conflict names kept confidential. |
| Presentation | 10% | A live plan, matter and trace panels show every step of reasoning. There are one-click demo scenarios, the attorney dashboard, and this README with the architecture diagram. |

**Rulebook technical requirements:** planning → tool use → action loop ✅ · external tool/API call (India Post API, Gemini) ✅ · mock data only ✅ · public repo + README ✅ · AI-assistant use disclosed ✅ · 2–3 min demo video (link above) ✅

## AI usage disclosure
As the rulebook allows, we used an AI coding assistant (**Claude**, by Anthropic) to plan the architecture, write parts of the code and draft this README. The team reviewed, tested and integrated all of the code.
At runtime, the agent's reasoning is done by **Google Gemini 3.5 Flash-Lite (with automatic fallback to backup models)**.

## Team
Team Dhoomakethu — MITE, Moodbidri
