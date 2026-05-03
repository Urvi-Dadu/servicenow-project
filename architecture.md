# Architecture — One-Page Overview

## High-level data flow

```
                ┌──────────────────────────────────────────────────────────┐
                │                    ServiceNow Instance                    │
                │                                                            │
   ┌──────────┐ │  ┌───────────────┐    ┌──────────────────┐                │
   │ Resolved │─┼─▶│ Predictive    │───▶│ x_1158634_kb_int_0_      │                │
   │ Incidents│ │  │ Intelligence  │    │ cluster (custom) │                │
   └──────────┘ │  │ (clustering)  │    └────────┬─────────┘                │
                │  └───────────────┘             │                           │
                │                                │ scheduled job             │
                │                                ▼                           │
                │                       ┌──────────────────┐                │
                │                       │ KBDraftBuilder   │                │
                │                       │ (Script Include) │──┐             │
                │                       └──────────────────┘  │             │
                │                                              │             │
   ┌──────────┐ │   on close   ┌──────────────────┐           │             │
   │ Incident │─┼─────────────▶│ x_1158634_kb_int_0_      │           │             │
   │ resolver │ │ "Capture for │ dev_capture      │───────────┤             │
   └──────────┘ │   KB" UA     └──────────────────┘           │             │
                │                                              ▼             │
   ┌──────────┐ │   on close   ┌──────────────────┐    ┌──────────────────┐ │
   │  Story   │─┼─────────────▶│ Capture form     │───▶│ x_1158634_kb_int_0_kb_   │ │
   │developer │ │   complete   │ (developer brief)│    │ draft (custom)   │ │
   └──────────┘ │              └──────────────────┘    └────────┬─────────┘ │
                │                                                │           │
                │                          ┌─────────────────────┤           │
                │                          ▼                     │           │
                │              ┌──────────────────┐              │           │
                │              │ Knowledge Mgr    │              │           │
                │              │ Review (UI Action)              │           │
                │              └────────┬─────────┘              │           │
                │                       │ approve                │           │
                │                       ▼                        │           │
                │              ┌──────────────────┐              │           │
                │              │  kb_knowledge    │              │           │
                │              │  (published)     │              │           │
                │              └────────┬─────────┘              │           │
                │                       │                        │           │
                │  on incident          ▼                        │           │
                │  assignment   ┌──────────────────┐             │           │
                │     ──────────│ Resolution       │◀────────────┘           │
                │               │ Suggester        │  predict via PI         │
                │               │ (formatter on    │  similarity solution    │
                │               │  incident form)  │                         │
                │               └──────────────────┘                         │
                └──────────────────────────────────────────────────────────┘
                              │                          │
                              ▼                          ▼
                    ┌──────────────────┐    ┌──────────────────────┐
                    │  Google Gemini   │    │  GitHub / GitLab via │
                    │  API (free tier) │    │  ServiceNow DevOps   │
                    │                  │    │  (Phase 13 stretch)  │
                    └──────────────────┘    └──────────────────────┘
```

## Component matrix

| Component                          | Type                  | Purpose                                                              |
| ---------------------------------- | --------------------- | -------------------------------------------------------------------- |
| `LLMConnector`                     | Script Include        | Wraps Google Gemini `generateContent` API; returns text + token usage |
| `IncidentClusterEngine`            | Script Include        | Runs PI Cluster Solution over closed incidents → custom cluster table |
| `KBDraftBuilder`                   | Script Include        | Assembles prompt, calls LLM, persists draft                          |
| `ResolutionSuggester`              | Script Include        | On new incident, finds top-N similar resolved incidents              |
| `DevOpsContextFetcher`             | Script Include        | (Stretch) Pulls commits/files linked to a story                      |
| `x_1158634_kb_int_0_cluster`               | Custom table          | One row per detected cluster of similar incidents                    |
| `x_1158634_kb_int_0_developer_capture`           | Custom table          | Developer's structured brief (inputs to LLM)                         |
| `x_1158634_kb_int_0_kb_draft`              | Custom table          | LLM-generated draft awaiting review                                  |
| `x_1158634_kb_int_0_suggestion_log`        | Custom table          | Audit log of suggestions for measurement                             |
| `BR_incident_assignment_suggest`   | Business Rule         | On assignment_group change → run ResolutionSuggester                 |
| `BR_story_closure_capture`         | Business Rule         | On story `Closed Complete` → create dev_capture record               |
| `BR_devcapture_submitted`          | Business Rule         | On dev_capture state=submitted → call KBDraftBuilder                 |
| `UA_incident_capture_for_kb`       | UI Action             | "Capture for KB" button on resolved incident                         |
| `UA_devcapture_submit`             | UI Action             | "Submit for KB Generation" on dev_capture form                       |
| `UA_kbdraft_approve`               | UI Action             | "Approve & Publish" on draft → creates kb_knowledge                  |
| `SJ_weekly_cluster_run`            | Scheduled Job         | Weekly: rerun clustering + generate drafts for new gaps              |
| `x_1158634_kb_int_0_suggestions` (formatter)| UI Macro             | Renders suggestion side panel on incident form                       |

## Tech stack quick reference

| Layer            | Technology                                            |
| ---------------- | ----------------------------------------------------- |
| Platform         | ServiceNow (Yokohama+)                                |
| ML / Clustering  | Predictive Intelligence (built-in)                    |
| LLM              | Google Gemini API — free tier (`gemini-2.5-flash` default) |
| Integration      | `sn_ws.RESTMessageV2` (no MID Server needed)          |
| Workflow         | Flow Designer + Business Rules                        |
| UI               | UI Macros, UI Actions, Service Portal widget          |
| Monitoring       | Performance Analytics indicators (or basic reports)   |

## Pluggable LLM backend

The `LLMConnector` Script Include is the **only** component that talks to the LLM. Two implementations ship with this project, both exposing the identical class name and method signature:

| Implementation                                             | Backend                                | When to use                                         |
| ---------------------------------------------------------- | -------------------------------------- | --------------------------------------------------- |
| [scripts/LLMConnector.js](scripts/LLMConnector.js)         | Google Gemini API (free / paid tier)   | Default — works on any PDI                          |
| [scripts/LLMConnector_NowAssist.js](scripts/LLMConnector_NowAssist.js) | ServiceNow Now Assist (OneExtend) | If `sn_one_extend` + `sn_now_assist_skillkit` active |

Swapping is a single-Script-Include paste — see [implementation.md § Phase 17](implementation.md#phase-17--optional-swap-gemini--servicenow-now-assist). `KBDraftBuilder`, `ResolutionSuggester`, and all UI components are unchanged.

## Key design decisions

1. **Scoped app (`x_1158634_kb_int_0`):** keeps custom tables, scripts, and properties isolated; trivial to package and move between instances via Update Set or App Repo.
2. **Drafts before publish:** Every LLM output goes to `x_1158634_kb_int_0_kb_draft` for human review. Never auto-publishes.
3. **Token usage tracked per draft:** `llm_tokens_in` and `llm_tokens_out` on the draft table — easy cost reporting.
4. **PI is recommended but not required:** Both `IncidentClusterEngine` and `ResolutionSuggester` have keyword-based fallback paths so the project works on any PDI, even before PI solutions are trained.
5. **Story KB uses `gemini-2.5-pro` by default:** Story content is high-stakes (contains code snippets, workflow names) — quality matters more than throughput, and Pro's 100/day free limit is plenty for story closures.
6. **No MID Server:** All LLM calls go directly from ServiceNow to `generativelanguage.googleapis.com` via outbound HTTPS.

## What it doesn't do (deliberate scope)

- Does **not** train LLMs on your data on paid tier. ⚠️ **The Gemini free tier MAY use your prompts to improve Google's products** — only use demo/non-sensitive data on free tier; upgrade to paid for production.
- Does **not** auto-publish KB articles. Human review is mandatory.
- Does **not** read encrypted incident fields or files attached to incidents.
- Does **not** replace ServiceNow's Now Assist KB Gen feature — this is an open-source equivalent that works without Now Assist licensing.
