/**
 * Script Include: DevOpsContextFetcher
 * Application: KB Intelligence (x_1158634_kb_int_0)
 * Accessible from: This application scope only
 * Active: true
 *
 * Pulls commit context for a story from the ServiceNow DevOps plugin if active.
 * Returns empty array if DevOps plugin is not installed.
 *
 * The DevOps plugin uses different table names across releases. This Script
 * Include checks for the most common ones in order:
 *   - sn_devops_commit (Tokyo+)
 *   - sn_devops_change_artifact (older)
 *
 * USAGE:
 *   var commits = new x_1158634_kb_int_0.DevOpsContextFetcher().fetchForStory(storySysId);
 *   // returns: [{ hash, message, author, files }]
 */
var DevOpsContextFetcher = Class.create();
DevOpsContextFetcher.prototype = {
    initialize: function() {},

    fetchForStory: function(storySysId) {
        if (!storySysId) return [];

        // Try modern DevOps commit table
        var commits = this._tryTable('sn_devops_commit', storySysId);
        if (commits.length > 0) return commits;

        // Try older artifact-style table
        commits = this._tryTable('sn_devops_change_artifact', storySysId);
        if (commits.length > 0) return commits;

        return [];
    },

    _tryTable: function(tableName, storySysId) {
        var commits = [];
        var gr = new GlideRecord(tableName);
        if (!gr.isValid()) return commits; // table doesn't exist (plugin not active)

        // Common foreign-key column names — try each
        var fkColumns = ['story', 'rm_story', 'task', 'change_request'];
        for (var i = 0; i < fkColumns.length; i++) {
            var fk = fkColumns[i];
            var probe = new GlideRecord(tableName);
            if (!probe.isValidField(fk)) continue;
            probe.addQuery(fk, storySysId);
            probe.setLimit(20);
            probe.query();
            while (probe.next()) {
                commits.push(this._extractCommit(probe));
            }
            if (commits.length > 0) return commits;
        }
        return commits;
    },

    _extractCommit: function(gr) {
        // Field names vary; pull whatever is present
        var hashFields = ['commit_id', 'hash', 'short_id', 'sha', 'revision'];
        var msgFields = ['commit_message', 'message', 'short_description', 'description'];
        var authorFields = ['author', 'committer', 'developer'];
        var filesFields = ['changed_files', 'files', 'diff_files', 'modified_files'];

        var pickFirst = function(rec, fields) {
            for (var i = 0; i < fields.length; i++) {
                if (rec.isValidField(fields[i])) {
                    var v = rec.getValue(fields[i]);
                    if (v) return v;
                }
            }
            return '';
        };
        var pickFirstDisplay = function(rec, fields) {
            for (var i = 0; i < fields.length; i++) {
                if (rec.isValidField(fields[i])) {
                    var v = rec.getDisplayValue(fields[i]);
                    if (v) return v;
                }
            }
            return '';
        };

        return {
            hash:    (pickFirst(gr, hashFields) || '').substring(0, 40),
            message: (pickFirst(gr, msgFields) || '').substring(0, 500),
            author:  pickFirstDisplay(gr, authorFields),
            files:   (pickFirst(gr, filesFields) || '').substring(0, 1000)
        };
    },

    type: 'DevOpsContextFetcher'
};
