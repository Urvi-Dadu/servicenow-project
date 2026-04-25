# Setup Checklist — Run Before Phase 1

Tick each item off before you start [implementation.md](implementation.md). If anything is missing, the build will stall mid-phase.

## 1. ServiceNow instance

- [ ] **Personal Developer Instance (PDI)** from [developer.servicenow.com](https://developer.servicenow.com). Any modern release — Yokohama, Xanadu, Washington — works.
- [ ] You have the `admin` role.
- [ ] PDI is **awake** (not hibernating). Wake it from the developer portal if needed.

## 2. Plugins to activate

Activate via **System Definition → Plugins** (search and click *Install*). Each takes 5–15 minutes.

| Plugin                                         | Plugin ID                            | Required? | Notes                                                 |
| ---------------------------------------------- | ------------------------------------ | --------- | ----------------------------------------------------- |
| Predictive Intelligence                        | `com.glide.platform_ml`              | Strongly recommended | Primary path. Fallback exists if absent.    |
| Predictive Intelligence — ITSM Solutions       | `com.snc.platform_ml.itsm`           | Optional  | Pre-built ITSM solutions you can copy from            |
| Performance Analytics                          | `com.snc.pa.dashboards`              | Optional  | Falls back to standard reports                        |
| Knowledge Management Advanced                  | `com.snc.knowledge_advanced`         | Yes       | Needed for `kb_knowledge` workflow states             |
| IntegrationHub Starter Pack Installer          | `com.glide.hub.integrations.starter` | Optional  | Scripted REST works without it                        |
| Agile Development 2.0                          | `com.snc.sdlc.agile.2.0`             | Yes for Story stretch | Provides `rm_story` table                   |
| ServiceNow DevOps                              | `sn_devops`                          | Optional  | Only if you want commit context (Phase 13 stretch)    |
| Virtual Agent (optional surface for KBs)       | `com.glide.cs.chatbot`               | Optional  | Phase 14 stretch surface                              |

## 3. Google Gemini API key (free)

- [ ] Go to [aistudio.google.com/apikey](https://aistudio.google.com/apikey) (Google AI Studio)
- [ ] Sign in with any Google account
- [ ] Click **Create API key** → choose "Create API key in new project" (or pick an existing GCP project)
- [ ] Copy the key. Format: `AIzaSy...` (39 characters)
- [ ] **No credit card required.** Free tier limits — more than enough for this project:
  - `gemini-2.5-flash` (default): 15 RPM, 1M TPM, 1500 RPD
  - `gemini-2.5-pro` (story KBs): 5 RPM, 250K TPM, 100 RPD
  - `gemini-2.0-flash` (fallback): 15 RPM, 1M TPM, 1500 RPD
- [ ] Save the key securely — you'll paste it into a ServiceNow system property in Phase 4

> **Privacy note:** Per Google's [free-tier terms](https://ai.google.dev/gemini-api/terms), prompts and responses on the **free tier MAY be used to improve Google's products**. Do NOT paste production data containing PII or secrets. For production use, upgrade to the paid tier (still very cheap; ~$0.30 per million input tokens on Flash) which has a no-training guarantee. The demo data this project generates is safe.

## 4. ServiceNow data

- [ ] At least **50 closed incidents** with non-empty `close_notes`. PDIs come with demo incidents but most have empty close_notes — if so, run the demo data generator:

   ```javascript
   // Background Scripts: System Definition → Scripts - Background
   // Generates 200 demo closed incidents with realistic resolution notes
   var samples = [
     { sd: "Outlook will not connect to Exchange after VPN disconnect", res: "Cleared cached credentials in Credential Manager. Reconnected VPN before launching Outlook. Issue resolved.", cat: "software" },
     { sd: "MID Server stuck in Down state after restart", res: "Restarted MID Server service via services.msc. Verified outbound 443 to instance. Status went Up within 2 minutes.", cat: "software" },
     { sd: "User cannot access Service Portal — 403 forbidden", res: "User missing 'snc_internal' role. Granted role via sys_user_has_role. Logged out and back in.", cat: "inquiry" },
     { sd: "SAML login redirect loop on production instance", res: "IdP certificate had expired. Rotated cert in sys_properties.list (saml2.sp.cert). Tested login, working.", cat: "network" },
     { sd: "Scheduled job 'Data Export' has not run for 3 days", res: "Job was on a node that crashed. Verified node status, reassigned job to active node, ran on demand to backfill.", cat: "software" }
   ];
   for (var i = 0; i < 200; i++) {
     var s = samples[i % samples.length];
     var gr = new GlideRecord('incident');
     gr.initialize();
     gr.setValue('short_description', s.sd + ' (#' + i + ')');
     gr.setValue('description', s.sd + ' — reported by user via portal.');
     gr.setValue('close_notes', s.res);
     gr.setValue('category', s.cat);
     gr.setValue('state', 7); // closed
     gr.setValue('incident_state', 7);
     gr.setValue('close_code', 'Solved (Permanently)');
     gr.setValue('resolved_at', gs.daysAgo(Math.floor(Math.random() * 180)));
     gr.insert();
   }
   gs.print('Done — 200 demo incidents created');
   ```

- [ ] At least **one Knowledge Base** to publish to. Default is fine (`Knowledge`). Note its `sys_id` — you'll need it in Phase 9. Find it via **Knowledge → Knowledge Bases**.

## 5. Groups & users

- [ ] A group named **Knowledge Managers** (or pick an existing one). Add yourself as a member. The KB review notification routes here.
- [ ] At least one **L2/L3 assignment group**. The default `Database` or `Network` groups in PDI work. Note their sys_ids — you'll restrict the resolution-suggestion business rule to these in Phase 10.

## 6. Local environment (for editing scripts)

You can build entirely in the ServiceNow UI, but if you want to edit scripts in VS Code first and paste them in:

- [ ] VS Code installed
- [ ] (Optional) **ServiceNow Extension for VS Code** — `servicenow.now-vscode` — for syntax-aware editing of GlideRecord code

## 7. What to NOT do

- ❌ Do not store the Gemini API key in a Script Include literal. We use a **system property** (encrypted password type) — Phase 4.
- ❌ Do not paste real production incident data into the free tier — it may be used for model training. Use the demo data generator above, or upgrade to paid tier for production.
- ❌ Do not run the cluster engine on production-scale data without `setLimit()` — the script in this project caps at 5000 rows but tune for your instance.
- ❌ Do not auto-publish drafts. Always route through Knowledge Manager review — the LLM hallucinates ~3% of the time on technical specifics.

## Ready?

When all boxes are ticked, open [implementation.md](implementation.md) and start Phase 1.
