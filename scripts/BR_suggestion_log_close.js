/**
 * Business Rule: Update Suggestion Log on Incident Close
 * Table: incident
 * When: after
 * Update: true
 * Order: 2000
 * Async: yes
 * Active: yes
 *
 * Filter conditions:
 *   - state changes to 6 (resolved) or 7 (closed)
 *
 * Updates the most recent suggestion log row for this incident with the
 * resolution time so PA dashboards can compute "MTTR with vs without
 * suggestions accepted."
 */
(function executeRule(current, previous) {

    var newState = current.getValue('state');
    if (newState !== '6' && newState !== '7') return;
    if (previous && (previous.getValue('state') === '6' || previous.getValue('state') === '7')) return;

    var logGr = new GlideRecord('x_kb_intel_suggestion_log');
    logGr.addQuery('incident', current.getUniqueValue());
    logGr.orderByDesc('suggested_at');
    logGr.setLimit(1);
    logGr.query();
    if (!logGr.next()) return;

    var opened = current.getValue('opened_at');
    var resolved = current.getValue('resolved_at') || current.getValue('closed_at');
    if (opened && resolved) {
        var diffMin = Math.floor(
            ((new GlideDateTime(resolved)).getNumericValue() - (new GlideDateTime(opened)).getNumericValue()) / 60000
        );
        logGr.setValue('resolution_minutes', diffMin);
    }
    logGr.setValue('resolver', current.getValue('resolved_by') || current.getValue('closed_by'));
    logGr.update();

})(current, previous);
