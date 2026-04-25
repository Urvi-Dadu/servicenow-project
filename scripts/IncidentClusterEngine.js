/**
 * Script Include: IncidentClusterEngine
 * Application: KB Intelligence (x_kb_intel)
 * Accessible from: This application scope only
 * Active: true
 *
 * Groups closed incidents into clusters of similar issues.
 *
 * Primary path: Predictive Intelligence Cluster Solution (configured by name in
 *               system property x_kb_intel.cluster_solution_name).
 * Fallback path: Keyword + category-based grouping in pure JS — runs if PI
 *                solution is missing or fails. Less accurate but always works.
 *
 * USAGE:
 *   var engine = new x_kb_intel.IncidentClusterEngine();
 *   engine.runClustering();   // upserts rows in x_kb_intel_cluster
 */
var IncidentClusterEngine = Class.create();
IncidentClusterEngine.prototype = {
    initialize: function() {
        this.solutionName = gs.getProperty('x_kb_intel.cluster_solution_name', 'incident_cluster_l2l3');
        this.minClusterSize = parseInt(gs.getProperty('x_kb_intel.min_cluster_size', '5'), 10);
        this.lookbackDays = parseInt(gs.getProperty('x_kb_intel.lookback_days', '365'), 10);
    },

    runClustering: function() {
        var clusters = this._tryPredictiveIntelligence();
        if (!clusters) {
            gs.info('IncidentClusterEngine: PI not available, using keyword fallback');
            clusters = this._keywordFallback();
        }

        var updated = 0;
        for (var label in clusters) {
            var members = clusters[label];
            if (members.ids.length < this.minClusterSize) continue;
            this._upsertCluster(label, members);
            updated++;
        }
        gs.info('IncidentClusterEngine: ' + updated + ' clusters upserted');
        return updated;
    },

    _tryPredictiveIntelligence: function() {
        var solution, version;
        try {
            solution = sn_ml.SolutionStore.getSolution(this.solutionName);
            if (!solution) return null;
            version = solution.findActiveVersion();
            if (!version) return null;
        } catch (e) {
            return null;
        }

        var clusterMap = {};
        var gr = new GlideRecord('incident');
        gr.addQuery('state', 'IN', '6,7'); // resolved, closed
        gr.addNotNullQuery('close_notes');
        gr.addQuery('sys_updated_on', '>=', this._daysAgoISO(this.lookbackDays));
        gr.setLimit(5000);
        gr.query();

        while (gr.next()) {
            var prediction;
            try {
                var output = version.predict([gr]);
                if (!output || output.length === 0) continue;
                prediction = output[0].getPrediction ? output[0].getPrediction() : null;
            } catch (e) {
                continue;
            }
            if (!prediction) continue;

            if (!clusterMap[prediction]) {
                clusterMap[prediction] = { ids: [], shortDescs: [] };
            }
            clusterMap[prediction].ids.push(gr.getUniqueValue());
            clusterMap[prediction].shortDescs.push(gr.getValue('short_description'));
        }

        return Object.keys(clusterMap).length > 0 ? clusterMap : null;
    },

    _keywordFallback: function() {
        // Simple grouping: bucket by category + first 2 significant words
        var clusterMap = {};
        var stopWords = { 'the': 1, 'a': 1, 'an': 1, 'and': 1, 'or': 1, 'is': 1, 'in': 1, 'to': 1, 'of': 1, 'for': 1, 'on': 1, 'with': 1, 'cannot': 1, 'cant': 1, 'not': 1 };

        var gr = new GlideRecord('incident');
        gr.addQuery('state', 'IN', '6,7');
        gr.addNotNullQuery('close_notes');
        gr.addQuery('sys_updated_on', '>=', this._daysAgoISO(this.lookbackDays));
        gr.setLimit(5000);
        gr.query();

        while (gr.next()) {
            var sd = (gr.getValue('short_description') || '').toLowerCase();
            var tokens = sd.replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(function(t) {
                return t.length > 2 && !stopWords[t];
            });
            if (tokens.length < 2) continue;
            var key = (gr.getValue('category') || 'misc') + '::' + tokens.slice(0, 2).sort().join('_');
            if (!clusterMap[key]) clusterMap[key] = { ids: [], shortDescs: [] };
            clusterMap[key].ids.push(gr.getUniqueValue());
            clusterMap[key].shortDescs.push(gr.getValue('short_description'));
        }

        return clusterMap;
    },

    _upsertCluster: function(label, members) {
        var clusterGr = new GlideRecord('x_kb_intel_cluster');
        clusterGr.addQuery('name', label);
        clusterGr.query();
        var isNew = !clusterGr.next();
        if (isNew) {
            clusterGr.initialize();
            clusterGr.setValue('name', label);
            clusterGr.setValue('status', 'open');
        }

        clusterGr.setValue('summary', members.shortDescs.slice(0, 3).join(' | '));
        clusterGr.setValue('member_count', members.ids.length);
        clusterGr.setValue('last_seen', new GlideDateTime());
        clusterGr.setValue('representative_incident', members.ids[0]);

        // Compute aggregate metrics
        var sumMin = 0, countMin = 0;
        var groupCount = {};
        for (var i = 0; i < members.ids.length; i++) {
            var incGr = new GlideRecord('incident');
            if (incGr.get(members.ids[i])) {
                var opened = incGr.getValue('opened_at');
                var resolved = incGr.getValue('resolved_at');
                if (opened && resolved) {
                    var diff = (new GlideDateTime(resolved)).getNumericValue() - (new GlideDateTime(opened)).getNumericValue();
                    if (diff > 0) {
                        sumMin += Math.floor(diff / 60000);
                        countMin++;
                    }
                }
                var ag = incGr.getValue('assignment_group');
                if (ag) groupCount[ag] = (groupCount[ag] || 0) + 1;
            }
        }
        if (countMin > 0) clusterGr.setValue('avg_resolution_minutes', Math.floor(sumMin / countMin));
        var topGroup = null, topCount = 0;
        for (var g in groupCount) {
            if (groupCount[g] > topCount) { topCount = groupCount[g]; topGroup = g; }
        }
        if (topGroup) clusterGr.setValue('top_assignment_group', topGroup);

        // Check if any cluster member already has a linked KB
        var linkedKb = this._findLinkedKb(members.ids);
        if (linkedKb && clusterGr.getValue('status') !== 'has_kb') {
            clusterGr.setValue('linked_kb', linkedKb);
            clusterGr.setValue('status', 'has_kb');
        }

        clusterGr.update();
    },

    _findLinkedKb: function(ids) {
        var m2m = new GlideRecord('m2m_kb_task');
        m2m.addQuery('task', 'IN', ids.join(','));
        m2m.setLimit(1);
        m2m.query();
        if (m2m.next()) return m2m.getValue('kb_knowledge');
        return null;
    },

    _daysAgoISO: function(days) {
        var gdt = new GlideDateTime();
        gdt.addDaysLocalTime(-days);
        return gdt.getValue();
    },

    type: 'IncidentClusterEngine'
};
