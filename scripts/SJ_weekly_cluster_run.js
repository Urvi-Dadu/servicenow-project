/**
 * Scheduled Script Execution: Weekly Incident Cluster Run
 * Run: weekly, Sunday 02:00
 * Active: true
 *
 * 1. Re-runs IncidentClusterEngine to refresh clusters from latest incidents.
 * 2. For each cluster with status='open' and member_count >= min, generates
 *    a draft via KBDraftBuilder. Skips clusters that already have a non-rejected
 *    draft.
 * 3. Inserts a 5-second pause between LLM calls to stay under Gemini's
 *    free-tier rate limit (15 RPM).
 */
(function() {
    var minSize = parseInt(gs.getProperty('x_kb_intel.min_cluster_size', '5'), 10);

    gs.info('SJ_weekly_cluster_run: starting cluster refresh');
    var engine = new x_kb_intel.IncidentClusterEngine();
    var n = engine.runClustering();
    gs.info('SJ_weekly_cluster_run: ' + n + ' clusters refreshed');

    var builder = new x_kb_intel.KBDraftBuilder();
    var generated = 0;

    var gapGr = new GlideRecord('x_kb_intel_cluster');
    gapGr.addQuery('status', 'open');
    gapGr.addQuery('member_count', '>=', minSize);
    gapGr.orderByDesc('member_count'); // tackle biggest gaps first
    gapGr.setLimit(50); // safety cap per run
    gapGr.query();

    while (gapGr.next()) {
        // Skip if a non-rejected draft already exists
        var existing = new GlideRecord('x_kb_intel_kb_draft');
        existing.addQuery('source_cluster', gapGr.getUniqueValue());
        existing.addQuery('review_state', 'IN', 'draft,in_review,approved,published');
        existing.setLimit(1);
        existing.query();
        if (existing.next()) continue;

        try {
            var draftId = builder.buildFromCluster(gapGr.getUniqueValue());
            if (draftId) generated++;
        } catch (e) {
            gs.error('SJ_weekly_cluster_run: ' + e.message);
        }

        // Stay under free-tier 15 RPM (1 request every 4s would be safe; 5s for margin)
        gs.sleep(5000);
    }

    gs.info('SJ_weekly_cluster_run: generated ' + generated + ' new drafts');
})();
