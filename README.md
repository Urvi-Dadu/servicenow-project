# Predictive Resolution Assistant & Auto-KB Generator (L2 / L3)

A scoped ServiceNow application that turns repeat incidents and closed stories into reviewed, published Knowledge Base articles using a Large Language Model (**Google Gemini — free tier**). Built for **L2/L3 engineers** — the core value is reducing investigation time on recurring complex incidents and capturing tribal knowledge that today gets lost in chat threads and resolver memory.

> **LLM choice:** This project uses **Google Gemini 2.5 Flash** via the free Google AI Studio API. Gemini's free tier is 15 requests/minute and 1500/day — more than enough. Native JSON output mode means cleaner parsing than most LLM providers. No credit card required.

## Why L2 / L3 (not L1)

L1 deflection is the cliché use case. L2/L3 has a different, harder problem:

| Pain (today)                                                        | What this app does                                                                                            |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Same root cause re-investigated by different engineers              | Surfaces top-N similar past resolutions on incident form within seconds of assignment                         |
| Resolution detail (script changed, workflow tweaked) lives in heads | "Capture for KB" UI Action — 5 structured fields → LLM expands to a polished KB article                       |
| Story closures don't produce knowledge                              | On story `Closed Complete`, developer fills a 2-minute brief; system generates a structured KB                |
| New L2/L3 joiners ramp slowly                                       | Generated KBs are technically deep (root cause, code diffs, validation steps) — actually useful for engineers |

## Documents in this project

| File                                          | Purpose                                                                                |
| --------------------------------------------- | -------------------------------------------------------------------------------------- |
| [implementation.md](implementation.md)        | Master step-by-step build guide. **Start here.** Every script and config inline.       |
| [architecture.md](architecture.md)            | One-page system overview — components, data flow, tech stack                           |
| [data-model.md](data-model.md)                | Custom table reference (fields, types, relations)                                      |
| [prompts.md](prompts.md)                      | LLM prompt library — system prompts, user templates, tuning notes                      |
| [setup-checklist.md](setup-checklist.md)      | Pre-flight checklist before you start building (PDI version, plugins, API key)         |
| [scripts/](scripts/)                          | Stand-alone files for each Script Include / Business Rule / UI Action / Scheduled Job  |

## Build order at a glance

1. Read [setup-checklist.md](setup-checklist.md) → confirm PDI, plugins, API key
2. Follow [implementation.md](implementation.md) phase-by-phase
3. Skip to **Phase 12** for the Story → KB stretch goal
4. Skip to **Phase 13** for DevOps / Git integration

## Stretch goals included

- **Story-to-KB pipeline:** Developer closes a story → 2-min brief form → structured KB generated covering root cause, workflow changes, script changes (with snippets), config changes, validation steps
- **DevOps context fetcher:** If ServiceNow DevOps plugin is active, auto-pulls linked commits and changed files into the LLM prompt for richer KB content
- **Suggestion effectiveness loop:** Tracks which suggestions get accepted and feeds MTTR-delta into Performance Analytics
- **Now Assist swap path (Phase 17):** If your instance has Now Assist licensing, swap one Script Include and the LLM calls route through ServiceNow's own AI platform instead of Gemini — same architecture, different backend. See [implementation.md § Phase 17](implementation.md#phase-17--optional-swap-gemini--servicenow-now-assist).

## Tech stack

- ServiceNow (Yokohama / Xanadu / Washington release — any modern release works)
- Predictive Intelligence plugin (`com.glide.platform_ml`) — primary path
- Performance Analytics (optional — fallback to reports)
- IntegrationHub Starter (optional — REST messages work without it)
- Google Gemini API — free tier (`gemini-2.5-flash` default; `gemini-2.5-pro` for high-stakes story KBs; `gemini-2.0-flash` for cheapest/fastest fallback)
- Optional: ServiceNow DevOps plugin for commit context

## Cost expectation

**Zero $.** Google Gemini's free tier covers everything this project does:
- Free tier: 15 requests/minute, 1,000,000 tokens/minute, 1,500 requests/day on `gemini-2.5-flash`
- One-time backfill: ~200 KB drafts × 1 request each = well under daily limit
- Ongoing: ~5–10 drafts/week — invisible against the daily cap
- Story KBs use `gemini-2.5-pro` (free tier: 5 RPM, 100/day) — also fits

If you hit free-tier limits during a backfill, the Script Includes already handle 429 errors with exponential backoff (Phase 5).
