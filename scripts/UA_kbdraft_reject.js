/**
 * UI Action: Reject Draft
 * Table: x_1158634_kb_int_0_kb_draft
 * Action name: reject_draft
 * Form button: true
 * Show insert: false
 * Show update: true
 * Active: true
 * Client: false
 * Roles: knowledge_manager, admin
 *
 * Condition:
 *   current.review_state == 'draft' || current.review_state == 'in_review'
 *
 * Marks the draft as rejected and dismisses the source cluster (if any) so
 * the scheduled job won't regenerate the same draft next week.
 */
(function() {
    current.setValue('review_state', 'rejected');
    current.setValue('reviewer', gs.getUserID());
    current.update();

    if (!current.source_cluster.nil()) {
        var clusterGr = new GlideRecord('x_1158634_kb_int_0_cluster');
        if (clusterGr.get(current.getValue('source_cluster'))) {
            clusterGr.setValue('status', 'dismissed');
            clusterGr.update();
        }
    }

    gs.addInfoMessage('Draft rejected. Source cluster dismissed.');
    action.setRedirectURL(current);
})();
