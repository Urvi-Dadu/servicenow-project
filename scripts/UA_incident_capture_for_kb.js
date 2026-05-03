/**
 * UI Action: Capture for KB
 * Table: incident
 * Action name: capture_for_kb
 * Form button: true
 * Show insert: false
 * Show update: true
 * Active: true
 * Client: false
 *
 * Condition (in the "Condition" field):
 *   current.state == 6 || current.state == 7
 *
 * Creates a draft x_1158634_kb_int_0_developer_capture pre-filled with incident data and
 * redirects the user to fill in the structured brief.
 */
(function() {
    var capGr = new GlideRecord('x_1158634_kb_int_0_developer_capture');

    // Avoid duplicate capture for the same incident
    var existing = new GlideRecord('x_1158634_kb_int_0_developer_capture');
    existing.addQuery('source_incident', current.getUniqueValue());
    existing.setLimit(1);
    existing.query();
    if (existing.next()) {
        gs.addInfoMessage('A capture already exists for this incident — opening it.');
        action.setRedirectURL('x_1158634_kb_int_0_developer_capture.do?sys_id=' + existing.getUniqueValue());
        return;
    }

    capGr.initialize();
    capGr.setValue('source_type', 'incident');
    capGr.setValue('source_incident', current.getUniqueValue());
    capGr.setValue('developer', gs.getUserID());
    capGr.setValue('problem_brief', current.getValue('short_description'));
    capGr.setValue('resolution_brief', current.getValue('close_notes') || '');
    capGr.setValue('state', 'draft');
    var sysId = capGr.insert();

    action.setRedirectURL('x_1158634_kb_int_0_developer_capture.do?sys_id=' + sysId);
})();
