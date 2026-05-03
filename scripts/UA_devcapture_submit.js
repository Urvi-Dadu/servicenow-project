/**
 * UI Action: Submit for KB Generation
 * Table: x_1158634_kb_int_0_developer_capture
 * Action name: submit_for_kb_generation
 * Form button: true
 * Show insert: false
 * Show update: true
 * Active: true
 * Client: false
 *
 * Condition:
 *   current.state == 'draft'
 *
 * Validates required fields, sets state to 'submitted', and lets the
 * BR_devcapture_submitted business rule pick it up asynchronously.
 */
(function() {
    if (!current.problem_brief || current.problem_brief.toString().trim().length < 10) {
        gs.addErrorMessage('Please write at least a 10-character problem brief before submitting.');
        action.setRedirectURL(current);
        return;
    }
    if (!current.resolution_brief || current.resolution_brief.toString().trim().length < 10) {
        gs.addErrorMessage('Please write at least a 10-character resolution brief — this is the most important field.');
        action.setRedirectURL(current);
        return;
    }

    current.setValue('state', 'submitted');
    current.update();

    gs.addInfoMessage('KB draft is being generated. You will receive an email when it is ready for Knowledge Manager review.');
    action.setRedirectURL(current);
})();
