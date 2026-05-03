/**
 * Script Action: Story Capture Request Notification
 * Event name: x_1158634_kb_int_0.story.capture_request
 * Active: true
 *
 * Triggered by BR_story_closure_capture when a story is completed.
 * Emails the assigned developer asking them to fill the brief 2-min capture.
 *
 * Expected event params:
 *   parm1 = capture sys_id
 *   parm2 = developer sys_id
 */
(function executeAction(event) {
    var captureId = event.parm1 + '';
    var developerSysId = event.parm2 + '';

    if (!developerSysId) return;

    var dev = new GlideRecord('sys_user');
    if (!dev.get(developerSysId) || !dev.getValue('email')) return;

    var capGr = new GlideRecord('x_1158634_kb_int_0_developer_capture');
    if (!capGr.get(captureId)) return;

    var url = gs.getProperty('glide.servlet.uri') + 'x_1158634_kb_int_0_developer_capture.do?sys_id=' + captureId;
    var subject = '[KB Intelligence] 2-minute brief: capture knowledge for ' + capGr.getValue('problem_brief').substring(0, 80);
    var body = [
        'Hi ' + dev.getValue('first_name') + ',',
        '',
        'You just closed a story. Please take 2 minutes to fill the capture form below — your brief notes will be expanded into a full KB article by the KB Intelligence assistant, then reviewed and published by Knowledge Managers.',
        '',
        'You only need to fill the fields you actually changed. Leave the rest blank.',
        '',
        'Open the capture form:',
        url,
        '',
        'When you click "Submit for KB Generation", the LLM will draft a full KB article from your brief inputs and route it to Knowledge Managers for review. You\'ll be credited as the resolver.',
        '',
        '— KB Intelligence (x_1158634_kb_int_0)'
    ].join('\n');

    var mail = new GlideEmailOutbound();
    mail.setSubject(subject);
    mail.setBody(body);
    mail.addAddress('to', dev.getValue('email'));
    mail.save();

})(event);
