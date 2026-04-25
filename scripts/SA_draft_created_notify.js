/**
 * Script Action: KB Draft Created Notification
 * Event name: x_kb_intel.draft.created
 * Active: true
 *
 * Triggered by KBDraftBuilder when a new draft is inserted.
 * Sends a notification to the Knowledge Manager group.
 *
 * Expected event params:
 *   parm1 = draft sys_id
 *   parm2 = source kind ('cluster' | 'story' | 'dev_capture')
 */
(function executeAction(event) {
    var draftId = event.parm1 + '';
    var kind = event.parm2 + '';

    var draftGr = new GlideRecord('x_kb_intel_kb_draft');
    if (!draftGr.get(draftId)) return;

    var groupSysId = gs.getProperty('x_kb_intel.knowledge_manager_group');
    if (!groupSysId) {
        gs.warn('SA_draft_created_notify: x_kb_intel.knowledge_manager_group not set — skipping notification');
        return;
    }

    // Pull all members of the KM group and email them
    var grp = new GlideRecord('sys_user_grmember');
    grp.addQuery('group', groupSysId);
    grp.query();

    var emails = [];
    while (grp.next()) {
        var u = new GlideRecord('sys_user');
        if (u.get(grp.getValue('user')) && u.getValue('email')) {
            emails.push(u.getValue('email'));
        }
    }

    if (emails.length === 0) {
        gs.warn('SA_draft_created_notify: KM group has no members with email');
        return;
    }

    var subject = '[KB Intelligence] New ' + kind + '-sourced draft awaiting review: ' + draftGr.getValue('title');
    var url = gs.getProperty('glide.servlet.uri') + 'x_kb_intel_kb_draft.do?sys_id=' + draftId;
    var body = [
        'A new KB draft has been generated and needs Knowledge Manager review.',
        '',
        'Source: ' + kind,
        'Title: ' + draftGr.getValue('title'),
        'Summary: ' + draftGr.getValue('summary'),
        '',
        'Open the draft to review, edit, approve or reject:',
        url,
        '',
        '— KB Intelligence (x_kb_intel)'
    ].join('\n');

    var mail = new GlideEmailOutbound();
    mail.setSubject(subject);
    mail.setBody(body);
    emails.forEach(function(e) { mail.addAddress('to', e); });
    mail.save();

})(event);
