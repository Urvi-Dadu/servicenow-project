/**
 * Script Include: SuggestionAjax
 * Application: KB Intelligence (x_1158634_kb_int_0)
 * Accessible from: All application scopes   ← MUST be set for client to reach
 * Active: true
 * Client callable: true                     ← MUST be ticked
 *
 * Server-side AJAX endpoint called by the incident-form Client Script
 * (CS_incident_suggestions_load) to fetch suggestion data for a given incident.
 *
 * Replaces the broken Jelly UI Macro pattern. The Client Script runs in the
 * browser, calls this Script Include via GlideAjax, gets JSON back, and renders
 * the panel HTML — eliminating all the cross-scope `current` issues.
 *
 * USAGE (from a Client Script):
 *   var ga = new GlideAjax('x_1158634_kb_int_0.SuggestionAjax');
 *   ga.addParam('sysparm_name', 'getSuggestions');
 *   ga.addParam('sysparm_incident_id', g_form.getUniqueValue());
 *   ga.getXMLAnswer(function(answerJson) {
 *       var data = JSON.parse(answerJson);
 *       // data.suggestions = [{ incident_number, short_description, ... }, ...]
 *   });
 */
var SuggestionAjax = Class.create();
SuggestionAjax.prototype = Object.extendsObject(AbstractAjaxProcessor, {

    /**
     * Public AJAX method. Returns JSON string with the latest suggestions
     * logged for the given incident.
     */
    getSuggestions: function() {
        var incidentSysId = this.getParameter('sysparm_incident_id');
        var result = { incident_id: incidentSysId, suggestions: [], debug: '' };

        if (!incidentSysId) {
            result.debug = 'no sysparm_incident_id supplied';
            return JSON.stringify(result);
        }

        var gr = new GlideRecord('x_1158634_kb_int_0_suggestion_log');
        gr.addQuery('incident', incidentSysId);
        gr.orderByDesc('suggested_at');
        gr.setLimit(1);
        gr.query();

        if (!gr.next()) {
            result.debug = 'no suggestion_log row for this incident';
            return JSON.stringify(result);
        }

        try {
            result.suggestions = JSON.parse(gr.getValue('suggested_kbs') || '[]');
            result.debug = 'ok (' + result.suggestions.length + ' suggestions)';
        } catch (e) {
            result.debug = 'parse error: ' + e.message;
        }

        return JSON.stringify(result);
    },

    /**
     * Public AJAX method. Forces a fresh suggestion run, useful for a manual
     * "Refresh Suggestions" button on the form. Returns the new suggestions.
     */
    refreshSuggestions: function() {
        var incidentSysId = this.getParameter('sysparm_incident_id');
        if (!incidentSysId) {
            return JSON.stringify({ suggestions: [], debug: 'no sysparm_incident_id' });
        }

        try {
            new x_1158634_kb_int_0.ResolutionSuggester().suggestForIncident(incidentSysId);
        } catch (e) {
            return JSON.stringify({ suggestions: [], debug: 'suggester error: ' + e.message });
        }

        // After running, return the freshly-logged suggestions
        return this.getSuggestions();
    },

    type: 'SuggestionAjax'
});
