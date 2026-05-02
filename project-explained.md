# Project Explained — Plain English Guide

> This document explains what the project does, why each decision was made, what every script does, and all the ServiceNow and AI concepts involved. Written for someone who built the project (or is reading it fresh) and wants to understand **why**, not just **what**.

---

## Part 1 — The Big Picture

### What problem are we solving?

Imagine you are on a Tier 2 or Tier 3 support team. Your job is to handle escalated, complex incidents — the ones that L1 couldn't solve. These incidents often involve investigating logs, checking code, changing system configurations, or tweaking workflows.

Here is what typically goes wrong:

1. **The same problem gets re-investigated from scratch every time.** An engineer named Priya solves a tricky SAML login loop on Monday. She writes a one-line note in the resolution field, closes the ticket, and moves on. Two weeks later, a new engineer named Ravi gets the same problem and spends three hours figuring it out again — from scratch. Priya's knowledge never survived the ticket.

2. **Fixes in stories never get documented.** A developer fixes a Business Rule in a Sprint story. They write acceptance criteria and some brief work notes, close the story, and move on. No KB article exists. Nobody remembers what was changed, why, or how to undo it.

3. **Onboarding new L2/L3 engineers is slow.** Because there is no real documentation of *how* past incidents were actually resolved — just "close notes" that say things like "Rebooted the service" with no context.

### What this project does about it

This project builds three automated workflows inside ServiceNow:

| Workflow | Trigger | What it produces |
| -------- | ------- | ---------------- |
| **A — Cluster → KB** | Weekly scheduled job | Finds groups of similar incidents that keep recurring with no KB, writes a draft KB article from all of their resolution notes using AI |
| **B — Resolution Suggester** | Incident gets assigned to L2/L3 group | On the incident form, shows the engineer the top 3 similar past incidents with their resolution notes and any linked KBs — *before* they start investigating |
| **C — Capture → KB** | Resolved incident or completed story | Prompts the engineer/developer to fill a short structured form (5–9 fields), then AI generates a full KB article from their brief answers |

The output is always a **KB draft** that goes to a Knowledge Manager for review before being published. The AI (Google Gemini) writes the article; a human approves it. Nothing gets published automatically.

---

## Part 2 — The Application Scope

### What is a ServiceNow scoped application?

ServiceNow is one big shared platform. Many teams, many vendors, many customisations all live in the same instance. If everyone shared the same namespace for their custom tables, scripts, and properties, they would constantly collide — a table called `cluster` created by one team would overwrite someone else's `cluster` table.

To prevent this, ServiceNow uses **scoped applications**. A scoped app is like a namespace container. Everything created inside it gets a prefix. Our app is called **KB Intelligence** and its scope identifier is:

```
x_1158634_kb_int_0
```

Breaking this down:
- `x_` — all customer/partner-built apps start with `x_` (ServiceNow's own apps start with `sn_` or `com_`)
- `1158634` — this is the unique company/customer ID that ServiceNow assigned to the instance
- `kb_int_0` — short for "KB Intelligence, version 0" — the app short name + a de-duplicator

This prefix is applied automatically to **everything** inside the app:
- Tables: `x_1158634_kb_int_0_cluster`, `x_1158634_kb_int_0_kb_draft`, etc.
- System properties: `x_1158634_kb_int_0.gemini_api_key`, etc.
- Script Includes are called as `x_1158634_kb_int_0.LLMConnector()`, etc.

When you see `x_1158634_kb_int_0` anywhere in the scripts, it is just "our app's namespace."

---

## Part 3 — ServiceNow Concepts Explained

Before walking through the phases and scripts, here are the core ServiceNow building blocks this project uses.

### GlideRecord

**What it is:** The fundamental way to read and write database records in ServiceNow using JavaScript.

**Simple analogy:** It is like a database cursor. You tell it which table to look in, add conditions (like SQL WHERE clauses), and then loop through the results.

**Example from our project:**
```javascript
var gr = new GlideRecord('incident');
gr.addQuery('state', '6');        // WHERE state = 'resolved'
gr.addNotNullQuery('close_notes'); // AND close_notes IS NOT NULL
gr.query();                        // execute
while (gr.next()) {
    gs.print(gr.getValue('short_description')); // read a field
}
```

Every table in ServiceNow — `incident`, `kb_knowledge`, our custom `x_1158634_kb_int_0_cluster` — is accessed this way.

### Script Include

**What it is:** A reusable JavaScript class (or library) that lives on the server and can be called from Business Rules, Scheduled Jobs, UI Actions, and other scripts.

**Simple analogy:** A JavaScript module or helper file. It's like a utility class you write once and call from everywhere.

**Example from our project:** `LLMConnector` is a Script Include. It wraps all the complexity of calling the Gemini API — auth headers, error handling, retries — in one place. When `KBDraftBuilder` needs to call the LLM, it just does `new x_1158634_kb_int_0.LLMConnector().callGemini(...)`.

**Why scope it?** If "Accessible from" is set to "This application scope only", only scripts inside `x_1158634_kb_int_0` can call it. If set to "All application scopes", scripts from the Global scope (like Business Rules on the `incident` table) can also call it.

### Business Rule

**What it is:** A script that runs automatically when a record in a table is inserted, updated, deleted, or queried.

**Simple analogy:** A database trigger, but with full JavaScript access.

**Key settings:**
- **Table** — which table triggers it (`incident`, `rm_story`, etc.)
- **When** — before (before the DB write) or after (after the DB write)
- **Async** — if ticked, it runs in a background thread so the user doesn't wait
- **Condition** — a filter; the script only runs if this is true

**Example from our project:** When an incident's `assignment_group` changes, `BR_incident_assignment_suggest` fires asynchronously and calls `ResolutionSuggester` to find similar past incidents and log them.

### UI Action

**What it is:** A button, link, or menu item on a form. When clicked, it runs a script.

**Simple analogy:** A "trigger action" button. You click it, it does something to the record.

**Example from our project:** "Capture for KB" is a UI Action on the Incident form. When you click it, it creates a `dev_capture` record pre-filled with the incident's data and opens it.

**Client vs Server:** If "Client" is ticked, the script runs in the browser (access to `g_form`, `g_list`). If unticked, it runs on the server (access to `GlideRecord`, `gs`, etc.). Our UI Actions are server-side.

### Scheduled Job (Scheduled Script Execution)

**What it is:** A script that runs automatically on a schedule (every hour, every day, every Sunday, etc.).

**Simple analogy:** A cron job.

**Example from our project:** `SJ_weekly_cluster_run` runs every Sunday at 2am. It groups similar incidents into clusters, then generates KB drafts for clusters that have no KB yet.

### Script Action

**What it is:** A script that runs in response to a named event. Events are fired by other scripts using `gs.eventQueue()`.

**Simple analogy:** An event listener. Emit an event → listener script fires.

**Example from our project:** When `KBDraftBuilder` finishes creating a draft, it fires the event `x_1158634_kb_int_0.draft.created`. The Script Action `SA_draft_created_notify` catches this event and sends an email to the Knowledge Managers group.

**Why use events instead of calling the email code directly?** Decoupling. The draft builder doesn't need to know *how* notifications work. It just says "a draft was created." Multiple listeners could react to the same event independently.

### UI Macro + Formatter

**What it is:** A UI Macro is a block of XML/Jelly (ServiceNow's templating language) that renders custom HTML on a form. A Formatter is the bridge that makes a UI Macro appear in a form's layout.

**Simple analogy:** A custom widget inserted into a record form.

**Example from our project:** `x_1158634_kb_int_0_suggestions.xml` reads the latest suggestion log for the current incident and renders a small panel with up to 3 similar past resolutions. It is added to the Incident form via the Formatter mechanism.

**Jelly** is ServiceNow's server-side templating language (XML-based). Tags like `<g:evaluate>` run server-side code; `<j:if>` and `<j:forEach>` are control structures. The output is plain HTML delivered to the browser.

### System Properties

**What they are:** Key-value configuration entries stored in the `sys_properties` table. Accessible anywhere in server-side scripts via `gs.getProperty('property.name')`.

**Why use them instead of hardcoding values?** So you can change configuration (API keys, model names, thresholds) without editing code. In our project, the Gemini API key, model name, minimum cluster size, and Knowledge Manager group sys_id are all properties. Want to switch from `gemini-2.5-flash` to `gemini-2.5-pro`? Change one property — no code edit.

**Password 2 type:** System properties of type "Password (2-way encrypted)" are stored encrypted in the database and never appear in plain text in the UI. We use this for the API key.

### Predictive Intelligence (PI)

**What it is:** ServiceNow's built-in machine learning platform. It lets you train ML models on your own instance data without writing ML code.

**What it can do:**
- **Classification** — predict a category/value for a new record (e.g., auto-classify incident category)
- **Similarity** — given a record, find the most similar records in a set
- **Clustering** — group a set of records into clusters of similar items
- **Regression** — predict a numeric value (e.g., estimated resolution time)

**What it cannot do:** Generate text. It's classical ML — no large language models.

**Example from our project:**
- **Cluster Solution** on `incident` → groups all resolved incidents with similar descriptions into clusters of recurring problems
- **Similarity Solution** on `incident` → given a new incident, finds the top-N most similar resolved incidents

**Fallback:** If PI isn't available (not trained, plugin inactive), our scripts fall back to keyword matching using `CONTAINS` queries. Less accurate, but always works.

### Gemini API (Large Language Model)

**What it is:** Google's family of large language models, accessible via a REST API. The free tier at Google AI Studio is sufficient for this project.

**What it can do that Predictive Intelligence cannot:** Generate fluent, structured text. Given a prompt describing several incident resolutions, it can write a well-formatted KB article with sections, bullet points, and code blocks.

**How we call it:** Our `LLMConnector` Script Include makes an outbound HTTPS POST to `https://generativelanguage.googleapis.com/...` with the system prompt + user prompt in the request body. The response contains the generated text.

**JSON mode:** We use Gemini's `responseMimeType: "application/json"` + `responseSchema` feature. This tells Gemini to *only* return valid JSON matching our schema `{ title, summary, body_html }`. It eliminates most parsing problems.

**Free tier limits on `gemini-2.5-flash`:** 15 requests per minute, 1,500 requests per day. Our project comfortably stays within this.

### Now Assist (ServiceNow's built-in AI platform)

**What it is:** ServiceNow's paid AI platform, built into the product. It wraps various LLMs (including a "Now LLM" fine-tuned by ServiceNow) and exposes them through a capability framework.

**Key difference from Gemini:** Data stays inside ServiceNow's trust boundary. No outbound HTTP. But requires paid licensing (`sn_now_assist_itsm` plugin).

**Why we don't use it by default:** PDI (Personal Developer Instances) almost never have Now Assist licensing active. The Gemini path works on any PDI for free.

**The swap:** `LLMConnector_NowAssist.js` is a drop-in replacement for `LLMConnector.js`. Same class name, same method signature. Flip the `llm_provider` system property from `gemini` to `now_assist` and the same KB generation pipeline routes through Now Assist instead.

---

## Part 4 — The Custom Tables Explained

Four custom tables were created inside our scoped app. Think of them as the data model of this project.

### `x_1158634_kb_int_0_cluster` — Incident Cluster

**Purpose:** Stores the output of the clustering engine. Each row represents a group of similar incidents that keep recurring.

**Key fields and why:**
- `name` — the cluster label (either a PI cluster ID or a keyword key like `software::outlook_vpn`)
- `summary` — the first 3 short descriptions joined — gives a human-readable sense of what the cluster is about
- `member_count` — how many incidents are in this cluster. Higher count = bigger pain point = higher priority for a KB
- `representative_incident` — one incident from the cluster, used as the "face" of the cluster in links
- `avg_resolution_minutes` — average time to resolve incidents in this cluster. High number = expensive recurring problem
- `linked_kb` — if a KB article already covers this cluster, link it here so the job doesn't regenerate
- `status` — `open` (needs a KB), `has_kb` (covered), `dismissed` (KM said not worth it), `draft_pending` (LLM has produced a draft, awaiting review)

### `x_1158634_kb_int_0_dev_capture` — Developer Capture

**Purpose:** The structured form an engineer/developer fills out after resolving an incident or closing a story. This is the "developer feedback" form that feeds the AI.

**Key fields and why:**
- `source_type` / `source_story` / `source_incident` — what this capture is about
- `problem_brief` — auto-filled from incident `short_description` or story description. The developer can edit it.
- `resolution_brief` — the most important field. **The developer writes, in their own words, what they actually did.** Bullet points fine. This is the primary input to the LLM.
- `root_cause` — why did this happen? Important for the "Root Cause" section of the KB.
- `workflow_changed` (toggle) + `workflow_details` — if a Flow Designer workflow or legacy workflow was modified, which one and how?
- `scripts_changed` (toggle) + `script_details` — if a Business Rule, Script Include, Client Script, etc. was changed, what was changed and why? Before/after snippets go here.
- `configs_changed` (toggle) + `config_details` — system properties, ACLs, table configs, etc.
- `validation_steps` — how the developer tested the fix
- `related_items` — links to commits, related tickets, design docs
- `state` — lifecycle: `draft` → `submitted` → `processed`
- `generated_draft` — link to the KB draft that the LLM generated from this capture

**Why toggles for workflow/scripts/configs?** Because most captures won't involve all three. The UI Policy hides the detail field if the toggle is off. This keeps the form clean and the LLM prompt focused — no empty sections.

### `x_1158634_kb_int_0_kb_draft` — KB Draft

**Purpose:** Holds every AI-generated KB article before it is published. It is the "staging area" between the LLM output and the real `kb_knowledge` table.

**Key fields and why:**
- `title` / `summary` / `body` — the actual article content, generated by the LLM
- `source_type` / `source_cluster` / `source_story` / `source_incident` / `source_dev_capture` — traceability: where did this draft come from?
- `review_state` — lifecycle: `draft` → `in_review` → `published` (or `rejected`)
- `published_kb` — once approved, points to the `kb_knowledge` record that was created
- `llm_model_used` / `llm_tokens_in` / `llm_tokens_out` — model transparency and cost tracking
- `reviewer` + `review_notes` — who approved or rejected this draft and why

**Why not publish directly?** The LLM is right ~97% of the time but wrong ~3%. On technical detail (exact script names, property names, command syntax) it can hallucinate. A Knowledge Manager review catches these before they mislead future engineers.

### `x_1158634_kb_int_0_suggestion_log` — Suggestion Log

**Purpose:** Records every time the `ResolutionSuggester` ran for an incident. Used for two things: (1) powering the suggestion panel on the incident form, and (2) measuring whether suggestions actually help.

**Key fields and why:**
- `incident` — which incident this is for
- `suggested_kbs` — JSON array of the top-N suggestions at the time of the run (incident number, short description, resolution notes, similarity score, linked KB sys_id)
- `accepted_kb` — if the resolver clicked through to a KB from the panel, this captures which one (requires a small client script on the KB link — optional enhancement)
- `resolution_minutes` — filled by `BR_suggestion_log_close` when the incident is closed; the time from open to close
- `resolver` — who closed it

**Why log every suggestion?** So you can compare: incidents where a matching suggestion was available vs. incidents where there was nothing — did MTTR differ? This is how you demonstrate project value in a PA dashboard.

---

## Part 5 — Phase-by-Phase Plain English

### Phase 0 — Mental model

Not a build phase. Just reading and understanding the three workflows (cluster → KB, resolution suggester, capture → KB) before writing any code. Skip at your peril — if you don't understand the data flow, each step feels disconnected.

### Phase 1 — Instance and user prep

Setting up the sandbox (PDI) so it has enough data and the right group memberships to actually test something. Also runs the demo-data generator script — 200 fake resolved incidents with realistic resolution notes — so that the clustering engine has something to group.

### Phase 2 — Create the scoped application

Creating the "container" (scope `x_1158634_kb_int_0`) that all our custom tables, scripts, and properties live in. Once you switch the instance's active application to "KB Intelligence", everything you create gets the `x_1158634_kb_int_0` prefix automatically.

This is the first thing you build because everything else depends on being in the right scope.

### Phase 3 — Custom tables

Creating the four data tables described in Part 4. In ServiceNow, tables are created via the UI (Studio → Create Application File → Table, or System Definition → Tables). You add columns, pick their types (string, integer, reference, true/false, HTML, choice list), and configure access controls.

**What's happening technically:** ServiceNow creates the database tables in the instance's MySQL-compatible backend. GlideRecord then lets any script read/write these tables using the same API as any other ServiceNow table.

### Phase 4 — API key and system properties

Storing the Gemini API key in a ServiceNow system property of type "Password (2-way encrypted)". Also creating all the tunable configuration values (model names, cluster size threshold, etc.) as system properties so they can be changed without editing code.

**Why password type?** Because API keys are secrets. The password type encrypts the value in the database and never displays it in plaintext in the browser. Accessing it via `gs.getProperty()` in a server-side script decrypts it at runtime. It never appears in logs or network traffic in plain text.

### Phase 5 — Script Includes

Creating the five reusable JavaScript classes. This is where the main logic lives.

- **LLMConnector** — the only code that talks to Gemini. Everything else calls through this.
- **IncidentClusterEngine** — groups closed incidents into clusters. Tries PI first, falls back to keyword matching.
- **KBDraftBuilder** — assembles the LLM prompt and creates the draft record. Two entry points: one for clusters, one for dev captures.
- **ResolutionSuggester** — finds similar past incidents for a given new incident. Tries PI Similarity first, falls back to keyword matching.
- **DevOpsContextFetcher** — pulls commit data from ServiceNow's DevOps plugin if active. Returns empty array if not.

The smoke tests at the end of this phase verify the LLM pipeline is alive before building all the UI on top.

### Phase 6 — Predictive Intelligence solutions

Training two ML models on historical incident data:

1. **Cluster Solution** — analyzes `short_description`, `description`, and `category` of all resolved incidents and groups them into clusters of similar issues. Think of it like k-means clustering on text.

2. **Similarity Solution** — given a new incident, ranks all resolved incidents by similarity score. The one that looks most like "Outlook won't connect after VPN" will score highest.

**What "training" means here:** ServiceNow's PI reads your incident data, tokenizes the text fields, builds vector representations, and stores a trained model. This takes 10 minutes to 2 hours depending on data volume. After training, you activate the model version and it can predict in real-time.

**Why this instead of just using the LLM for similarity?** Cost and speed. Calling an LLM for every incident assignment would cost money and take seconds. PI similarity runs locally in ServiceNow in milliseconds with zero cost.

### Phase 7 — Scheduled cluster job

Creating the weekly cron job that is the "engine" of Workflow A. Every Sunday at 2am it:
1. Calls `IncidentClusterEngine.runClustering()` to refresh the cluster table from the latest incident data
2. Loops over clusters with `status = open` and `member_count >= 5`
3. Skips clusters that already have a non-rejected draft
4. Calls `KBDraftBuilder.buildFromCluster()` for each gap cluster
5. Sleeps 5 seconds between LLM calls to stay within Gemini's 15-RPM free tier limit

The 5-second sleep is important — without it, generating 30 drafts in one run would exceed Gemini's rate limit and start getting 429 errors.

### Phase 8 — Verify end-to-end

A sanity check before building all the UI. Manually creates one cluster record, runs `buildFromCluster` from the Scripts Background, and inspects the resulting draft. Confirms the LLM returned structured HTML with all 7 required sections.

### Phase 9 — Review and publish workflow

Creating the UI machinery that lets a Knowledge Manager review a draft and either publish or reject it:

- **"Approve & Publish" UI Action** — server-side button on the draft form. When clicked, creates a `kb_knowledge` record from the draft's title and body, sets it to `workflow_state = published`, links the draft and cluster back to the new KB, and optionally links the source incident.

- **"Reject" UI Action** — marks the draft as rejected and the source cluster as "dismissed" so the scheduled job skips it next week.

- **Script Action on `draft.created` event** — sends email to the Knowledge Managers group whenever a new draft appears, so they know to go review it.

**Why not auto-publish?** Explained earlier — LLM hallucination rate of ~3%. For a KB targeting L2/L3 engineers, a wrong command or wrong script name is worse than no KB at all. Human gate is mandatory.

### Phase 10 — Resolution Suggester on incident form

The feature L2/L3 engineers will use every day — a panel on the incident form showing similar past resolutions.

**How the pipeline works:**
1. Engineer is assigned to the incident (or picks it up by changing `assignment_group`)
2. Business Rule fires asynchronously (doesn't block the UI)
3. `ResolutionSuggester` runs, stores top-3 results in `suggestion_log`
4. Engineer refreshes the form
5. The UI Macro reads the latest `suggestion_log` row for this incident and renders the cards

**Why async?** The suggestion query can take 1–3 seconds (especially the PI path). Making it synchronous would freeze the form while the user is trying to work. Async means the suggestion appears after a refresh, but the form is never blocked.

**Why store results in the log table instead of computing on page load?** Two reasons: (1) Computing similarity on every page load would call PI for every incident view — expensive and potentially slow. (2) Storing the log lets us measure: we know exactly what was suggested and can compare MTTR across cases where a suggestion matched vs. didn't.

### Phase 11 — "Capture for KB" on incident close

The feature that captures L2/L3 tribal knowledge when an engineer resolves a complex incident.

**The flow:**
1. Engineer resolves an incident
2. "Capture for KB" button appears on the resolved/closed incident form
3. Engineer clicks it → a `dev_capture` record opens, pre-filled with the incident's short description and close notes
4. Engineer fills in the structured fields (2–5 minutes)
5. Clicks "Submit for KB Generation"
6. A Business Rule fires the `KBDraftBuilder.buildFromDevCapture()` call
7. The LLM generates a full KB article from the structured inputs
8. Draft routes to Knowledge Manager review

**Why structured fields instead of free-form text?** The LLM produces far better output when the inputs are structured. A single paragraph of "what I did" produces a generic article. Separate fields for root cause, workflow changes, script changes with names, validation steps — these map directly to KB sections and produce technically precise articles.

### Phase 12 — Story → KB pipeline (stretch)

Extends the same capture-and-generate pattern to Agile stories. When a developer closes a story to "Complete" state:

1. Business Rule fires → creates a draft `dev_capture` with `source_type = story`
2. Developer receives an email with a link to the capture form
3. Developer fills in the same structured fields (what did you change? workflow? scripts? configs?)
4. Submits → LLM generates a story KB

**The key difference from the incident path:** The story KB uses `gemini-2.5-pro` (the higher-quality model) because story content is more technical (code changes, workflow redesigns) and the developer's brief tends to be more detailed. The quality difference justifies the lower rate limit (100/day free vs. 1500/day for Flash).

**Also:** the `DevOpsContextFetcher` is called here. If the ServiceNow DevOps plugin is active, it looks up commits linked to the story and adds their messages and changed-file lists to the LLM prompt. This means the KB article can reference exact commit hashes and changed files without the developer having to type them.

### Phase 13 — DevOps commit context (stretch)

No new ServiceNow records are created in this phase — just activating the `DevOpsContextFetcher` Script Include that was already installed in Phase 5. The fetcher looks in ServiceNow DevOps tables (`sn_devops_commit` or `sn_devops_change_artifact`) for commits linked to a story. If the plugin isn't active, the table doesn't exist and the fetcher silently returns an empty array.

### Phase 14 — Dashboards

Building the measurement layer. Three key metrics:

1. **KB drafts published per week** — is the engine actually producing knowledge?
2. **MTTR with vs without suggestion accepted** — does seeing a similar resolution actually speed up engineers?
3. **Token cost per week** — cost accountability (even though it's free on Gemini's free tier)

### Phase 15 — Testing

A checklist of manual tests covering happy paths and failure modes. Specifically tests that the LLM returns null gracefully when the API key is wrong, that rejecting a draft dismisses the cluster, and that submitting an incomplete capture gets a validation error.

### Phase 16 — Demo script

A 5-minute walk-through for presenting the project to a manager or in an interview. Shows each workflow in order, uses real data, ends with the cost/scale story.

### Phase 17 — Now Assist swap (optional)

Replaces `LLMConnector.js` with `LLMConnector_NowAssist.js` — a version that routes LLM calls through ServiceNow's own AI platform instead of Gemini. Only relevant if `sn_one_extend` and `sn_now_assist_skillkit` plugins are active (paid licensing).

The swap is one file paste + two system property changes. Nothing else in the project changes.

---

## Part 6 — Script-by-Script Reference

### `LLMConnector.js` — Gemini API wrapper

**What it is:** A Script Include (server-side utility class) that wraps the Google Gemini REST API.

**What triggers it:** Called by `KBDraftBuilder` every time a KB draft needs to be generated. Never called directly from the UI or Business Rules.

**What it does, step by step:**
1. Reads the Gemini API key from the encrypted system property `x_1158634_kb_int_0.gemini_api_key`
2. Reads the model name from `x_1158634_kb_int_0.default_model` (default: `gemini-2.5-flash`)
3. Builds a JSON request body with the system prompt, user prompt, and a `responseSchema` that tells Gemini to return exactly `{ title, summary, body_html }`
4. Makes an outbound HTTPS POST to `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent`
5. If Gemini returns HTTP 429 (rate limited), waits 4 seconds and retries. Then 8 seconds, then 16. After 3 retries, fires an alert event and gives up.
6. Parses the JSON response, extracts the text, and returns `{ text, model, tokensIn, tokensOut }`

**Output:** An object with the generated article text plus metadata, or `null` if anything failed.

**Why a separate class?** Isolation. If Gemini's API changes (different endpoint, different auth header), you fix it in one 100-line file without touching anything else.

---

### `LLMConnector_NowAssist.js` — Now Assist swap

**What it is:** A drop-in replacement for `LLMConnector.js` that routes calls through ServiceNow's Now Assist (`sn_one_extend_util.OneExtendUtil`) instead of Gemini.

**Same class name, same method name** — `KBDraftBuilder` calls `connector.callGemini(...)` and has no idea which implementation is underneath.

**What's different internally:** Uses `sn_one_extend_util.OneExtendUtil.execute()` with a capability ID. The response shape from OneExtend varies by ServiceNow release, so the script tries three known response shapes in order and logs the raw response when none match, making it easy to adapt.

**Contains the Gemini path too** — so flipping the `llm_provider` property back to `gemini` immediately restores the old behavior without repasting the original file.

---

### `IncidentClusterEngine.js` — Groups similar incidents

**What it is:** A Script Include that reads closed incidents and groups them into clusters by similarity.

**What triggers it:** Called by the weekly Scheduled Job (`SJ_weekly_cluster_run.js`).

**What it does, step by step:**
1. Tries the Predictive Intelligence Cluster Solution (named in the system property). If not available, falls back.
2. **PI path:** Loops through resolved incidents from the last `lookback_days` days, calls `version.predict()` on each, and groups them by their predicted cluster label into a map `{ label: { ids: [...], shortDescs: [...] } }`
3. **Keyword fallback path:** Tokenizes each incident's short description (removes stop words like "the", "and", "is"), takes the first 2 significant words, and groups by `category::word1_word2`
4. For each group with ≥ `min_cluster_size` members, calls `_upsertCluster()` to insert or update a row in `x_1158634_kb_int_0_cluster`
5. `_upsertCluster()` also computes: average resolution time (for priority scoring), the most common assignment group (routing hint), and checks if any member incident is already linked to a KB (if so, marks cluster as `has_kb`)

**Output:** Updated rows in the cluster table.

---

### `KBDraftBuilder.js` — Assembles prompt → calls LLM → saves draft

**What it is:** The central script of the project. It knows how to build a prompt from either a cluster or a dev capture, call the LLM, and save the result as a draft.

**Two public methods:**

**`buildFromCluster(clusterSysId)`:**
1. Loads the cluster record
2. Fetches the top 5 most representative incidents from that cluster (using the cluster's summary keyword + the representative incident)
3. Builds the system prompt (P1 from `prompts.md`) — tells Gemini it is writing for L2/L3 engineers
4. Builds the user prompt (P2) — fills in the cluster metadata and the 5 incident summaries with their resolution notes
5. Calls `LLMConnector.callGemini()` with `enforceJson: true`
6. Parses the returned JSON — pulls out `title`, `summary`, `body_html`
7. Creates a `x_1158634_kb_int_0_kb_draft` record
8. Updates the cluster's status to `draft_pending`
9. Fires the `draft.created` event (which triggers the KM notification)

**`buildFromDevCapture(captureSysId)`:**
1. Loads the dev capture record
2. If the capture is from a story, calls `DevOpsContextFetcher.fetchForStory()` to get commit context
3. Builds the developer-capture system prompt (P3) — tells Gemini to produce a structured technical KB with all the change-detail sections
4. Builds the user prompt (P4) — fills in everything from the capture: problem brief, what they did, root cause, workflow changes (if toggled), script changes (if toggled), config changes (if toggled), validation steps, related items, and commit context
5. Uses `gemini-2.5-pro` for story captures (better quality for code/workflow content)
6. Same LLM call → parse → save draft → update capture state → fire event

**Why the prompts live in `prompts.md` and not hardcoded:** Tuning. The system prompts control the entire output structure. When you need to change the section order or add a new section, you edit `prompts.md` for reference and then update the corresponding `_systemPrompt*()` method. Keeping `prompts.md` as a human-readable reference means you can reason about prompt changes without reading JavaScript.

---

### `ResolutionSuggester.js` — Finds similar past incidents

**What it is:** A Script Include called by the Business Rule when an incident is assigned to an L2/L3 group. Finds the top-3 most similar resolved incidents.

**Two paths (PI and keyword):**

**PI Similarity path:**
- Calls `version.predict([incGr])` on the trained Similarity Solution
- Gets back a list of `(sys_id, similarity_score)` pairs
- Filters for only resolved/closed incidents with non-empty close_notes
- Formats the top-N results

**Keyword fallback path:**
- Tokenizes the new incident's short description (same stop-word removal as the cluster engine)
- Tries three progressively broader GlideRecord queries:
  - First: same category + all 3 keywords present (strict)
  - Then: same category + 2 keywords (medium)
  - Then: same category + 1 keyword (broad)
- Takes the first N distinct results

**Output:** Always logs to `x_1158634_kb_int_0_suggestion_log`, even if results are empty (zero-result rows are also useful for measurement). Returns the suggestion array.

---

### `DevOpsContextFetcher.js` — Pulls commit data for stories

**What it is:** A defensive Script Include that tries to read DevOps commit records linked to a story. Returns an empty array if anything is missing (plugin inactive, table doesn't exist, story has no commits).

**Why defensive?** The DevOps plugin adds tables that only exist if it's installed. Calling `new GlideRecord('sn_devops_commit')` on an instance without the plugin doesn't throw an exception — it just gives an invalid GlideRecord. The `.isValid()` check returns `false`, and the script returns early. This means the script works correctly on instances both with and without DevOps, without any `try/catch` at the call site.

**Output:** An array of `{ hash, message, author, files }` objects, or `[]`.

---

### `BR_incident_assignment_suggest.js` — Business Rule on incident

**What triggers it:** Any incident update where `assignment_group` changes and is not empty. Async.

**What it does:** Calls `ResolutionSuggester.suggestForIncident()`. That's it. The BR itself is 5 lines; all the real logic is in the Script Include.

**Why async?** If this were synchronous, every time an incident was assigned, the entire form save would wait for the PI/keyword query to complete. Async means the suggestion is written to the log in the background; the form responds immediately.

---

### `BR_story_closure_capture.js` — Business Rule on rm_story

**What triggers it:** Any story update where state changes to a "complete" state (value `'4'`, `'3'`, `'closed_complete'`, or `'complete'` — exact values vary by ServiceNow release). Async.

**What it does:**
1. Checks that no dev capture already exists for this story (prevents duplicates)
2. Creates a new `dev_capture` record with `source_type = story`, pre-filled from the story
3. Fires the `story.capture_request` event with the capture sys_id and developer sys_id as parameters

**Important note:** The story state values vary by ServiceNow release and Agile module version. The script includes a diagnostic snippet (in Phase 12.2 of `implementation.md`) to find the correct values for your instance.

---

### `BR_devcapture_submitted.js` — Business Rule on dev_capture

**What triggers it:** A dev capture record is updated and state changes to `submitted`. Async.

**What it does:** Calls `KBDraftBuilder.buildFromDevCapture()`. If the build returns null (LLM failure), bounces the state back to `draft` so the user can retry.

**Why bounce back on failure?** If the LLM call fails silently and the state stays `submitted`, the user thinks the KB is being generated when nothing is happening. Bouncing to `draft` makes the failure visible so the user knows to click Submit again.

---

### `BR_suggestion_log_close.js` — Business Rule on incident close

**What triggers it:** Incident state changes to Resolved (6) or Closed (7). Async.

**What it does:** Finds the most recent `suggestion_log` row for this incident and writes in the actual resolution time (minutes from opened_at to resolved_at) and who resolved it.

**Why:** This is the measurement closing the loop. Combined with `accepted_kb` (which KB the resolver clicked, if any), you can build a table showing: "Incidents where a suggestion was available and clicked → avg MTTR = X minutes. Incidents where no suggestion → avg MTTR = Y minutes." That's the proof of value.

---

### `UA_incident_capture_for_kb.js` — "Capture for KB" button

**Visible when:** Incident state is Resolved (6) or Closed (7). Server-side.

**What it does:**
1. Checks if a capture already exists for this incident (avoids duplicates, redirects to the existing one)
2. Creates a new `dev_capture` record, pre-fills `problem_brief` from `short_description`, `resolution_brief` from `close_notes`
3. Redirects the user to the capture form

**Why pre-fill close_notes into resolution_brief?** The engineer already wrote their resolution in close_notes. Pre-populating gives them a starting point — they just need to expand on it and add the structured detail. Reduces friction significantly.

---

### `UA_devcapture_submit.js` — "Submit for KB Generation" button

**Visible when:** Dev capture state is `draft`. Server-side.

**What it does:** Validates that `problem_brief` and `resolution_brief` are at least 10 characters (the two most important fields). Then sets `state = submitted` and saves. The Business Rule picks it up from there.

**Why validate?** A 5-character resolution brief produces a useless KB. The 10-character minimum forces at least a phrase. The user prompt templates have been designed around developer brevity — the LLM can expand a bullet point. But it can't expand nothing.

---

### `UA_kbdraft_approve.js` — "Approve & Publish" button

**Visible when:** Draft `review_state` is `draft` or `in_review`. Roles: `knowledge_manager` or `admin`. Server-side.

**What it does:**
1. Reads `x_1158634_kb_int_0.target_kb_base` system property (the KB base to publish into)
2. Creates a new `kb_knowledge` record with the draft's title and body
3. Sets `workflow_state = published` and `valid_to = 2099-12-31`
4. Links the draft back to the new KB record (`published_kb` field)
5. If the draft came from a cluster, updates the cluster's `linked_kb` and sets `status = has_kb` (so the scheduled job skips it next week)
6. If the draft came from an incident, creates an `m2m_kb_task` link (the standard ServiceNow many-to-many table that links KB articles to incidents)
7. Redirects to the new KB article

---

### `UA_kbdraft_reject.js` — "Reject Draft" button

**Visible when:** Same as Approve. Roles: same.

**What it does:** Sets draft to `rejected`. If there is a source cluster, sets the cluster's `status = dismissed` so the scheduled job won't regenerate the same draft.

**Important nuance:** Dismissed clusters can be undone manually (change status back to `open` on the cluster record). The KM might dismiss a cluster because "this is not a real recurring issue" (the PI grouped unrelated tickets together). Dismissal is not permanent.

---

### `SJ_weekly_cluster_run.js` — Weekly cron job

**What triggers it:** ServiceNow scheduler, every Sunday at 02:00.

**What it does:**
1. Calls `IncidentClusterEngine.runClustering()` to refresh all clusters
2. Queries for clusters with `status = open` and `member_count >= min_cluster_size`
3. Orders by `member_count DESC` — biggest gaps first (if the daily LLM cap is hit mid-run, at least the most impactful KBs were generated)
4. Caps at 50 clusters per run (safety limit — avoids runaway API usage)
5. For each gap cluster, checks that no non-rejected draft exists yet
6. Calls `KBDraftBuilder.buildFromCluster()`
7. **Sleeps 5 seconds** between each LLM call (free tier rate limit protection)

---

### `SA_draft_created_notify.js` — Email notification on draft creation

**What triggers it:** The `x_1158634_kb_int_0.draft.created` event (fired by `KBDraftBuilder` after insert).

**What it does:** Looks up all members of the "Knowledge Managers" group (sys_id stored in `x_1158634_kb_int_0.knowledge_manager_group`), collects their email addresses, and sends one email per member with a link to the draft.

**Why loop members instead of using a notification rule?** Flexibility — the notification goes to everyone in the group regardless of how they are subscribed. Could be replaced with a proper ServiceNow Notification record later.

---

### `SA_story_capture_request.js` — Email to developer after story close

**What triggers it:** The `x_1158634_kb_int_0.story.capture_request` event (fired by `BR_story_closure_capture`).

**What it does:** Emails the developer (`assigned_to` on the story) with a link to the pre-created capture form and a brief explanation of what they need to do (fill 5 fields, takes 2 minutes).

**Why an email and not an in-app notification?** Developers often don't have ServiceNow open. An email survives until they get to it. The link in the email goes directly to the `dev_capture` form.

---

### `x_1158634_kb_int_0_suggestions.xml` — Incident form side panel

**What it is:** A UI Macro — server-rendered HTML that appears as a custom section on the incident form.

**What it renders:** A panel titled "Similar Past Resolutions (L2/L3 Hint)". Reads the most recent `suggestion_log` row for the current incident. For each suggestion (up to 3), renders a card with: incident number (linked), similarity score, short description, expandable resolution notes, and a link to the related KB if one exists.

**Technology used:** Jelly (ServiceNow's XML templating language). `<g:evaluate>` runs server-side GlideRecord code. `<j:forEach>` loops over the results. The output is a `<div>` with inline styles — not pretty but it works everywhere without additional CSS files.

**When it shows data vs when it shows "No suggestions yet":** If the async Business Rule hasn't run yet (just assigned the incident a few seconds ago), the suggestion_log row may not exist yet. The macro shows "No suggestions yet — assign to a group, save, then refresh." On the next form load after the async BR has completed, the panel will show results.

---

## Part 7 — How the Three Workflows Connect

```
EXISTING DATA (closed incidents, stories)
     │
     ▼
IncidentClusterEngine ──────────────────────────────────────────────
     │                                                              │
     │ clusters                                                     │
     ▼                                                              │
x_1158634_kb_int_0_cluster                                         │
     │                                                              │
     │ scheduled job                                                │
     ▼                                                              │
KBDraftBuilder.buildFromCluster()                                  │
     │                                                              │
     │ user action                                                  │
     │ ─────────────────────────────────────────────────────────── │
     │  engineer closes incident    story is completed             │
     │       │                          │                          │
     │       ▼                          ▼                          │
     │  "Capture for KB"    BR_story_closure_capture               │
     │       │                          │                          │
     │       └──────────────┬───────────┘                          │
     │                      ▼                                       │
     │            x_1158634_kb_int_0_dev_capture                    │
     │                      │                                       │
     │                      │ "Submit for KB Generation"            │
     │                      ▼                                       │
     │            KBDraftBuilder.buildFromDevCapture() ─────────────┤
     │                                                              │
     ▼                                                              ▼
All paths → LLMConnector.callGemini() ────→ x_1158634_kb_int_0_kb_draft
                                                       │
                                         SA_draft_created_notify (email)
                                                       │
                                            Knowledge Manager reviews
                                                       │
                                         "Approve & Publish" UI Action
                                                       │
                                                 kb_knowledge
                                           (published, searchable)

SEPARATE WORKFLOW:
New incident assigned to group
     │
     ▼
BR_incident_assignment_suggest (async)
     │
     ▼
ResolutionSuggester
     │
     ▼
x_1158634_kb_int_0_suggestion_log
     │
     ▼
x_1158634_kb_int_0_suggestions UI Macro
     │
     ▼
"Similar Past Resolutions" panel on incident form
```

---

## Part 8 — Related Knowledge (Things Worth Understanding Deeply)

### Why ServiceNow is JavaScript on the server, not Java

Despite running on a Java VM, all custom ServiceNow scripting is done in server-side JavaScript (via Mozilla Rhino, an embedded JS engine). GlideRecord, gs (the global ServiceNow object), and all the script include utilities are all JS. Modern ServiceNow releases also support ES2019+ features in some contexts.

### What a GlideDateTime is

`new GlideDateTime()` — ServiceNow's datetime wrapper. Not a JS Date object. Supports `getNumericValue()` (returns Unix timestamp in milliseconds), `addDaysLocalTime(n)`, `getValue()` (ISO string). The scripts use it for calculating resolution time in minutes: `(resolvedGDT.getNumericValue() - openedGDT.getNumericValue()) / 60000`.

### The m2m_kb_task table

A many-to-many join table that links `incident` (and other tasks) to `kb_knowledge` articles. When an L1 engineer resolves a ticket by using a KB article, this link is created. We query it in `ResolutionSuggester` to find "has a KB article been linked to any of these similar past incidents?" If yes, that KB is the most relevant suggestion.

### Why async Business Rules matter

When a Business Rule is marked "Async", ServiceNow puts it in a background queue and the current transaction completes immediately. The async BR runs in a separate transaction a few seconds later. This means:
- The user's form save is not blocked
- The async BR cannot modify `current` (it runs after the transaction committed) — it needs its own GlideRecord to update the record
- If the async BR fails, it fails silently (visible in logs) without rolling back the original transaction

### Jelly vs modern JavaScript in ServiceNow

Jelly (`<j:jelly>`) is a legacy templating language. Modern ServiceNow widgets use Angular/Now Components. For this project we use Jelly for the UI Macro because Formatters (the mechanism for injecting custom panels into core forms like `incident`) only support Jelly — not Service Portal widgets or Next Experience components. It's old but it's the only option for this placement.

### ServiceNow's Event system vs traditional event emitters

`gs.eventQueue('event.name', gr, parm1, parm2)` puts an event into an asynchronous queue. The event processor picks it up (usually within seconds on a PDI). Script Actions are registered listeners for specific event names. This is not synchronous. If you fire `draft.created` and immediately check whether the notification email was sent, it may not have been sent yet.

### Token pricing for Gemini

A "token" is roughly 0.75 words, or about 4 characters. A typical KB generation call:
- Input: ~2,500 tokens (system prompt + 5 incidents)
- Output: ~1,500 tokens (the KB article)

At `gemini-2.5-flash` free tier pricing (which is free), cost is $0. On the paid tier as of early 2026, Flash costs ~$0.30/million input + $2.50/million output tokens — so one KB generation = ~$0.0005. About 2,000 KB generations per dollar.

### Why "Accessible from: All application scopes" matters

When you write a Business Rule on the `incident` table, that BR lives in the **Global** scope — even if you created it while in the KB Intelligence scope context. Global-scope code cannot call script includes in other scopes *unless* those script includes explicitly allow it via "Accessible from: All application scopes." That's why `LLMConnector` and `ResolutionSuggester` are set to "All application scopes" — the Business Rules that call them are Global-scope code.

### The difference between a Scoped App and an Update Set

An **Update Set** is a container for configuration changes that you want to move between instances (dev → test → prod). It records every config change you make while "capturing" to it.

A **Scoped Application** is a logical namespace and packaging unit. You can export a scoped app as an update set or a versioned app via the ServiceNow App Repository.

For this project: when you finish building on your PDI and want to move it to a "test" or "production" ServiceNow instance, you create an update set in the KB Intelligence scope, it captures all the custom tables, script includes, business rules, etc., and you can apply it to the target instance.

### How the LLM prompt engineering works

The system prompt (P1 or P3 in `prompts.md`) defines the model's "persona" and enforces the output rules. It tells Gemini: who you are (ITSM KB author), who your audience is (L2/L3 engineers), what structure to follow (the 7 or 9 sections), and what not to do (invent facts, use unsupported HTML tags).

The user prompt provides the data — the actual incidents, the developer's brief, the commit context.

**Why separate system and user prompts?** This is standard practice in LLM prompt engineering. The system prompt is like a persistent instruction sheet; the user prompt is the variable input. Gemini's `system_instruction` field is structurally separate from `contents` for this reason. Mixing instructions and data in the same message tends to produce less consistent outputs.

**Temperature = 0.3:** Temperature controls randomness. 0 = completely deterministic (same input always gives same output). 1 = creative/random. 0.3 is low enough for technical writing to be consistent and precise, high enough to avoid robotic repetition across similar articles.
