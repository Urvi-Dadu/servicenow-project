/**
 * UI Action: Approve & Publish
 * Table: x_kb_intel_kb_draft
 * Action name: approve_and_publish
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
 * Creates a published kb_knowledge record from this draft, links them, and
 * marks the source cluster (if any) as has_kb.
 */
(function() {
    var targetBase = gs.getProperty('x_kb_intel.target_kb_base');
    if (!targetBase) {
        gs.addErrorMessage('System property x_kb_intel.target_kb_base is not set. Set it to a kb_knowledge_base sys_id and retry.');
        action.setRedirectURL(current);
        return;
    }

    var kb = new GlideRecord('kb_knowledge');
    kb.initialize();
    kb.setValue('short_description', current.getValue('title'));
    kb.setValue('text', current.getValue('body'));
    kb.setValue('article_type', 'text');
    kb.setValue('kb_knowledge_base', targetBase);
    kb.setValue('workflow_state', 'published');
    kb.setValue('valid_to', '2099-12-31');
    var kbId = kb.insert();

    if (!kbId) {
        gs.addErrorMessage('Failed to create kb_knowledge record. Check ACLs and that the target KB base exists.');
        action.setRedirectURL(current);
        return;
    }

    current.setValue('published_kb', kbId);
    current.setValue('review_state', 'published');
    current.setValue('reviewer', gs.getUserID());
    current.update();

    // Link cluster → KB so it shows as covered
    if (!current.source_cluster.nil()) {
        var clusterGr = new GlideRecord('x_kb_intel_cluster');
        if (clusterGr.get(current.getValue('source_cluster'))) {
            clusterGr.setValue('linked_kb', kbId);
            clusterGr.setValue('status', 'has_kb');
            clusterGr.update();
        }
    }

    // Optionally link the source incident as a related-to relationship
    if (!current.source_incident.nil()) {
        var m2m = new GlideRecord('m2m_kb_task');
        m2m.initialize();
        m2m.setValue('task', current.getValue('source_incident'));
        m2m.setValue('kb_knowledge', kbId);
        m2m.insert();
    }

    var newKb = new GlideRecord('kb_knowledge');
    newKb.get(kbId);
    gs.addInfoMessage('Published as KB ' + (newKb.getValue('number') || kbId));
    action.setRedirectURL('kb_knowledge.do?sys_id=' + kbId);
})();
