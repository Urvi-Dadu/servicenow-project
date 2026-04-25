# Data Model — Custom Tables Reference

All tables live in scope **`x_kb_intel`**. Build via **System Definition → Tables → New** *after* creating the scoped app in Phase 2 of `implementation.md`.

> **Note on naming:** The table prefix `x_kb_intel_` is auto-applied by ServiceNow for every table you create *while inside the scoped app context*. So when the form asks for "Name", just enter `cluster` (not the full prefixed name).

---

## Table 1: `x_kb_intel_cluster`

**Label:** Incident Cluster
**Extends:** None (base table)
**Application:** KB Intelligence (the scoped app)

| Column label              | Column name                | Type                | Length / Reference                  | Notes                              |
| ------------------------- | -------------------------- | ------------------- | ----------------------------------- | ---------------------------------- |
| Name                      | `name`                     | String              | 100, unique                         | Cluster label (from PI)            |
| Summary                   | `summary`                  | String              | 500                                 | First 3 short_descriptions joined  |
| Representative incident   | `representative_incident`  | Reference           | → `incident`                        | First seen in cluster              |
| Member count              | `member_count`             | Integer             | —                                   | Count of incidents in cluster      |
| Last seen                 | `last_seen`                | Date/Time           | —                                   | Most recent incident in cluster    |
| Linked KB                 | `linked_kb`                | Reference           | → `kb_knowledge`                    | If a KB already covers this        |
| Status                    | `status`                   | Choice              | open / has_kb / dismissed / draft_pending | See choice list below       |
| Avg resolution (minutes)  | `avg_resolution_minutes`   | Integer             | —                                   | For SLA / impact calc              |
| Top assignment group      | `top_assignment_group`     | Reference           | → `sys_user_group`                  | Most frequent group in cluster     |

**Choice list — `status`:**
```
open           — needs review, no KB yet
has_kb         — already covered, no action
dismissed      — KM marked as not worth a KB (false cluster, etc.)
draft_pending  — draft generated, awaiting review
```

---

## Table 2: `x_kb_intel_dev_capture`

**Label:** Developer Capture
**Extends:** None
**Application:** KB Intelligence

| Column label          | Column name           | Type                | Length / Reference         | Notes                                 |
| --------------------- | --------------------- | ------------------- | -------------------------- | ------------------------------------- |
| Source type           | `source_type`         | Choice              | story / incident / problem | What triggered this capture           |
| Source story          | `source_story`        | Reference           | → `rm_story`               | If source is story                    |
| Source incident       | `source_incident`     | Reference           | → `incident`               | If source is incident                 |
| Source problem        | `source_problem`      | Reference           | → `problem`                | Optional                              |
| Developer             | `developer`           | Reference           | → `sys_user`               | Who is filling out the form           |
| Problem brief         | `problem_brief`       | String              | 1000                       | What was the issue/ask                |
| Resolution brief      | `resolution_brief`    | String              | 2000                       | What you did, in your words           |
| Root cause            | `root_cause`          | String              | 1000                       | Why this happened / why this was needed |
| Workflow changed      | `workflow_changed`    | True/False          | —                          | Toggle                                |
| Workflow details      | `workflow_details`    | String              | 2000                       | Workflow name + activity + change     |
| Scripts changed       | `scripts_changed`     | True/False          | —                          | Toggle                                |
| Script details        | `script_details`      | String              | 4000                       | Script name + before/after / what     |
| Configs changed       | `configs_changed`     | True/False          | —                          | Toggle                                |
| Config details        | `config_details`      | String              | 2000                       | sys_property / ACL / table / etc.     |
| Validation steps      | `validation_steps`    | String              | 2000                       | How you tested it                     |
| Related items         | `related_items`       | String              | 2000                       | Links to commits, tickets, designs    |
| Generated draft       | `generated_draft`     | Reference           | → `x_kb_intel_kb_draft`    | Set after submit → process            |
| State                 | `state`               | Choice              | draft / submitted / processed / cancelled | See below          |

**Choice list — `state`:**
```
draft       — being filled out
submitted   — developer pressed "Submit for KB Generation"
processed   — LLM has generated a draft (visible in generated_draft)
cancelled   — abandoned
```

---

## Table 3: `x_kb_intel_kb_draft`

**Label:** KB Draft
**Extends:** None
**Application:** KB Intelligence

| Column label          | Column name             | Type                | Length / Reference                | Notes                              |
| --------------------- | ----------------------- | ------------------- | --------------------------------- | ---------------------------------- |
| Title                 | `title`                 | String              | 200                               | LLM-generated                      |
| Summary               | `summary`               | String              | 1000                              | LLM-generated                      |
| Body                  | `body`                  | HTML                | (large)                           | Article HTML                       |
| Source type           | `source_type`           | Choice              | incident_cluster / story / dev_capture | What was fed to LLM           |
| Source cluster        | `source_cluster`        | Reference           | → `x_kb_intel_cluster`            |                                    |
| Source story          | `source_story`          | Reference           | → `rm_story`                      |                                    |
| Source incident       | `source_incident`       | Reference           | → `incident`                      |                                    |
| Source dev capture    | `source_dev_capture`    | Reference           | → `x_kb_intel_dev_capture`        |                                    |
| Resolver              | `resolver`              | Reference           | → `sys_user`                      | Author / authority                 |
| Review state          | `review_state`          | Choice              | draft / in_review / approved / rejected / published | See below |
| Published KB          | `published_kb`          | Reference           | → `kb_knowledge`                  | Set when approved & published      |
| Reviewer              | `reviewer`              | Reference           | → `sys_user`                      | KM who approved/rejected           |
| Review notes          | `review_notes`          | String              | 2000                              | Why approved or rejected           |
| LLM model used        | `llm_model_used`        | String              | 60                                | e.g. `gemini-2.5-flash`            |
| LLM tokens in         | `llm_tokens_in`         | Integer             | —                                 | Cost tracking                      |
| LLM tokens out        | `llm_tokens_out`        | Integer             | —                                 | Cost tracking                      |
| Generated at          | `generated_at`          | Date/Time           | —                                 | When LLM call completed            |

**Choice list — `review_state`:**
```
draft       — fresh from LLM
in_review   — KM has opened it
approved    — KM approved but not yet published (race-window state)
rejected    — KM rejected, will not publish
published   — kb_knowledge created, link in published_kb
```

---

## Table 4: `x_kb_intel_suggestion_log`

**Label:** Suggestion Log
**Extends:** None
**Application:** KB Intelligence

| Column label          | Column name           | Type            | Length / Reference          | Notes                              |
| --------------------- | --------------------- | --------------- | --------------------------- | ---------------------------------- |
| Incident              | `incident`            | Reference       | → `incident`                |                                    |
| Suggested KBs         | `suggested_kbs`       | String          | 8000                        | JSON array of suggestions          |
| Suggested at          | `suggested_at`        | Date/Time       | —                           |                                    |
| Accepted KB           | `accepted_kb`         | Reference       | → `kb_knowledge`            | Filled if resolver clicked one     |
| Resolution minutes    | `resolution_minutes`  | Integer         | —                           | Set on incident close              |
| Resolver              | `resolver`            | Reference       | → `sys_user`                |                                    |

**JSON shape stored in `suggested_kbs`:**

```json
[
  {
    "incident_sys_id": "abc123...",
    "incident_number": "INC0010234",
    "short_description": "Outlook will not connect to Exchange after VPN",
    "close_notes": "Cleared cached credentials...",
    "score": 0.87,
    "kb_sys_id": "def456..."
  }
]
```

---

## Application properties

Created in Phase 4 via **System Properties → New** (within scoped app):

| Property name                                | Type                | Default                          | Purpose                                  |
| -------------------------------------------- | ------------------- | -------------------------------- | ---------------------------------------- |
| `x_kb_intel.gemini_api_key`                  | password 2 (encrypted) | (set manually)                | Google Gemini API key (AIza...)          |
| `x_kb_intel.default_model`                   | string              | `gemini-2.5-flash`               | Default LLM for KB drafting              |
| `x_kb_intel.story_model`                     | string              | `gemini-2.5-pro`                 | Higher-quality model for story KBs       |
| `x_kb_intel.cluster_solution_name`           | string              | `incident_cluster_l2l3`          | PI Cluster Solution name                 |
| `x_kb_intel.similarity_solution_name`        | string              | `incident_similarity_l2l3`       | PI Similarity Solution name              |
| `x_kb_intel.min_cluster_size`                | integer             | `5`                              | Min cluster size to flag as "gap"        |
| `x_kb_intel.lookback_days`                   | integer             | `365`                            | Window for incident clustering           |
| `x_kb_intel.suggestion_top_n`                | integer             | `3`                              | Top-N similar incidents to surface       |
| `x_kb_intel.target_kb_base`                  | string              | (sys_id of `kb_knowledge_base`)  | Where published KBs land                 |
| `x_kb_intel.knowledge_manager_group`         | string              | (sys_id of group)                | Whom to notify for review                |
| `x_kb_intel.llm_provider`                    | string              | `gemini`                         | Phase 17 only: set to `now_assist` to route via Now Assist |
| `x_kb_intel.now_assist_capability_id`        | string              | (set in Phase 17)                | Phase 17 only: published Now Assist capability sys_id |

---

## Relationships at a glance

```
incident ─────────┐
                  ├──→ x_kb_intel_cluster ──→ x_kb_intel_kb_draft ──→ kb_knowledge
                  ├──→ x_kb_intel_dev_capture ──┘
rm_story ─────────┤
                  └──→ x_kb_intel_dev_capture ──→ x_kb_intel_kb_draft ──→ kb_knowledge

incident ──→ x_kb_intel_suggestion_log ──→ kb_knowledge (accepted)
```
