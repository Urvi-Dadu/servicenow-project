/**
 * Script Include: ResolutionSuggester
 * Application: KB Intelligence (x_1158634_kb_int_0)
 * Accessible from: All application scopes
 * Active: true
 *
 * Given a new/in-progress incident, finds top-N similar resolved incidents
 * and any KB articles linked to them. Used by:
 *   - BR_incident_assignment_suggest (auto-trigger on assignment)
 *   - x_1158634_kb_int_0_suggestions UI Macro (renders side panel on form)
 *
 * Primary path:  Predictive Intelligence Similarity Solution
 * Fallback path: keyword-based GlideRecord query (always works)
 *
 * Logs every call to x_1158634_kb_int_0_suggestion_log for measurement.
 */
var ResolutionSuggester = Class.create();
ResolutionSuggester.prototype = {
    initialize: function() {
        this.solutionName = gs.getProperty('x_1158634_kb_int_0.similarity_solution_name', 'incident_similarity_l2l3');
        this.topN = parseInt(gs.getProperty('x_1158634_kb_int_0.suggestion_top_n', '3'), 10);
    },

    /**
     * @param {string} incidentSysId
     * @returns {Array<object>} list of { incident_sys_id, incident_number, short_description, close_notes, score, kb_sys_id }
     */
    suggestForIncident: function(incidentSysId) {
        var incGr = new GlideRecord('incident');
        if (!incGr.get(incidentSysId)) return [];

        var results = this._tryPredictiveIntelligence(incGr);
        if (!results || results.length === 0) {
            results = this._keywordFallback(incGr);
        }

        // Log for measurement (always, even empty)
        var logGr = new GlideRecord('x_1158634_kb_int_0_suggestion_log');
        logGr.initialize();
        logGr.setValue('incident', incidentSysId);
        logGr.setValue('suggested_kbs', JSON.stringify(results));
        logGr.setValue('suggested_at', new GlideDateTime());
        logGr.insert();

        return results;
    },

    _tryPredictiveIntelligence: function(incGr) {
        var solution, version;
        try {
            solution = sn_ml.SolutionStore.getSolution(this.solutionName);
            if (!solution) return null;
            version = solution.findActiveVersion();
            if (!version) return null;
        } catch (e) {
            return null;
        }

        var results = [];
        try {
            var output = version.predict([incGr]);
            if (!output || output.length === 0) return null;
            var simResult = output[0];
            // API surface varies — try common methods
            var sims = [];
            if (typeof simResult.getSimilarRecords === 'function') {
                sims = simResult.getSimilarRecords();
            } else if (typeof simResult.getTopPredictions === 'function') {
                sims = simResult.getTopPredictions(this.topN * 3);
            }
            for (var i = 0; i < sims.length && results.length < this.topN; i++) {
                var s = sims[i];
                var simId = (typeof s.getSysId === 'function') ? s.getSysId() : (typeof s.getValue === 'function' ? s.getValue() : null);
                var score = (typeof s.getScore === 'function') ? s.getScore() : (typeof s.getProbability === 'function' ? s.getProbability() : 0);
                if (!simId || simId === incGr.getUniqueValue()) continue;

                var sg = new GlideRecord('incident');
                if (!sg.get(simId)) continue;
                if (sg.getValue('state') !== '6' && sg.getValue('state') !== '7') continue;
                if (!sg.getValue('close_notes')) continue;

                results.push(this._formatSuggestion(sg, score));
            }
        } catch (e) {
            return null;
        }
        return results;
    },

    _keywordFallback: function(incGr) {
        var results = [];
        var seen = {};
        seen[incGr.getUniqueValue()] = true;

        var sd = (incGr.getValue('short_description') || '').toLowerCase();
        var stopWords = { 'the': 1, 'a': 1, 'an': 1, 'and': 1, 'or': 1, 'is': 1, 'in': 1, 'to': 1, 'of': 1, 'for': 1, 'on': 1, 'with': 1, 'cannot': 1, 'cant': 1, 'not': 1 };
        var keywords = sd.replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(function(t) {
            return t.length > 3 && !stopWords[t];
        }).slice(0, 3);

        // Try increasingly broad queries
        var attempts = [
            { strict: true, terms: keywords.slice(0, 3) },
            { strict: false, terms: keywords.slice(0, 2) },
            { strict: false, terms: keywords.slice(0, 1) }
        ];

        for (var a = 0; a < attempts.length && results.length < this.topN; a++) {
            var att = attempts[a];
            if (att.terms.length === 0) continue;

            var gr = new GlideRecord('incident');
            gr.addQuery('state', 'IN', '6,7');
            gr.addNotNullQuery('close_notes');
            if (incGr.getValue('category')) gr.addQuery('category', incGr.getValue('category'));
            att.terms.forEach(function(t) {
                gr.addQuery('short_description', 'CONTAINS', t);
            });
            gr.orderByDesc('sys_updated_on');
            gr.setLimit(this.topN * 2);
            gr.query();

            while (gr.next() && results.length < this.topN) {
                var id = gr.getUniqueValue();
                if (seen[id]) continue;
                seen[id] = true;
                var score = att.strict ? 0.75 : (att.terms.length === 2 ? 0.5 : 0.3);
                results.push(this._formatSuggestion(gr, score));
            }
        }
        return results;
    },

    _formatSuggestion: function(sg, score) {
        return {
            incident_sys_id: sg.getUniqueValue(),
            incident_number: sg.getValue('number'),
            short_description: sg.getValue('short_description'),
            close_notes: (sg.getValue('close_notes') || '').substring(0, 600),
            score: Math.round((score || 0) * 100) / 100,
            kb_sys_id: this._linkedKb(sg.getUniqueValue()) || ''
        };
    },

    _linkedKb: function(incidentSysId) {
        var m2m = new GlideRecord('m2m_kb_task');
        m2m.addQuery('task', incidentSysId);
        m2m.setLimit(1);
        m2m.query();
        if (m2m.next()) return m2m.getValue('kb_knowledge');
        return null;
    },

    type: 'ResolutionSuggester'
};
