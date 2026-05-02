/**
 * Business Rule: Dev Capture Submitted → Generate Draft
 * Table: x_1158634_kb_int_0_dev_capture
 * When: after
 * Update: true
 * Order: 1000
 * Async: yes (LLM call may take 10–30s)
 * Active: yes
 *
 * Filter conditions:
 *   - state changes to "submitted"
 *
 * Invokes KBDraftBuilder.buildFromDevCapture(). On success, the capture's
 * generated_draft field is set and state moves to "processed".
 */
(function executeRule(current, previous) {

    if (current.getValue('state') !== 'submitted') return;
    if (previous && previous.getValue('state') === 'submitted') return; // already handled

    try {
        var draftId = new x_1158634_kb_int_0.KBDraftBuilder().buildFromDevCapture(current.getUniqueValue());
        if (!draftId) {
            gs.warn('BR_devcapture_submitted: build returned null for ' + current.getUniqueValue());
            // Bounce back so the user can retry
            current.setValue('state', 'draft');
            current.update();
        }
    } catch (e) {
        gs.error('BR_devcapture_submitted: ' + e.message);
        current.setValue('state', 'draft');
        current.update();
    }

})(current, previous);
