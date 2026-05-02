/**
 * Business Rule: Story Closure → Dev Capture
 * Table: rm_story
 * When: after
 * Update: true
 * Order: 1000
 * Async: yes
 * Active: yes
 *
 * Filter conditions:
 *   - state changes
 *   - state is "Complete" (state value '4' on rm_story; verify on your instance)
 *
 * On story completion, creates a draft x_1158634_kb_int_0_dev_capture record and
 * notifies the assigned developer to fill out the brief.
 */
(function executeRule(current, previous) {

    // Story state values vary by release. Common: 4 = Complete, 3 = Closed Complete
    // Adjust this list to match your instance.
    var completedStates = ['4', '3', 'closed_complete', 'complete'];
    var newState = current.getValue('state');
    if (completedStates.indexOf(newState) === -1) return;

    // Avoid duplicate capture
    var existing = new GlideRecord('x_1158634_kb_int_0_dev_capture');
    existing.addQuery('source_story', current.getUniqueValue());
    existing.setLimit(1);
    existing.query();
    if (existing.next()) return;

    var capGr = new GlideRecord('x_1158634_kb_int_0_dev_capture');
    capGr.initialize();
    capGr.setValue('source_type', 'story');
    capGr.setValue('source_story', current.getUniqueValue());
    capGr.setValue('developer', current.getValue('assigned_to'));
    capGr.setValue('problem_brief', current.getValue('short_description'));
    capGr.setValue('state', 'draft');
    var sysId = capGr.insert();

    // Notify developer to complete the capture
    gs.eventQueue('x_1158634_kb_int_0.story.capture_request', null, sysId, current.getValue('assigned_to'));

})(current, previous);
