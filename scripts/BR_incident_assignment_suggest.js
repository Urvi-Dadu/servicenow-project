/**
 * Business Rule: Suggest Resolution on Assignment
 * Table: incident
 * When: after
 * Insert: true, Update: true
 * Order: 1000
 * Async: yes (suggestions can take a few seconds)
 * Active: yes
 *
 * Filter conditions:
 *   - assignment_group changes
 *   - assignment_group is not empty
 *   - state in (1 New, 2 In Progress, 3 On Hold)
 *
 * Calls ResolutionSuggester so the side-panel UI Macro has data to show.
 */
(function executeRule(current, previous /* null when async */) {

    // Skip if cancelled / closed states
    var state = current.getValue('state');
    if (state === '6' || state === '7' || state === '8') return;

    if (!current.assignment_group || current.assignment_group.nil()) return;

    var sysId = current.getUniqueValue();
    try {
        new x_1158634_kb_int_0.ResolutionSuggester().suggestForIncident(sysId);
    } catch (e) {
        gs.error('BR_incident_assignment_suggest: ' + e.message);
    }

})(current, previous);
