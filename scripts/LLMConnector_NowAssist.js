/**
 * Script Include: LLMConnector  (Now Assist edition)
 * Application: KB Intelligence (x_kb_intel)
 * Accessible from: All application scopes
 * Active: true
 *
 * DROP-IN REPLACEMENT for the Gemini version of LLMConnector.
 *
 * To switch:
 *   1. Open System Definition → Script Includes → LLMConnector
 *   2. Replace the ENTIRE Script field with the contents of THIS file
 *   3. Save
 *
 * The class name (LLMConnector) and public method (callGemini) are intentionally
 * unchanged so KBDraftBuilder, smoke tests, and any other caller continue to
 * work without modification. The method is named callGemini for backward
 * compatibility — internally it now routes through Now Assist OneExtend when
 * the system property x_kb_intel.llm_provider = 'now_assist'.
 *
 * REQUIRED system properties (added in Phase 17.3):
 *   x_kb_intel.llm_provider              = 'now_assist'   (or 'gemini' to use legacy path)
 *   x_kb_intel.now_assist_capability_id  = <sys_id of the published capability>
 *
 * If x_kb_intel.llm_provider is anything other than 'now_assist', this connector
 * falls back to the original Gemini code path so the swap is reversible by just
 * flipping the property — no need to repaste the original script.
 *
 * REQUIRED plugins:
 *   sn_one_extend            (Now Assist core)
 *   sn_now_assist_skillkit   (to host custom capability)
 *
 * RESPONSE SHAPE NOTE:
 *   The OneExtendUtil response shape varies between ServiceNow releases. This
 *   script tries the common shapes in order. If your release returns something
 *   different, the connector logs the raw response — open System Logs → Errors,
 *   find the "LLMConnector: NowAssist raw response: ..." line, inspect, and
 *   adjust _extractText() below to match.
 */
var LLMConnector = Class.create();
LLMConnector.prototype = {
    initialize: function() {
        this.provider = gs.getProperty('x_kb_intel.llm_provider', 'gemini');
        this.capabilityId = gs.getProperty('x_kb_intel.now_assist_capability_id', '');
        this.defaultModel = gs.getProperty('x_kb_intel.default_model', 'gemini-2.5-flash');

        // For Gemini fallback path
        this.apiKeyProperty = 'x_kb_intel.gemini_api_key';
        this.endpointBase = 'https://generativelanguage.googleapis.com/v1beta/models/';
    },

    /**
     * Public entry point. Method name preserved for backward compatibility
     * with KBDraftBuilder and existing callers.
     *
     * @param {string} systemPrompt
     * @param {string} userPrompt
     * @param {object} options — { model, maxTokens, temperature, enforceJson }
     * @returns {object|null} { text, model, tokensIn, tokensOut } or null on failure
     */
    callGemini: function(systemPrompt, userPrompt, options) {
        options = options || {};
        if (this.provider === 'now_assist') {
            return this._callNowAssist(systemPrompt, userPrompt, options);
        }
        return this._callGeminiHttp(systemPrompt, userPrompt, options);
    },

    // ============================================================
    // Now Assist path
    // ============================================================
    _callNowAssist: function(systemPrompt, userPrompt, options) {
        if (!this.capabilityId) {
            gs.error('LLMConnector: x_kb_intel.now_assist_capability_id is not set');
            return null;
        }

        var payload = {
            executionRequests: [{
                payload: {
                    system_prompt: systemPrompt,
                    user_prompt: userPrompt
                },
                capabilityId: this.capabilityId
            }]
        };

        var raw;
        try {
            // sn_one_extend_util.OneExtendUtil.execute is the canonical entry point
            // in Vancouver+ releases. The response shape can vary — we log the raw
            // body and try multiple extraction paths.
            raw = sn_one_extend_util.OneExtendUtil.execute(payload);
        } catch (e) {
            gs.error('LLMConnector: NowAssist execute exception — ' + e.message);
            return null;
        }

        if (!raw) {
            gs.error('LLMConnector: NowAssist returned null');
            return null;
        }

        var rawJson;
        try {
            rawJson = (typeof raw === 'string') ? raw : JSON.stringify(raw);
        } catch (e) {
            rawJson = '[unserializable]';
        }

        var text = this._extractText(raw);
        if (!text) {
            gs.error('LLMConnector: NowAssist could not extract text. Raw response: ' + rawJson.substring(0, 2000));
            return null;
        }

        var usage = this._extractUsage(raw);

        return {
            text: text,
            model: 'now_assist:' + this.capabilityId,
            tokensIn:  usage.in,
            tokensOut: usage.out
        };
    },

    /**
     * Try common response shapes. If your release returns something different,
     * add a new branch here and inspect the logged raw response to find the
     * right path.
     */
    _extractText: function(raw) {
        // Shape 1 (Yokohama+): { capabilities: { <capId>: { response: { content: '...' } } } }
        if (raw.capabilities && this.capabilityId && raw.capabilities[this.capabilityId]) {
            var c = raw.capabilities[this.capabilityId];
            if (c.response && typeof c.response.content === 'string') return c.response.content;
            if (typeof c.response === 'string') return c.response;
            if (c.executionResults && c.executionResults[0] && c.executionResults[0].response) {
                var r1 = c.executionResults[0].response;
                if (typeof r1 === 'string') return r1;
                if (r1.content) return r1.content;
            }
        }

        // Shape 2 (Washington-era): { executionResults: [{ payload: { response: '...' } }] }
        if (raw.executionResults && raw.executionResults[0]) {
            var er = raw.executionResults[0];
            if (er.payload) {
                if (typeof er.payload.response === 'string') return er.payload.response;
                if (er.payload.response && er.payload.response.content) return er.payload.response.content;
                if (typeof er.payload === 'string') return er.payload;
            }
            if (er.response) {
                if (typeof er.response === 'string') return er.response;
                if (er.response.content) return er.response.content;
            }
        }

        // Shape 3 (raw text fallback at top level)
        if (typeof raw.content === 'string') return raw.content;
        if (typeof raw.response === 'string') return raw.response;
        if (typeof raw.text === 'string') return raw.text;

        return null;
    },

    _extractUsage: function(raw) {
        // Best-effort token usage extraction
        var inT = 0, outT = 0;
        var probe = function(o) {
            if (!o || typeof o !== 'object') return;
            if (typeof o.input_tokens === 'number') inT = o.input_tokens;
            if (typeof o.output_tokens === 'number') outT = o.output_tokens;
            if (typeof o.prompt_tokens === 'number') inT = inT || o.prompt_tokens;
            if (typeof o.completion_tokens === 'number') outT = outT || o.completion_tokens;
            if (typeof o.tokens_in === 'number') inT = inT || o.tokens_in;
            if (typeof o.tokens_out === 'number') outT = outT || o.tokens_out;
        };
        probe(raw.usage);
        if (raw.capabilities && this.capabilityId && raw.capabilities[this.capabilityId]) {
            probe(raw.capabilities[this.capabilityId].usage);
        }
        if (raw.executionResults && raw.executionResults[0]) {
            probe(raw.executionResults[0].usage);
            probe(raw.executionResults[0].metadata);
        }
        return { in: inT, out: outT };
    },

    // ============================================================
    // Gemini fallback path (kept so flipping x_kb_intel.llm_provider
    // back to 'gemini' does not require repasting the original script)
    // ============================================================
    _callGeminiHttp: function(systemPrompt, userPrompt, options) {
        var model = options.model || this.defaultModel;
        var maxTokens = options.maxTokens || 4096;
        var temperature = (typeof options.temperature === 'number') ? options.temperature : 0.3;
        var enforceJson = options.enforceJson !== false;

        var apiKey = gs.getProperty(this.apiKeyProperty);
        if (!apiKey) {
            gs.error('LLMConnector: missing API key in property ' + this.apiKeyProperty);
            return null;
        }

        var endpoint = this.endpointBase + model + ':generateContent';

        var generationConfig = { temperature: temperature, maxOutputTokens: maxTokens };
        if (enforceJson) {
            generationConfig.responseMimeType = 'application/json';
            generationConfig.responseSchema = {
                type: 'object',
                properties: {
                    title:     { type: 'string' },
                    summary:   { type: 'string' },
                    body_html: { type: 'string' }
                },
                required: ['title', 'summary', 'body_html']
            };
        }

        var body = {
            system_instruction: { parts: [{ text: systemPrompt }] },
            contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
            generationConfig: generationConfig,
            safetySettings: [
                { category: 'HARM_CATEGORY_HARASSMENT',        threshold: 'BLOCK_ONLY_HIGH' },
                { category: 'HARM_CATEGORY_HATE_SPEECH',       threshold: 'BLOCK_ONLY_HIGH' },
                { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_ONLY_HIGH' },
                { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_ONLY_HIGH' }
            ]
        };

        var maxRetries = 3, backoff = 4000;
        for (var attempt = 0; attempt < maxRetries; attempt++) {
            var resp = this._makeRequest(endpoint, apiKey, body);
            if (!resp) return null;
            if (resp.status === 200) return this._parseGeminiResponse(resp.bodyText, model);
            if (resp.status === 429) {
                gs.warn('LLMConnector: 429, backing off ' + backoff + 'ms');
                gs.sleep(backoff);
                backoff *= 2;
                continue;
            }
            gs.error('LLMConnector: HTTP ' + resp.status + ' — ' + resp.bodyText);
            return null;
        }
        gs.eventQueue('x_kb_intel.daily_cap_hit', null, model, 'LLMConnector');
        return null;
    },

    _makeRequest: function(endpoint, apiKey, body) {
        try {
            var rm = new sn_ws.RESTMessageV2();
            rm.setEndpoint(endpoint);
            rm.setHttpMethod('POST');
            rm.setRequestHeader('x-goog-api-key', apiKey);
            rm.setRequestHeader('Content-Type', 'application/json');
            rm.setRequestBody(JSON.stringify(body));
            rm.setHttpTimeout(60000);
            var response = rm.execute();
            return { status: response.getStatusCode(), bodyText: response.getBody() };
        } catch (e) {
            gs.error('LLMConnector: REST exception — ' + e.message);
            return null;
        }
    },

    _parseGeminiResponse: function(bodyText, model) {
        var parsed;
        try { parsed = JSON.parse(bodyText); }
        catch (e) { gs.error('LLMConnector: response not JSON'); return null; }

        if (!parsed.candidates || parsed.candidates.length === 0) return null;
        var cand = parsed.candidates[0];
        if (cand.finishReason && cand.finishReason !== 'STOP' && cand.finishReason !== 'MAX_TOKENS') {
            gs.error('LLMConnector: finishReason=' + cand.finishReason); return null;
        }
        if (!cand.content || !cand.content.parts) return null;
        var text = cand.content.parts.map(function(p) { return p.text || ''; }).join('');
        var usage = parsed.usageMetadata || {};
        return {
            text: text,
            model: model,
            tokensIn:  usage.promptTokenCount     || 0,
            tokensOut: usage.candidatesTokenCount || 0
        };
    },

    type: 'LLMConnector'
};
