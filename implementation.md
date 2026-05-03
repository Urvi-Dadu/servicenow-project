# Implementation Guide — Predictive Resolution Assistant & Auto-KB Generator (L2 / L3)

> **Audience:** L2 / L3 ServiceNow engineer who wants to build this end-to-end on a Personal Developer Instance.
> **Time to working demo:** ~6 hours of focused work (excluding PI training time, which can run overnight).
> **LLM:** Google Gemini API, free tier — no credit card needed.
> **Before you start:** Tick everything in [setup-checklist.md](setup-checklist.md). The build will stall if you skip it.

---

## Table of contents

1. [Phase 0 — What you're building (mental model)](#phase-0--what-youre-building-mental-model)
2. [Phase 1 — Instance & user prep](#phase-1--instance--user-prep)
3. [Phase 2 — Create the scoped application](#phase-2--create-the-scoped-application)
4. [Phase 3 — Custom tables](#phase-3--custom-tables)
5. [Phase 4 — Gemini API key + system properties](#phase-4--gemini-api-key--system-properties)
6. [Phase 5 — Script Includes](#phase-5--script-includes)
7. [Phase 6 — Predictive Intelligence solutions](#phase-6--predictive-intelligence-solutions)
8. [Phase 7 — Scheduled cluster job](#phase-7--scheduled-cluster-job)
9. [Phase 8 — Verify cluster KB drafting end-to-end](#phase-8--verify-cluster-kb-drafting-end-to-end)
10. [Phase 9 — KB review & publish workflow](#phase-9--kb-review--publish-workflow)
11. [Phase 10 — Resolution Suggester on incident form (L2/L3 core value)](#phase-10--resolution-suggester-on-incident-form-l2l3-core-value)
12. [Phase 11 — "Capture for KB" on incident close](#phase-11--capture-for-kb-on-incident-close)
13. [Phase 12 — Stretch: Story → KB pipeline](#phase-12--stretch-story--kb-pipeline)
14. [Phase 13 — Stretch: DevOps commit context](#phase-13--stretch-devops-commit-context)
15. [Phase 14 — Performance Analytics / dashboards](#phase-14--performance-analytics--dashboards)
16. [Phase 15 — Testing](#phase-15--testing)
17. [Phase 16 — Demo script (for your manager / interview)](#phase-16--demo-script-for-your-manager--interview)
18. [Phase 17 — Optional: swap Gemini → ServiceNow Now Assist](#phase-17--optional-swap-gemini--servicenow-now-assist)
19. [Appendix A — Troubleshooting](#appendix-a--troubleshooting)
20. [Appendix B — Cost & rate-limit reference](#appendix-b--cost--rate-limit-reference)

---

## Phase 0 — What you're building (mental model)

There are **three workflows** in this app. Read this section before you build anything — if you understand these flows, the rest is plumbing.

### Workflow A — Cluster → KB (proactive)

```
Resolved incidents (last 12 months)
        │
        ▼
[Weekly scheduled job]
        │
        ▼
IncidentClusterEngine ─→ groups similar incidents into x_1158634_kb_int_0_cluster
        │
        ▼
For each cluster with no KB and ≥ 5 members:
        │
        ▼
KBDraftBuilder.buildFromCluster()
        │
        ▼
Gemini API call (gemini-2.5-flash, JSON mode)
        │
        ▼
x_1158634_kb_int_0_kb_draft (review_state = draft)
        │
        ▼
[Email Knowledge Manager group]
        │
        ▼
KM clicks "Approve & Publish" → kb_knowledge published
```

### Workflow B — Resolution Suggester (reactive, the L2/L3 daily value)

```
Incident assigned to L2/L3 group
        │
        ▼
[BR_incident_assignment_suggest async]
        │
        ▼
ResolutionSuggester.suggestForIncident()
        │   tries PI Similarity Solution; falls back to keyword match
        ▼
Top 3 similar resolved incidents + linked KBs
        │
        ▼
x_1158634_kb_int_0_suggestion_log (audit row)
        │
        ▼
[UI Macro on incident form reads from log]
        │
        ▼
L2/L3 engineer sees side panel: "Similar Past Resolutions"
```

### Workflow C — Capture / Story → KB (the developer-feedback stretch)

```
   Resolved incident                      Story closed (rm_story state=Complete)
          │                                          │
          ▼                                          ▼
   "Capture for KB"                       [BR_story_closure_capture async]
   UI Action click                                   │
          │                                          ▼
          └────────→ x_1158634_kb_int_0_developer_capture ◀─── pre-fills problem_brief
                            │
                            ▼
                Developer fills 5–9 fields
                (problem brief, what they did, root cause,
                 workflow changed?, scripts changed?, configs changed?,
                 validation steps, related items)
                            │
                            ▼
                  Click "Submit for KB Generation"
                            │
                            ▼
                  [BR_devcapture_submitted async]
                            │
                            ▼
       KBDraftBuilder.buildFromDevCapture()
                            │
                  ┌─────────┴──────────┐
                  ▼                    ▼
    DevOpsContextFetcher       Gemini API call
    (pulls commits if          (gemini-2.5-pro for stories,
    DevOps plugin active)       JSON mode)
                  │                    │
                  └─────────┬──────────┘
                            ▼
                 x_1158634_kb_int_0_kb_draft
                            │
                            ▼
                Same review/publish path as Workflow A
```

The output is a structured KB with sections for **Workflow Changes**, **Script/Code Changes** (with before/after snippets), **Configuration Changes**, **Validation Steps**, and **Rollback / Watch-outs** — exactly what the user asked for.

---

## Phase 1 — Instance & user prep

### 1.1 Confirm pre-flight

Open [setup-checklist.md](setup-checklist.md). Every box must be ticked.

### 1.2 Generate demo data (if you don't already have it)

If your PDI doesn't have ~50+ closed incidents with non-empty `close_notes`, run the demo data generator. Open **System Definition → Scripts - Background**, paste the script from `setup-checklist.md` § 4, and click *Run script*. You should see "Done — 200 demo incidents created".

### 1.3 Create / pick the Knowledge Managers group

If you don't already have one:

1. Navigate to **User Administration → Groups → New**
2. Name: `Knowledge Managers`
3. Save, then add yourself via the **Group Members** related list
4. Open the group record and copy its **Sys ID** (right-click header → Copy sys_id) — you'll paste it into a system property in Phase 4.

---

## Phase 2 — Create the scoped application

### 2.1 New scoped app

1. Switch to the **Studio** (in the sidebar: *All → Studio*) or use the legacy form: **System Applications → Studio**.
2. Click **Create Application**.
3. Choose **Start from scratch**.
4. Fill in:
   - **Name:** `KB Intelligence`
   - **Scope:** `x_1158634_kb_int_0` *(if your namespace is non-default ServiceNow may prefix with your company-id; that's fine — the rest of this guide assumes `x_1158634_kb_int_0`. If yours differs, replace `x_1158634_kb_int_0` everywhere with your scope.)*
   - **Version:** `1.0.0`
   - **Description:** `Predictive resolution assistant + auto-KB generator for L2/L3`
5. Click **Create**.

### 2.2 Confirm the app is the active scope

Top-right corner of ServiceNow → "Application Picker". Make sure it says **KB Intelligence**. If it's still "Global", click and switch.

> Every Script Include / Business Rule / UI Action you create from now on must be in this application scope.

---

## Phase 3 — Custom tables

Create four tables. For each: **Studio → Create Application File → Table**, or via list view **System Definition → Tables → New**.

> While in scope `x_1158634_kb_int_0`, ServiceNow auto-prefixes table names. So when the form asks for "Name", enter just `cluster` (not `x_1158634_kb_int_0_cluster`).

Detailed field-by-field reference is in [data-model.md](data-model.md). Below is the minimum step set.

### 3.1 Table: `cluster` → becomes `x_1158634_kb_int_0_cluster`

- Label: **Incident Cluster**
- Extends: *(none)*
- Add columns per [data-model.md § Table 1](data-model.md#table-1-x_1158634_kb_int_0_cluster).
- For the `status` choice column, add the choice list: `open`, `has_kb`, `dismissed`, `draft_pending`.

### 3.2 Table: `dev_capture` → becomes `x_1158634_kb_int_0_developer_capture`

- Label: **Developer Capture**
- Add columns per [data-model.md § Table 2](data-model.md#table-2-x_1158634_kb_int_0_developer_capture).
- For `state` choice column: `draft`, `submitted`, `processed`, `cancelled`.
- For `source_type` choice column: `story`, `incident`, `problem`.
- After saving, open the table form layout and arrange the fields into sections: **Source**, **Problem & Resolution**, **Changes** (workflow / scripts / configs toggles + their detail strings), **Validation**, **Related & State**.

### 3.3 Table: `kb_draft` → becomes `x_1158634_kb_int_0_kb_draft`

- Label: **KB Draft**
- Add columns per [data-model.md § Table 3](data-model.md#table-3-x_1158634_kb_int_0_kb_draft).
- For `body`, change the field type to **HTML** (Editor type). This gives the KM a WYSIWYG editor for review/edit before publishing.
- For `review_state` choice list: `draft`, `in_review`, `approved`, `rejected`, `published`.

### 3.4 Table: `suggestion_log` → becomes `x_1158634_kb_int_0_suggestion_log`

- Label: **Suggestion Log**
- Add columns per [data-model.md § Table 4](data-model.md#table-4-x_1158634_kb_int_0_suggestion_log).
- The `suggested_kbs` field stores JSON — type **String**, max length **8000**.

### 3.5 ACLs (recommended baseline)

Open each new table → **Access Controls** related list and create:

| Table                       | Operation | Role required          |
| --------------------------- | --------- | ---------------------- |
| `x_1158634_kb_int_0_cluster`        | read      | itil OR knowledge_manager |
| `x_1158634_kb_int_0_cluster`        | write     | knowledge_manager OR admin |
| `x_1158634_kb_int_0_developer_capture`    | read      | itil                   |
| `x_1158634_kb_int_0_developer_capture`    | write     | itil                   |
| `x_1158634_kb_int_0_kb_draft`       | read      | knowledge_manager OR admin |
| `x_1158634_kb_int_0_kb_draft`       | write     | knowledge_manager OR admin |
| `x_1158634_kb_int_0_suggestion_log` | read      | itil                   |
| `x_1158634_kb_int_0_suggestion_log` | write     | admin (auto-written by Script Include) |

---

## Phase 4 — Gemini API key + system properties

### 4.1 Create system properties

Navigate to **System Properties → New** (must be in scope `KB Intelligence`). Create each row below. The first one is critical — it stores your API key encrypted.

| Name (suffix)             | Type                  | Value                                              |
| ------------------------- | --------------------- | -------------------------------------------------- |
| `gemini_api_key`          | **Password (2-way)**  | *paste the AIza... key from Google AI Studio*      |
| `default_model`           | string                | `gemini-2.5-flash`                                 |
| `story_model`             | string                | `gemini-2.5-pro`                                   |
| `cluster_solution_name`   | string                | `incident_cluster_l2l3`                            |
| `similarity_solution_name`| string                | `incident_similarity_l2l3`                         |
| `min_cluster_size`        | integer               | `5`                                                |
| `lookback_days`           | integer               | `365`                                              |
| `suggestion_top_n`        | integer               | `3`                                                |
| `target_kb_base`          | string                | *sys_id of a `kb_knowledge_base` record* (see 4.2) |
| `knowledge_manager_group` | string                | *sys_id of the Knowledge Managers group*           |

> The full property name will appear as `x_1158634_kb_int_0.<suffix>` because ServiceNow prepends the scope name automatically when you create the property in scope.

### 4.2 Find the target KB base sys_id

1. Navigate to **Knowledge → Administration → Knowledge Bases**.
2. Pick (or create) the KB you want published articles to land in. **IT** is the default and works fine.
3. Right-click the form header → **Copy sys_id**.
4. Paste into `x_1158634_kb_int_0.target_kb_base`.

### 4.3 Add the Gemini endpoint to outbound HTTP allow-list

ServiceNow allows outbound REST by default, but some hardened instances block it. Verify by:

1. **System Web Services → Outbound → REST Message → New**
   - Name: `Gemini test`
   - Endpoint: `https://generativelanguage.googleapis.com/v1beta/models`
2. Save → click the **Test** related link in the default GET method. You should see HTTP 200 / 401 (401 is fine — it just means the key is missing). HTTP 0 or `connection refused` means the instance can't reach the internet — open a HI ticket or check `glide.outbound.rest.allow_*` properties.

You can delete this test REST Message afterwards — the LLMConnector script doesn't use it.

---

## Phase 5 — Script Includes

For each file under [scripts/](scripts/) below: **System Definition → Script Includes → New**. Copy-paste the entire contents of the file into the Script field. Save with these settings:

| Script Include              | Source file                                                | Accessible from                  | Active |
| --------------------------- | ---------------------------------------------------------- | -------------------------------- | ------ |
| `LLMConnector`              | [scripts/LLMConnector.js](scripts/LLMConnector.js)         | **All application scopes**       | yes    |
| `IncidentClusterEngine`     | [scripts/IncidentClusterEngine.js](scripts/IncidentClusterEngine.js) | This application scope only | yes    |
| `KBDraftBuilder`            | [scripts/KBDraftBuilder.js](scripts/KBDraftBuilder.js)     | This application scope only      | yes    |
| `ResolutionSuggester`       | [scripts/ResolutionSuggester.js](scripts/ResolutionSuggester.js) | **All application scopes**  | yes    |
| `DevOpsContextFetcher`      | [scripts/DevOpsContextFetcher.js](scripts/DevOpsContextFetcher.js) | This application scope only | yes    |

> "All application scopes" matters for `LLMConnector` and `ResolutionSuggester` because they're called from Business Rules on `incident` (a Global-scope table).

### 5.1 Smoke-test LLMConnector

Open **System Definition → Scripts - Background**. Paste:

```javascript
var llm = new x_1158634_kb_int_0.LLMConnector();
var r = llm.callGemini(
    'You are a helpful assistant. Output JSON only.',
    'Reply with a JSON object containing a "title" (string) and "body_html" (string with one <p> tag) describing the color blue.',
    { maxTokens: 300, enforceJson: true }
);
gs.print('--- response ---');
gs.print(r ? r.text : 'NULL — see logs');
gs.print('tokens in: ' + (r && r.tokensIn));
gs.print('tokens out: ' + (r && r.tokensOut));
```

Run. You should see structured JSON output. If you see `NULL`, check **System Logs → Errors** for `LLMConnector:` lines. Common causes:
- Wrong API key (or not saved as a password property)
- Outbound HTTPS blocked (see 4.3)
- Wrong model name (Gemini model names change — check [ai.google.dev/models](https://ai.google.dev/models))

### 5.2 Smoke-test KBDraftBuilder (without a real cluster yet)

```javascript
// Manually create one cluster from your demo data, then build a draft from it.
var cg = new GlideRecord('x_1158634_kb_int_0_cluster');
cg.initialize();
cg.setValue('name', 'manual_test_cluster');
cg.setValue('summary', 'Outlook will not connect to Exchange after VPN');
cg.setValue('member_count', 5);
cg.setValue('status', 'open');
// Pick any closed incident as representative
var rep = new GlideRecord('incident');
rep.addQuery('state', 'IN', '6,7');
rep.addNotNullQuery('close_notes');
rep.setLimit(1); rep.query();
if (rep.next()) cg.setValue('representative_incident', rep.getUniqueValue());
var clusterId = cg.insert();
gs.print('Cluster: ' + clusterId);

var draftId = new x_1158634_kb_int_0.KBDraftBuilder().buildFromCluster(clusterId);
gs.print('Draft: ' + draftId);

if (draftId) {
    var d = new GlideRecord('x_1158634_kb_int_0_kb_draft');
    d.get(draftId);
    gs.print('Title: ' + d.getValue('title'));
    gs.print('Tokens in/out: ' + d.getValue('llm_tokens_in') + ' / ' + d.getValue('llm_tokens_out'));
}
```

If a draft sysid prints, **the LLM pipeline is working end-to-end**. Open the draft record and verify the body looks like a structured HTML article with the 7 sections.

---

## Phase 6 — Predictive Intelligence solutions

This phase is **strongly recommended but not required** — both `IncidentClusterEngine` and `ResolutionSuggester` have keyword fallbacks. PI just makes them dramatically more accurate.

### 6.1 Train a Cluster Solution

1. Navigate to **Predictive Intelligence → Solution Definitions → New**.
2. **Solution type:** Clustering
3. **Name:** `incident_cluster_l2l3`  *(must match `x_1158634_kb_int_0.cluster_solution_name`)*
4. **Table:** `incident`
5. **Filter:**  `state IN (Resolved, Closed)` AND `close_notes IS NOT EMPTY` AND `sys_updated_on >= 12 months ago`
6. **Input fields:** `short_description`, `description`, `category`
7. **Save** → click **Train Now**. Training takes 10 minutes – 2 hours depending on instance & data volume.
8. Once "Training succeeded", click **Activate**. The solution version becomes the active one.

### 6.2 Train a Similarity Solution

1. **Predictive Intelligence → Solution Definitions → New**.
2. **Solution type:** Similarity
3. **Name:** `incident_similarity_l2l3`
4. **Table:** `incident`
5. **Filter:** `state IN (Resolved, Closed)` AND `close_notes IS NOT EMPTY`
6. **Input fields:** `short_description`, `description`, `category`
7. **Output field:** *(none — Similarity returns sys_ids of similar records)*
8. **Save → Train Now → Activate**.

### 6.3 If PI is not available

Skip Phase 6 entirely. Both Script Includes will detect that the solutions are missing and fall back to keyword-based grouping/matching. You'll see:

```
INFO: IncidentClusterEngine: PI not available, using keyword fallback
```

in **System Logs → Information** when the scheduled job runs. Accuracy is lower but the demo still works.

---

## Phase 7 — Scheduled cluster job

1. Navigate to **System Definition → Scheduled Jobs → New** (pick "**Run a script of your choosing**").
2. **Name:** `Weekly Incident Cluster Run`
3. **Run:** Weekly
4. **Day:** Sunday
5. **Time:** `02:00:00`
6. **Active:** yes
7. **Run as:** *(leave default — System Administrator works for the LLM HTTP calls)*
8. **Run this script:** paste the contents of [scripts/SJ_weekly_cluster_run.js](scripts/SJ_weekly_cluster_run.js)
9. **Save**.

### 7.1 First run (manual)

Don't wait until Sunday. Open the job and click **Execute Now**. Watch **System Logs → Information** for `SJ_weekly_cluster_run:` lines. After ~5–10 minutes (depends on data + LLM speed), check:

- `x_1158634_kb_int_0_cluster` — should have rows with `status = open` or `draft_pending`
- `x_1158634_kb_int_0_kb_draft` — should have new drafts with `review_state = draft`

---

## Phase 8 — Verify cluster KB drafting end-to-end

Open one draft record from `x_1158634_kb_int_0_kb_draft`. You should see:

- A descriptive `title`
- A summary one-liner
- A `body` (HTML) with the 7 sections defined in the system prompt
- `llm_model_used = gemini-2.5-flash`
- `llm_tokens_in` and `llm_tokens_out` populated

If the body looks malformed or generic, jump to [Appendix A](#appendix-a--troubleshooting).

---

## Phase 9 — KB review & publish workflow

### 9.1 Add the "Approve & Publish" UI Action

1. **System UI → UI Actions → New**
2. **Application:** KB Intelligence
3. Settings:
   - **Name:** `Approve & Publish`
   - **Table:** `x_1158634_kb_int_0_kb_draft`
   - **Action name:** `approve_and_publish`
   - **Form button:** ✓
   - **Show insert:** ✗
   - **Show update:** ✓
   - **Active:** ✓
   - **Client:** ✗
   - **Roles** (related list): `knowledge_manager`, `admin`
   - **Condition:** `current.review_state == 'draft' || current.review_state == 'in_review'`
4. **Script:** paste contents of [scripts/UA_kbdraft_approve.js](scripts/UA_kbdraft_approve.js)
5. **Save**.

### 9.2 Add the "Reject" UI Action

Same steps with:
- **Name:** `Reject Draft`
- **Action name:** `reject_draft`
- Same condition / roles
- Script: [scripts/UA_kbdraft_reject.js](scripts/UA_kbdraft_reject.js)

### 9.3 Add the draft-created notification

#### 9.3.1 Register the event

1. **System Policy → Events → Registry → New**
2. **Event name:** `x_1158634_kb_int_0.draft.created`
3. **Table:** `x_1158634_kb_int_0_kb_draft`
4. **Description:** *Fired when KBDraftBuilder inserts a new draft*

#### 9.3.2 Create the Script Action

1. **System Policy → Events → Script Actions → New**
2. **Name:** `KB Draft Created Notify`
3. **Event name:** `x_1158634_kb_int_0.draft.created`
4. **Active:** yes
5. **Script:** paste contents of [scripts/SA_draft_created_notify.js](scripts/SA_draft_created_notify.js)

### 9.4 Test the publish flow

Pick any draft → open → click **Approve & Publish**. You should:
- Land on the new `kb_knowledge` record
- See it has `workflow_state = published`
- Confirm `x_1158634_kb_int_0_kb_draft.review_state` flipped to `published` and `published_kb` is set

---

## Phase 10 — Resolution Suggester on incident form (L2/L3 core value)

This is the daily-driver feature for L2/L3 engineers. When an incident lands in your queue, the form already shows the top 3 similar past resolutions.

### 10.1 Create the Business Rule

1. **System Definition → Business Rules → New**
2. **Application:** KB Intelligence
3. Settings:
   - **Name:** `Suggest Resolution on Assignment`
   - **Table:** `incident`  *(yes, a Global-scope table — that's why `ResolutionSuggester` is "Accessible from: All application scopes")*
   - **When:** after
   - **Insert:** ✓, **Update:** ✓
   - **Order:** `1000`
   - **Async:** ✓
   - **Active:** ✓
   - **Filter conditions:** `Assignment group changes` AND `Assignment group is not empty`
4. **Advanced → Script:** paste [scripts/BR_incident_assignment_suggest.js](scripts/BR_incident_assignment_suggest.js)
5. **Save**.

### 10.2 Create the UI Macro

1. **System UI → UI Macros → New**
2. **Name:** `x_1158634_kb_int_0_suggestions`
3. **Application:** KB Intelligence
4. **Active:** ✓
5. **XML:** paste contents of [scripts/x_1158634_kb_int_0_suggestions.xml](scripts/x_1158634_kb_int_0_suggestions.xml)

### 10.3 Create the Formatter

1. **System UI → Formatters → New**
2. **Name:** `KB Intelligence Suggestions`
3. **Table:** `incident`
4. **Formatter:** `x_1158634_kb_int_0_suggestions`

### 10.4 Add the formatter to the incident form

1. Open any incident.
2. Form context menu (⋮ in header) → **Configure → Form Layout**.
3. Find `KB Intelligence Suggestions` in **Available** → move to **Selected** → place near the top, above "Notes".
4. **Save**.

### 10.5 Update suggestion log on close (for measurement)

1. **System Definition → Business Rules → New**
2. **Name:** `Update Suggestion Log on Close`
3. **Table:** `incident`
4. **When:** after, **Update:** ✓
5. **Order:** `2000`, **Async:** ✓
6. **Filter conditions:** `State changes to Resolved` OR `State changes to Closed`
7. **Script:** paste [scripts/BR_suggestion_log_close.js](scripts/BR_suggestion_log_close.js)

### 10.6 Test

1. Open any in-progress incident.
2. Change its assignment_group to a different group → save.
3. Wait ~5 seconds (async), then refresh the form.
4. The "Similar Past Resolutions" panel should populate with up to 3 cards.

---

## Phase 11 — "Capture for KB" on incident close

Lets an L2/L3 engineer who just resolved a complex incident capture deep technical details so the LLM can produce a KB.

### 11.1 Create the UI Action

1. **System UI → UI Actions → New**
2. Settings:
   - **Name:** `Capture for KB`
   - **Table:** `incident`
   - **Action name:** `capture_for_kb`
   - **Form button:** ✓
   - **Show update:** ✓
   - **Active:** ✓
   - **Client:** ✗
   - **Condition:** `current.state == 6 || current.state == 7`
3. **Script:** paste [scripts/UA_incident_capture_for_kb.js](scripts/UA_incident_capture_for_kb.js)
4. **Save**.

### 11.2 Create the "Submit for KB Generation" UI Action on Dev Capture

1. **System UI → UI Actions → New**
2. Settings:
   - **Name:** `Submit for KB Generation`
   - **Table:** `x_1158634_kb_int_0_developer_capture`
   - **Action name:** `submit_for_kb_generation`
   - **Form button:** ✓
   - **Show update:** ✓
   - **Active:** ✓
   - **Client:** ✗
   - **Condition:** `current.state == 'draft'`
3. **Script:** paste [scripts/UA_devcapture_submit.js](scripts/UA_devcapture_submit.js)

### 11.3 Create the Business Rule that triggers draft generation

1. **System Definition → Business Rules → New**
2. Settings:
   - **Name:** `Dev Capture Submitted → Generate Draft`
   - **Table:** `x_1158634_kb_int_0_developer_capture`
   - **When:** after, **Update:** ✓
   - **Async:** ✓
   - **Filter conditions:** `State changes to submitted`
3. **Script:** paste [scripts/BR_devcapture_submitted.js](scripts/BR_devcapture_submitted.js)

### 11.4 Test the capture flow

1. Open a closed incident with non-trivial close_notes.
2. Click **Capture for KB** (button on the incident form).
3. The dev capture form opens with `problem_brief` and `resolution_brief` pre-filled from the incident.
4. Toggle **Scripts changed?** → ✓ → fill the **Script details** field with something like:
   ```
   Updated business rule "Auto-Assign On-Call" on incident table.
   The condition was checking current.priority == 1 but missed P1 incidents
   coming via email integration where priority isn't set yet.
   Changed condition to current.priority == 1 || current.urgency == 1.
   ```
5. Fill **Validation steps** with a couple lines.
6. Click **Submit for KB Generation**. Wait ~10–30s.
7. Refresh — the **Generated draft** field should be populated.
8. Open the linked draft → verify the article has a **Script / Code Changes** `<h2>` section quoting the BR name.

---

## Phase 12 — Stretch: Story → KB pipeline

Generates a full KB article when a developer closes a story, capturing what changed in the workflow / scripts / configs.

### 12.1 Confirm Agile Development 2.0 plugin is active

Visit `rm_story.list` in the URL bar. If you see the list view, you're set. If not, install **Agile Development 2.0** plugin (Phase 0 of [setup-checklist.md](setup-checklist.md)).

### 12.2 Find your "Closed Complete" state value

State numeric values vary by ServiceNow release. Run this in **Scripts - Background**:

```javascript
var ch = new GlideRecord('sys_choice');
ch.addQuery('name', 'rm_story');
ch.addQuery('element', 'state');
ch.query();
while (ch.next()) {
    gs.print(ch.getValue('value') + ' = ' + ch.getValue('label'));
}
```

Note the value for "Complete" or "Closed Complete" (commonly `'4'` or `'closed_complete'`). If it's not in the default list `['4', '3', 'closed_complete', 'complete']` in [scripts/BR_story_closure_capture.js](scripts/BR_story_closure_capture.js), edit the array at the top.

### 12.3 Create the Business Rule

1. **System Definition → Business Rules → New**
2. Settings:
   - **Name:** `Story Closure → Dev Capture`
   - **Table:** `rm_story`
   - **When:** after, **Update:** ✓
   - **Async:** ✓
   - **Filter conditions:** `State changes to Complete`  *(adjust to your instance's label)*
3. **Script:** paste [scripts/BR_story_closure_capture.js](scripts/BR_story_closure_capture.js)

### 12.4 Add the story-capture-request notification

#### 12.4.1 Register event

**System Policy → Events → Registry → New**:
- **Event name:** `x_1158634_kb_int_0.story.capture_request`
- **Table:** `x_1158634_kb_int_0_developer_capture`

#### 12.4.2 Script Action

**System Policy → Events → Script Actions → New**:
- **Name:** `Story Capture Request Notify`
- **Event name:** `x_1158634_kb_int_0.story.capture_request`
- **Script:** paste [scripts/SA_story_capture_request.js](scripts/SA_story_capture_request.js)

### 12.5 Test

1. Open any open story in `rm_story.list`.
2. Set **State** = Complete → Save.
3. Wait a few seconds. Check **x_1158634_kb_int_0_developer_capture** list — there should be a new row with `source_type=story`, `source_story` set to your story, `state=draft`.
4. The developer (whoever was `assigned_to` on the story) should receive an email pointing to the capture form.
5. Open the capture form, fill in a brief, click **Submit for KB Generation**.
6. Wait ~30s — the generated draft is linked back via `generated_draft`.

The draft body for a story KB will use **gemini-2.5-pro** (per `x_1158634_kb_int_0.story_model`) and follow the developer-capture system prompt in [prompts.md § P3](prompts.md#p3--developer-capture-system-prompt) — meaning it will have section headers for *Workflow Changes*, *Script / Code Changes* (with before/after blocks if the developer wrote enough), *Configuration Changes*, *Validation Steps*, and *Rollback / Watch-outs*.

---

## Phase 13 — Stretch: DevOps commit context

If your instance has the **ServiceNow DevOps** plugin (`sn_devops`) active and stories are linked to GitHub/GitLab commits, the LLM can write a richer KB by including commit messages and changed-file lists.

This is automatic — `KBDraftBuilder.buildFromDevCapture()` calls `DevOpsContextFetcher` which checks for the DevOps tables. If the plugin isn't active, `fetchForStory()` returns `[]` and the prompt simply omits the COMMIT CONTEXT section. **No code changes needed beyond installing the Script Include in Phase 5.**

If you want to test this:
1. Install the ServiceNow DevOps plugin.
2. Set up a Git tool integration (GitHub or GitLab) per ServiceNow's DevOps setup guide.
3. Make a story, link a commit to it.
4. Run the story-closure flow — verify the user prompt logged to the `x_1158634_kb_int_0_kb_draft.body` is more detailed.

If you're on a PDI without DevOps, **skip this phase** — the rest of the project still works.

---

## Phase 14 — Performance Analytics / dashboards

Two key metrics to track:

### Indicator 1 — KB drafts published per week

If you have Performance Analytics:
1. **Performance Analytics → Indicators → New**
2. **Name:** `KB drafts published`
3. **Facts table:** `x_1158634_kb_int_0_kb_draft`
4. **Conditions:** `review_state = published`
5. **Aggregate:** Count
6. **Frequency:** Daily (collected nightly)

If you don't have PA, just create a **Report** (System UI → Reports):
- **Type:** Bar
- **Source:** `x_1158634_kb_int_0_kb_draft`
- **Group by:** `generated_at` (trended weekly)
- **Filter:** `review_state = published`

### Indicator 2 — MTTR with vs without suggestion

This is the value-prop indicator. Build a report on `x_1158634_kb_int_0_suggestion_log`:
- **Group by:** `accepted_kb` is empty / not empty
- **Aggregate:** Average of `resolution_minutes`

If MTTR is materially lower for incidents where the resolver clicked an accepted_kb, the project is paying off.

### Indicator 3 — Token cost (if you upgrade to paid Gemini)

Sum `llm_tokens_in` + `llm_tokens_out` per week from `x_1158634_kb_int_0_kb_draft`. Multiply by current Gemini per-token pricing.

---

## Phase 15 — Testing

### Manual test checklist

- [ ] Phase 5.1 LLM smoke test passes (JSON returned)
- [ ] Phase 5.2 cluster-to-draft smoke test creates a draft
- [ ] Phase 7.1 scheduled job runs without error
- [ ] Phase 8 a draft has 7 sections in the body HTML
- [ ] Phase 9.4 publish flow creates a `kb_knowledge` record
- [ ] Phase 10.6 suggestion panel shows on a fresh incident
- [ ] Phase 11.4 dev-capture flow generates a draft with **Script / Code Changes** section
- [ ] Phase 12.5 story-closure flow creates a dev capture row
- [ ] Knowledge Manager group receives email when draft is created

### Failure-mode tests

- [ ] Disable the Gemini API key (clear the property) → run Phase 5.1 smoke test → expect graceful failure with `LLMConnector: missing API key` in logs
- [ ] Submit a dev capture with a 5-character problem_brief → expect "Please write at least a 10-character problem brief" toast
- [ ] Reject a draft via UI Action → confirm the source cluster's `status` flips to `dismissed`

---

## Phase 16 — Demo script (for your manager / interview)

A 5-minute walkthrough that shows every workflow:

**Minute 1 — The problem (no slides; show the data).**
> "Here's a list of resolved incidents from the last quarter. [open `incident.list`]. Notice that 'Outlook won't connect after VPN' shows up 14 times. Each was resolved by a different L2 engineer who had to re-investigate. There's no KB covering it. This is the cost of tribal knowledge in L2/L3."

**Minute 2 — Workflow A (cluster → draft).**
> "Each Sunday this scheduled job runs [open `Weekly Incident Cluster Run`]. It finds clusters of similar resolutions, calls Gemini, and produces draft KB articles. Here's one [open a draft]. It has 7 sections, written for an L2 engineer. The Knowledge Manager reviews and clicks 'Approve & Publish'."

**Minute 3 — Workflow B (suggestion on assignment).**
> "But the daily-driver value is here. I open a fresh incident [open one], and on the form I see the 'Similar Past Resolutions' panel with the top 3 matches and one already linked to a KB. Before I do anything else, I know what's likely. This saves 30+ minutes of investigation."

**Minute 4 — Workflow C (capture).**
> "When I close a complex incident, I click 'Capture for KB'. [click it]. I get a 5-field form. I fill 'Scripts changed' with 2 lines about what I changed. Submit. Thirty seconds later, a full KB article appears with code blocks, validation steps, and rollback notes — generated from my brief. And if I closed a *story* instead of an incident, the same flow runs automatically with email reminder."

**Minute 5 — Cost & scale.**
> "All of this runs on Google Gemini's free tier. Zero dollars. We've published [N] KBs in [time], the suggestion panel has been viewed [M] times, and our MTTR on suggestion-accepted incidents is [X]% lower than baseline. And the architecture lets us swap to Now Assist by replacing one Script Include — see Phase 17."

---

## Phase 17 — Optional: swap Gemini → ServiceNow Now Assist

This phase is **optional**. Skip it unless your instance has Now Assist (`sn_now_assist_itsm` and `sn_one_extend`) active. If it does, you can route LLM calls through ServiceNow's own Now Assist platform — keeping prompts inside the ServiceNow trust boundary, eliminating outbound HTTPS, and aligning with Now Assist governance.

The architecture supports this by design: only the `LLMConnector` Script Include changes. Everything else (`KBDraftBuilder`, `IncidentClusterEngine`, `ResolutionSuggester`, all Business Rules, all UI Actions) stays identical.

### 17.1 Verify Now Assist plugins are active

Run in **Scripts - Background**:

```javascript
var plugins = ['sn_one_extend', 'sn_now_assist_skillkit', 'sn_now_assist_itsm'];
plugins.forEach(function(p) {
    var pl = new GlideRecord('v_plugin');
    pl.addQuery('id', p);
    pl.query();
    if (pl.next()) gs.print(p + ' → active=' + pl.getValue('active') + ' (' + pl.getValue('name') + ')');
    else gs.print(p + ' → NOT INSTALLED');
});
```

You need at minimum **`sn_one_extend.active = true`** AND **`sn_now_assist_skillkit.active = true`**. If either is false, this phase doesn't apply — stay on the Gemini path.

### 17.2 Pre-built capability vs custom skill — pick one

**Option A — Use a pre-built Now Assist capability** (only if `sn_now_assist_itsm` is active):

Now Assist for ITSM ships with a capability called something like *"Knowledge Article Creation from Incident"*. Find it via **Now Assist → Now Assist Admin → Capabilities** and copy its **Capability sys_id**. Pre-built capabilities have rigid input shapes — they typically expect an `incident` GlideRecord reference rather than free-form prompts. If the shape doesn't match our cluster-of-incidents use case, go to Option B.

**Option B — Build a custom Generic Skill in Skill Kit** (recommended — matches our prompts exactly):

1. Navigate to **Now Assist → Now Assist Skill Kit → Skills → New**.
2. Pick the **Generic Generative AI** template.
3. Settings:
   - **Name:** `KB Intelligence — Article Generator`
   - **Internal name:** `kb_intel_article_gen`
   - **Description:** `Generates structured KB articles from incident clusters or developer captures`
4. **Inputs** (add via the Inputs related list / panel):
   - `system_prompt` — type *string (large)*, required
   - `user_prompt` — type *string (large)*, required
5. **Prompt template** (the field that combines inputs into a single prompt):
   ```
   ${system_prompt}

   ${user_prompt}
   ```
6. **Generation model:** Pick whichever your org has configured. The dropdown will show options like *Now LLM Generic*, *Azure OpenAI*, etc. depending on your Now Assist setup.
7. **Output format:** Set to JSON if your release supports it, with this schema:
   ```json
   {
     "title":     { "type": "string" },
     "summary":   { "type": "string" },
     "body_html": { "type": "string" }
   }
   ```
   If your release doesn't support output schemas in Skill Kit, leave as plain text — the parser in `KBDraftBuilder._parseLLMArticle` already handles "JSON anywhere in the response" as a fallback.
8. **Save → Test** with a real prompt from [prompts.md](prompts.md) (paste P1 as system, P2 sample as user). Confirm the output looks like a valid KB JSON.
9. **Publish** the skill.
10. Open the published Capability and **copy its sys_id** from the URL (`...?sys_id=<copy this>`). You'll paste it into a system property next.

### 17.3 Add the capability sys_id to system properties

**System Properties → New** in scope `KB Intelligence`:

| Name (suffix)              | Type    | Value                        |
| -------------------------- | ------- | ---------------------------- |
| `now_assist_capability_id` | string  | *sys_id from step 17.2*      |
| `llm_provider`             | string  | `now_assist`                 |

The `llm_provider` property is read by the alternate connector to decide which API to call. Default value is implicitly `gemini`.

### 17.4 Replace the body of `LLMConnector`

Open the existing `LLMConnector` Script Include (created in Phase 5):

1. **System Definition → Script Includes → LLMConnector** (filter by application = KB Intelligence).
2. Click into the record.
3. **Replace the entire Script field** with the contents of [scripts/LLMConnector_NowAssist.js](scripts/LLMConnector_NowAssist.js).
4. **Save**.

The class name stays `LLMConnector` and the public method stays `callGemini(systemPrompt, userPrompt, options)` — kept for compatibility so [KBDraftBuilder.js](scripts/KBDraftBuilder.js) and the Phase 5.1 smoke test work without modification. Internally, when `llm_provider = now_assist`, the method routes through `sn_one_extend_util.OneExtendUtil.execute()`.

### 17.5 Re-run the smoke tests

Run Phase 5.1 (basic LLM smoke test) and Phase 5.2 (cluster → draft). Both should still produce valid drafts. The `llm_model_used` field on the resulting draft will now read something like `now_assist:kb_intel_article_gen` instead of `gemini-2.5-flash`.

If the smoke test fails:
- Check **System Logs → Errors** for `LLMConnector:` lines. The first run typically reveals an unexpected response shape from `OneExtendUtil` — the connector logs the raw response when parsing fails. Adjust the `_extractText()` function in [scripts/LLMConnector_NowAssist.js](scripts/LLMConnector_NowAssist.js) to match your release's response shape.
- Verify your `now_assist_capability_id` is the **published capability** sys_id, not the draft skill sys_id.
- Verify the executing user has the role required to invoke the capability (typically `sn_now_assist_user` or `admin`).

### 17.6 Trade-offs — Gemini vs Now Assist

| Aspect                  | Gemini (default)                          | Now Assist (this phase)                       |
| ----------------------- | ----------------------------------------- | --------------------------------------------- |
| Cost                    | Free tier; ~$0.10/mo paid tier            | Bundled into Now Assist licensing (paid SKU)  |
| Data residency          | Sent to Google                            | Stays inside ServiceNow                       |
| Privacy on free tier    | ⚠️ May train Google models                | No training, fully governed                   |
| Outbound HTTPS needed   | Yes                                       | No — internal call                            |
| Model choice            | Direct (`gemini-2.5-flash` etc.)          | Whatever your org configured in Now Assist    |
| JSON output enforcement | Native via `responseSchema`               | Depends on release; fallback parser handles it |
| Observability           | Token counts on draft record              | Now Assist Admin → Skill execution logs       |
| Rate limits             | 15 RPM free, much higher paid             | Whatever your Now Assist tier provides        |

### 17.7 Hybrid approach (advanced)

If you want both — e.g., Now Assist for production-data captures (compliance) and Gemini for cluster-of-demo-data (free tier) — set `llm_provider = now_assist` as the default, then in [KBDraftBuilder.js](scripts/KBDraftBuilder.js) `buildFromCluster()` add `options.forceProvider = 'gemini'` before the LLM call. The connector reads `options.forceProvider` to override the property per-call. (Not implemented in the shipped script — left as an exercise; a 5-line change in `LLMConnector_NowAssist.js`.)

### 17.8 Switching back to Gemini

Single step: paste the original [scripts/LLMConnector.js](scripts/LLMConnector.js) contents back into the `LLMConnector` Script Include. Nothing else changes.

---

## Appendix A — Troubleshooting

### LLM call returns null

- **Check System Logs → Errors** for `LLMConnector:` lines — the message will tell you status code & body.
- **HTTP 400 with `INVALID_ARGUMENT`:** likely a malformed request body. The most common cause is an old model name. As of late 2026 the canonical names are `gemini-2.5-flash`, `gemini-2.5-pro`, `gemini-2.0-flash`. If you see `model not found`, check [ai.google.dev/models](https://ai.google.dev/models) for the current list.
- **HTTP 401 / 403:** key invalid or revoked. Regenerate at [aistudio.google.com/apikey](https://aistudio.google.com/apikey).
- **HTTP 429:** rate limited. The connector retries with backoff but if you're slamming it (e.g., backfilling 500 clusters at once), space out the calls. The `SJ_weekly_cluster_run` script already does this with a 5-second sleep.
- **HTTP 0 / connection refused:** outbound HTTPS blocked. See § 4.3.

### Draft body is empty or generic

- **The `finishReason` was `SAFETY`:** Gemini blocked the response. The connector logs this. Common with credential-related incidents that mention "password" or "leak". Lower the `safetySettings` further to `BLOCK_NONE` (only on dev instances) or rephrase the source data.
- **The user prompt was too short:** if the cluster only has 2 incidents with one-line resolutions, the LLM has nothing to write about. Increase `min_cluster_size` to 5+.
- **Truncation:** body cuts off mid-sentence. Increase `maxTokens` in `KBDraftBuilder` (default 3000 / 4096).

### Suggestion panel empty after assignment

- The Business Rule is async — wait 5–10 seconds and refresh the form.
- Check `x_1158634_kb_int_0_suggestion_log` directly. Is there a row for this incident? If yes but the `suggested_kbs` JSON is `[]`, the suggester found nothing — check that you have closed incidents in the same `category` with non-empty `close_notes`.
- Check the Business Rule is **active** and on table `incident`.

### Story closure doesn't create a dev capture

- Confirm the state value matches. Re-run the diagnostic script in 12.2.
- Check **System Logs → Information** for the BR firing.
- Confirm the BR is **async** — sync BRs don't fire on imported records.

### Tables prefixed wrong

- If your scope is something like `x_42851_kb_intel` instead of `x_1158634_kb_int_0`, all table names in this guide are off by that prefix. Fix it once: rename your scope, or accept the longer prefix and find/replace it in every script file before pasting.

---

## Appendix B — Cost & rate-limit reference

### Gemini free tier (as of late 2026 — check [ai.google.dev/pricing](https://ai.google.dev/pricing) for current limits)

| Model               | RPM | TPM       | RPD   | Notes                            |
| ------------------- | --- | --------- | ----- | -------------------------------- |
| `gemini-2.5-flash`  | 15  | 1,000,000 | 1,500 | Default for cluster KBs          |
| `gemini-2.5-pro`    | 5   | 250,000   | 100   | For story KBs (high quality)     |
| `gemini-2.0-flash`  | 15  | 1,000,000 | 1,500 | Backup if 2.5 Flash misbehaves   |

> **Free tier sends data to Google for product improvement.** OK for demo / non-sensitive PDI data; **do not** use real production data on free tier.

### Estimated monthly footprint of this project on a small L2/L3 team

| Workload                          | Calls/month | Avg tokens in | Avg tokens out | Free tier OK? |
| --------------------------------- | ----------- | ------------- | -------------- | ------------- |
| Weekly cluster job (~20 drafts)   | 80          | 2,500         | 1,500          | yes           |
| Story closures (~30/month)        | 30          | 3,000         | 2,500          | yes           |
| Capture-for-KB on incidents (~50) | 50          | 2,500         | 2,500          | yes           |
| **Total**                         | **160**     | —             | —              | **well within free**          |

If you outgrow free tier, the paid pricing on `gemini-2.5-flash` is roughly $0.30 / 1M input tokens — ~$0.10/month for the workload above.

---

## Done.

You have a working scoped app that:
- Auto-clusters resolved incidents into recurring patterns
- Drafts KB articles from clusters via Gemini (free tier)
- Surfaces top similar resolutions on every incident assigned to L2/L3
- Captures deep technical detail from resolvers via a 5-field structured form
- Generates structured story KBs on closure with sections for workflow / script / config changes
- Routes everything through a Knowledge Manager review/publish gate
- Tracks suggestion effectiveness and token cost for ongoing measurement

Open [README.md](README.md) for the high-level pitch / portfolio framing.
