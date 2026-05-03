/**
 * Script Include: KBDraftBuilder
 * Application: KB Intelligence (x_1158634_kb_int_0)
 * Accessible from: This application scope only
 * Active: true
 *
 * Builds a draft KB article (x_1158634_kb_int_0_kb_draft) by calling Gemini with
 * either:
 *   1. A cluster of similar incidents → buildFromCluster(clusterSysId)
 *   2. A developer's structured capture → buildFromDevCapture(captureSysId)
 *
 * For dev captures sourced from a story, automatically pulls DevOps commit
 * context if the ServiceNow DevOps plugin is active.
 */
var KBDraftBuilder = Class.create();
KBDraftBuilder.prototype = {
    initialize: function() {
        this.llm = new x_1158634_kb_int_0.LLMConnector();
        this.storyModel = gs.getProperty('x_1158634_kb_int_0.story_model', 'gemini-2.5-pro');
    },

    // ============================================================
    // Public: build draft from incident cluster
    // ============================================================
    buildFromCluster: function(clusterSysId) {
        var clusterGr = new GlideRecord('x_1158634_kb_int_0_cluster');
        if (!clusterGr.get(clusterSysId)) {
            gs.error('KBDraftBuilder: cluster not found ' + clusterSysId);
            return null;
        }

        var incidents = this._fetchTopIncidents(clusterGr, 5);
        if (incidents.length === 0) {
            gs.warn('KBDraftBuilder: no incidents found for cluster ' + clusterSysId);
            return null;
        }

        var systemPrompt = this._systemPromptCluster();
        var userPrompt = this._userPromptCluster(clusterGr, incidents);

        var result = this.llm.callGemini(systemPrompt, userPrompt, { maxTokens: 3000, enforceJson: true });
        if (!result) return null;

        var parsed = this._parseLLMArticle(result.text);

        var draftGr = new GlideRecord('x_1158634_kb_int_0_kb_draft');
        draftGr.initialize();
        draftGr.setValue('title', parsed.title);
        draftGr.setValue('summary', parsed.summary);
        draftGr.setValue('body', parsed.body);
        draftGr.setValue('source_type', 'incident_cluster');
        draftGr.setValue('source_cluster', clusterSysId);
        draftGr.setValue('review_state', 'draft');
        draftGr.setValue('llm_model_used', result.model);
        draftGr.setValue('llm_tokens_in', result.tokensIn);
        draftGr.setValue('llm_tokens_out', result.tokensOut);
        draftGr.setValue('generated_at', new GlideDateTime());
        var sysId = draftGr.insert();

        clusterGr.setValue('status', 'draft_pending');
        clusterGr.update();

        gs.eventQueue('x_1158634_kb_int_0.draft.created', null, sysId, 'cluster');
        return sysId;
    },

    // ============================================================
    // Public: build draft from developer capture
    // ============================================================
    buildFromDevCapture: function(captureSysId) {
        var capGr = new GlideRecord('x_1158634_kb_int_0_developer_capture');
        if (!capGr.get(captureSysId)) {
            gs.error('KBDraftBuilder: dev capture not found ' + captureSysId);
            return null;
        }

        var sourceType = capGr.getValue('source_type');
        var devOpsCommits = [];
        if (sourceType === 'story' && !capGr.source_story.nil()) {
            try {
                devOpsCommits = new x_1158634_kb_int_0.DevOpsContextFetcher().fetchForStory(capGr.getValue('source_story'));
            } catch (e) {
                // DevOps plugin may be absent — silent
            }
        }

        var systemPrompt = this._systemPromptDevCapture();
        var userPrompt = this._userPromptDevCapture(capGr, devOpsCommits);

        // Story KBs use the higher-quality model
        var modelOverride = (sourceType === 'story') ? this.storyModel : null;
        var llmOpts = { maxTokens: 4096, enforceJson: true };
        if (modelOverride) llmOpts.model = modelOverride;

        var result = this.llm.callGemini(systemPrompt, userPrompt, llmOpts);
        if (!result) return null;

        var parsed = this._parseLLMArticle(result.text);

        var draftGr = new GlideRecord('x_1158634_kb_int_0_kb_draft');
        draftGr.initialize();
        draftGr.setValue('title', parsed.title);
        draftGr.setValue('summary', parsed.summary);
        draftGr.setValue('body', parsed.body);
        draftGr.setValue('source_type', sourceType === 'story' ? 'story' : 'dev_capture');
        draftGr.setValue('source_dev_capture', capGr.getUniqueValue());
        if (!capGr.source_story.nil())    draftGr.setValue('source_story', capGr.getValue('source_story'));
        if (!capGr.source_incident.nil()) draftGr.setValue('source_incident', capGr.getValue('source_incident'));
        draftGr.setValue('resolver', capGr.getValue('developer'));
        draftGr.setValue('review_state', 'draft');
        draftGr.setValue('llm_model_used', result.model);
        draftGr.setValue('llm_tokens_in', result.tokensIn);
        draftGr.setValue('llm_tokens_out', result.tokensOut);
        draftGr.setValue('generated_at', new GlideDateTime());
        var sysId = draftGr.insert();

        capGr.setValue('generated_draft', sysId);
        capGr.setValue('state', 'processed');
        capGr.update();

        gs.eventQueue('x_1158634_kb_int_0.draft.created', null, sysId, sourceType === 'story' ? 'story' : 'dev_capture');
        return sysId;
    },

    // ============================================================
    // Private helpers
    // ============================================================
    _fetchTopIncidents: function(clusterGr, limit) {
        var members = [];
        var clusterName = clusterGr.getValue('name');

        // For PI clustering: re-run prediction to find members of this label.
        // For simplicity we look up by representative + same-category recent incidents.
        var seen = {};

        // Step 1: include the representative
        var repId = clusterGr.getValue('representative_incident');
        if (repId) {
            var rep = new GlideRecord('incident');
            if (rep.get(repId)) {
                members.push(this._incidentToObj(rep));
                seen[repId] = true;
            }
        }

        // Step 2: pad with similar by category + keyword from cluster summary
        var summary = (clusterGr.getValue('summary') || '').split('|')[0].trim();
        var keyword = summary.split(/\s+/).filter(function(w) { return w.length > 4; })[0] || '';

        var gr = new GlideRecord('incident');
        gr.addQuery('state', 'IN', '6,7');
        gr.addNotNullQuery('close_notes');
        if (keyword) gr.addQuery('short_description', 'CONTAINS', keyword);
        gr.orderByDesc('sys_updated_on');
        gr.setLimit(limit * 3);
        gr.query();

        while (gr.next() && members.length < limit) {
            var id = gr.getUniqueValue();
            if (seen[id]) continue;
            members.push(this._incidentToObj(gr));
            seen[id] = true;
        }

        return members;
    },

    _incidentToObj: function(gr) {
        return {
            number: gr.getValue('number'),
            short: gr.getValue('short_description') || '',
            description: (gr.getValue('description') || '').substring(0, 800),
            resolution: (gr.getValue('close_notes') || '').substring(0, 1500),
            category: gr.getValue('category') || ''
        };
    },

    _parseLLMArticle: function(text) {
        // Gemini in JSON mode returns clean JSON. But guard against edge cases.
        try {
            var json = JSON.parse(text);
            return {
                title:   (json.title   || 'Untitled').toString().substring(0, 200),
                summary: (json.summary || '').toString().substring(0, 1000),
                body:    (json.body_html || json.body || '').toString()
            };
        } catch (e) {
            // Fallback: pull JSON from anywhere in the response
            var s = text.indexOf('{');
            var eIdx = text.lastIndexOf('}');
            if (s >= 0 && eIdx > s) {
                try {
                    var json2 = JSON.parse(text.substring(s, eIdx + 1));
                    return {
                        title:   (json2.title   || 'Untitled').toString().substring(0, 200),
                        summary: (json2.summary || '').toString().substring(0, 1000),
                        body:    (json2.body_html || json2.body || '').toString()
                    };
                } catch (e2) { /* fall through */ }
            }
            return {
                title: 'KB Draft (parse failed)',
                summary: text.substring(0, 500),
                body: '<p>' + GlideStringUtil.escapeHTML(text) + '</p>'
            };
        }
    },

    // ============================================================
    // Prompts
    // ============================================================
    _systemPromptCluster: function() {
        return [
            'You are an expert ITSM Knowledge Management author writing for Tier 2 and Tier 3 support engineers. Your audience is technical: they read scripts, read logs, edit configurations. They do not need definitions of basic terms; they need precise, actionable guidance.',
            '',
            'You produce KB articles from clusters of similar resolved incidents. Your job is to identify the underlying recurring issue and write a single canonical article a Tier 2/3 engineer can follow on the next occurrence.',
            '',
            'OUTPUT REQUIREMENTS:',
            '- Return ONLY valid JSON matching the response schema (title, summary, body_html).',
            '- body_html uses ONLY: <h2>, <h3>, <p>, <ul>, <ol>, <li>, <pre>, <code>, <strong>, <em>. No <html>, <body>, <script>, <style>, <a>, <img>, <table>.',
            '- body_html MUST contain these <h2> sections in this exact order:',
            '   1. Overview',
            '   2. Symptoms',
            '   3. Likely Root Causes',
            '   4. Diagnostic Steps',
            '   5. Resolution Steps  (must be an <ol> of numbered, imperative sentences)',
            '   6. Validation',
            '   7. Related Items',
            '- Preserve commands, queries, file paths, system properties verbatim in <pre><code>.',
            '- Do not invent facts. If a section has no source material, say "(no data in source incidents — engineer to supplement)".',
            '- Title: short imperative or descriptive line, max 12 words.',
            '- Summary: one sentence, max 30 words, suitable for KB search results.'
        ].join('\n');
    },

    _userPromptCluster: function(clusterGr, incidents) {
        var lines = [];
        lines.push('Write a KB article from this cluster of similar resolved incidents.');
        lines.push('');
        lines.push('CLUSTER METADATA');
        lines.push('- Cluster summary: ' + (clusterGr.getValue('summary') || '(none)'));
        lines.push('- Member count: ' + clusterGr.getValue('member_count'));
        lines.push('- Average resolution time: ' + (clusterGr.getValue('avg_resolution_minutes') || 'unknown') + ' minutes');
        var grpDisplay = clusterGr.top_assignment_group.getDisplayValue();
        lines.push('- Top assignment group: ' + (grpDisplay || 'unknown'));
        lines.push('');
        lines.push('SAMPLE INCIDENTS (top ' + incidents.length + ')');
        incidents.forEach(function(i) {
            lines.push('--- INCIDENT ' + i.number + ' ---');
            lines.push('Short description: ' + i.short);
            lines.push('Description: ' + i.description);
            lines.push('Category: ' + i.category);
            lines.push('Resolution notes: ' + i.resolution);
            lines.push('');
        });
        lines.push('Identify the underlying recurring issue across these incidents. Write a single canonical KB article a Tier 2/3 engineer can follow on the next occurrence. Be specific about commands, queries, scripts, configuration paths if mentioned in resolution notes. Preserve exact identifiers verbatim.');
        return lines.join('\n');
    },

    _systemPromptDevCapture: function() {
        return [
            'You are an expert technical writer producing KB articles from developer post-resolution captures. The audience is L2/L3 engineers and future developers who will encounter the same problem or build on the same workflow. They are technical; do not over-explain basics.',
            '',
            'OUTPUT REQUIREMENTS:',
            '- Return ONLY valid JSON matching the response schema (title, summary, body_html).',
            '- body_html uses ONLY: <h2>, <h3>, <p>, <ul>, <ol>, <li>, <pre>, <code>, <strong>, <em>.',
            '- body_html MUST contain these sections in this exact order. Sections marked REQUIRED always appear; others appear only when source data exists for them:',
            '   - <h2>Context & Symptom</h2>            (REQUIRED — what triggered this work, the user/business symptom)',
            '   - <h2>Root Cause / Why This Was Needed</h2>  (REQUIRED — why this happened OR why this fix/feature was required)',
            '   - <h2>Resolution Walkthrough</h2>        (REQUIRED — numbered <ol>, imperative steps a future engineer will follow)',
            '   - <h2>Workflow Changes</h2>              (only if developer reports workflow_changed=true; name the workflow, name the activity, describe the change)',
            '   - <h2>Script / Code Changes</h2>         (only if scripts_changed=true; for each script: name it, say what function/method/business rule, show the change in <pre><code>; if before/after, label as <h3>Before</h3> and <h3>After</h3>)',
            '   - <h2>Configuration Changes</h2>         (only if configs_changed=true; list each: system property name, table/field, ACL, etc.)',
            '   - <h2>Validation Steps</h2>              (REQUIRED — how a future engineer verifies the fix is in place / works)',
            '   - <h2>Rollback / Watch-outs</h2>         (REQUIRED — how to revert; risks; things that could re-break this)',
            '   - <h2>Related Items</h2>                 (story number, incident number, commit hashes, related KBs — plain text since <a> not allowed)',
            '',
            'CRITICAL RULES:',
            '- Use the developer\'s exact terminology. If they wrote "BR_assign_to_oncall" — that is the script name, do NOT paraphrase.',
            '- Where a REQUIRED section\'s source is sparse, write what is deducible plus a "(developer to confirm)" marker.',
            '- NEVER invent script names, table names, system property names, or commit hashes that are not in the input.',
            '- Code snippets go in <pre><code>. Inline names go in <code>.',
            '- Title: imperative or descriptive, max 12 words. Summary: one sentence, max 30 words.'
        ].join('\n');
    },

    _userPromptDevCapture: function(capGr, devOpsCommits) {
        var lines = [];
        lines.push('Generate a KB article from this developer\'s brief capture.');
        lines.push('');
        lines.push('SOURCE');
        lines.push('- Source type: ' + capGr.getValue('source_type'));

        if (!capGr.source_story.nil()) {
            var storyGr = new GlideRecord('rm_story');
            if (storyGr.get(capGr.getValue('source_story'))) {
                lines.push('- Story: ' + storyGr.getValue('number') + ' — ' + storyGr.getValue('short_description'));
                lines.push('- Acceptance criteria: ' + (storyGr.getValue('acceptance_criteria') || '(none)'));
            }
        }
        if (!capGr.source_incident.nil()) {
            var incGr = new GlideRecord('incident');
            if (incGr.get(capGr.getValue('source_incident'))) {
                lines.push('- Incident: ' + incGr.getValue('number') + ' — ' + incGr.getValue('short_description'));
                lines.push('- Category: ' + (incGr.getValue('category') || ''));
            }
        }
        lines.push('- Developer: ' + capGr.developer.getDisplayValue());
        lines.push('');

        lines.push('PROBLEM BRIEF (developer\'s words)');
        lines.push(capGr.getValue('problem_brief') || '(empty)');
        lines.push('');
        lines.push('WHAT THE DEVELOPER DID (developer\'s words)');
        lines.push(capGr.getValue('resolution_brief') || '(empty)');
        lines.push('');
        lines.push('ROOT CAUSE (developer\'s words)');
        lines.push(capGr.getValue('root_cause') || '(empty)');
        lines.push('');

        var workflowYN = capGr.getValue('workflow_changed') === '1' || capGr.getValue('workflow_changed') === 'true';
        lines.push('WORKFLOW CHANGES: ' + (workflowYN ? 'yes' : 'no'));
        if (workflowYN) {
            lines.push('Details: ' + (capGr.getValue('workflow_details') || '(empty)'));
        }
        lines.push('');

        var scriptsYN = capGr.getValue('scripts_changed') === '1' || capGr.getValue('scripts_changed') === 'true';
        lines.push('SCRIPT / CODE CHANGES: ' + (scriptsYN ? 'yes' : 'no'));
        if (scriptsYN) {
            lines.push('Details: ' + (capGr.getValue('script_details') || '(empty)'));
        }
        lines.push('');

        var configsYN = capGr.getValue('configs_changed') === '1' || capGr.getValue('configs_changed') === 'true';
        lines.push('CONFIG CHANGES: ' + (configsYN ? 'yes' : 'no'));
        if (configsYN) {
            lines.push('Details: ' + (capGr.getValue('config_details') || '(empty)'));
        }
        lines.push('');

        lines.push('VALIDATION STEPS PERFORMED');
        lines.push(capGr.getValue('validation_steps') || '(empty)');
        lines.push('');
        lines.push('RELATED ITEMS');
        lines.push(capGr.getValue('related_items') || '(none)');
        lines.push('');

        if (devOpsCommits && devOpsCommits.length > 0) {
            lines.push('COMMIT CONTEXT (auto-fetched from ServiceNow DevOps integration)');
            devOpsCommits.forEach(function(c) {
                lines.push('- ' + c.hash + ' by ' + c.author + ': ' + c.message);
                if (c.files) lines.push('  Files: ' + c.files);
            });
            lines.push('');
        }

        lines.push('Produce the KB article per the system prompt rules. Use the developer\'s exact identifiers (script names, workflow names, system properties, table names) verbatim.');
        return lines.join('\n');
    },

    type: 'KBDraftBuilder'
};
