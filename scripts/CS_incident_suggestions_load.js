/**
 * Client Script: KB Intel — Load Suggestions
 * Application: GLOBAL  (Client Scripts on the incident table go to Global)
 * Table: incident
 * Type: onLoad
 * Active: true
 *
 * Runs in the browser when an incident form opens. Fetches suggestion data
 * via GlideAjax (calling x_1158634_kb_int_0.SuggestionAjax.getSuggestions),
 * builds the panel HTML, and injects it into the placeholder div rendered
 * by the kb_intel_suggestion_panel UI Macro.
 *
 * If the placeholder div is missing (the formatter wasn't added to the form
 * layout), the script creates a panel and inserts it at the top of the form.
 *
 * Why this approach beats the old Jelly-based UI Macro:
 *   - No reliance on `current` in cross-scope Jelly evaluation
 *   - No reliance on `RP` parameter passing
 *   - g_form.getUniqueValue() is reliable in any scope
 *   - GlideAjax is the official client→server cross-scope contract
 */
function onLoad() {
    if (typeof g_form === 'undefined' || !g_form) return;
    if (g_form.isNewRecord && g_form.isNewRecord()) return;

    var sysId = g_form.getUniqueValue();
    if (!sysId) return;

    var ga = new GlideAjax('x_1158634_kb_int_0.SuggestionAjax');
    ga.addParam('sysparm_name', 'getSuggestions');
    ga.addParam('sysparm_incident_id', sysId);
    ga.getXMLAnswer(function(answer) {
        try {
            var data = JSON.parse(answer || '{}');
            renderSuggestionPanel(data.suggestions || [], data.debug || '');
        } catch (e) {
            console.error('KB Intel: failed to parse suggestion AJAX response', e, answer);
            renderSuggestionPanel([], 'parse error');
        }
    });

    function renderSuggestionPanel(suggestions, debugInfo) {
        var html = buildPanelHtml(suggestions, debugInfo);

        // Try to find the placeholder div from the UI Macro first
        var panel = document.getElementById('kbi_panel');

        if (!panel) {
            // Placeholder not present — create one and inject above the form
            panel = document.createElement('div');
            panel.id = 'kbi_panel';
            panel.style.cssText = 'border:1px solid #d0d7de;padding:12px;border-radius:6px;background:#f6f8fa;margin:10px 0;';

            var injectionTargets = [
                document.querySelector('table.formtable'),
                document.querySelector('.section_form_only'),
                document.querySelector('form[name="incident.do"]'),
                document.querySelector('#incident.do')
            ];
            var injected = false;
            for (var i = 0; i < injectionTargets.length; i++) {
                if (injectionTargets[i] && injectionTargets[i].parentNode) {
                    injectionTargets[i].parentNode.insertBefore(panel, injectionTargets[i]);
                    injected = true;
                    break;
                }
            }
            if (!injected) {
                console.warn('KB Intel: no form target found, panel not injected');
                return;
            }
        }

        panel.innerHTML = html;
    }

    function escapeHtml(s) {
        if (s === null || typeof s === 'undefined') return '';
        return String(s)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function buildPanelHtml(suggestions, debugInfo) {
        var parts = [];
        parts.push('<h4 style="margin:0 0 8px 0;color:#0969da;">⚡ Similar Past Resolutions (L2 / L3 Hint)</h4>');

        // DEBUG line — comment out the next push() call once everything works
        parts.push('<div style="font-size:0.75em;color:#999;margin-bottom:6px;">debug: ' + escapeHtml(debugInfo) + '</div>');

        if (!suggestions || suggestions.length === 0) {
            parts.push('<em style="color:#57606a;">No suggestions yet — assign to a group, save the form, then refresh to trigger. Or click "Refresh Suggestions" below.</em>');
        } else {
            for (var i = 0; i < suggestions.length; i++) {
                var s = suggestions[i];
                parts.push('<div style="margin-bottom:10px;border-left:3px solid #0969da;padding-left:8px;">');
                parts.push(  '<div><strong><a href="incident.do?sys_id=' + escapeHtml(s.incident_sys_id) + '" target="_blank">' + escapeHtml(s.incident_number) + '</a></strong>');
                parts.push(  '<span style="color:#57606a;font-size:0.9em;"> (similarity ' + escapeHtml(s.score) + ')</span></div>');
                parts.push(  '<div style="margin:4px 0;">' + escapeHtml(s.short_description) + '</div>');
                parts.push(  '<details style="margin-top:4px;"><summary style="cursor:pointer;color:#57606a;">Resolution notes</summary>');
                parts.push(    '<pre style="white-space:pre-wrap;background:#fff;padding:8px;border:1px solid #eee;border-radius:4px;font-size:0.9em;">' + escapeHtml(s.close_notes) + '</pre></details>');
                if (s.kb_sys_id) {
                    parts.push('<div style="margin-top:4px;"><a href="kb_view.do?sysparm_article=' + escapeHtml(s.kb_sys_id) + '" target="_blank">📖 View linked KB →</a></div>');
                }
                parts.push('</div>');
            }
        }

        // "Refresh" button — manually re-run the suggester for this incident
        parts.push('<button type="button" id="kbi_refresh_btn" style="margin-top:6px;padding:4px 10px;font-size:0.85em;cursor:pointer;border:1px solid #0969da;background:#fff;color:#0969da;border-radius:4px;">🔄 Refresh suggestions</button>');

        return parts.join('');
    }

    // After rendering, wire up the Refresh button. We do this with delegation
    // because the button is recreated every time renderSuggestionPanel runs.
    document.addEventListener('click', function(ev) {
        if (ev.target && ev.target.id === 'kbi_refresh_btn') {
            ev.preventDefault();
            var btn = ev.target;
            btn.disabled = true;
            btn.innerText = '⏳ Refreshing…';

            var ga2 = new GlideAjax('x_1158634_kb_int_0.SuggestionAjax');
            ga2.addParam('sysparm_name', 'refreshSuggestions');
            ga2.addParam('sysparm_incident_id', sysId);
            ga2.getXMLAnswer(function(answer) {
                try {
                    var data = JSON.parse(answer || '{}');
                    renderSuggestionPanel(data.suggestions || [], data.debug || '');
                } catch (e) {
                    console.error('KB Intel: refresh parse error', e);
                    renderSuggestionPanel([], 'refresh parse error');
                }
            });
        }
    });
}
