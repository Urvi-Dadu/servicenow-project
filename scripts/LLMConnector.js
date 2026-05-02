/**
 * Script Include: LLMConnector
 * Application: KB Intelligence (x_1158634_kb_int_0)
 * Accessible from: All application scopes
 * Active: true
 *
 * Wraps the Google Gemini generateContent API.
 *
 * USAGE:
 *   var llm = new x_1158634_kb_int_0.LLMConnector();
 *   var result = llm.callGemini(systemPrompt, userPrompt, {
 *       model: 'gemini-2.5-flash',
 *       maxTokens: 4096,
 *       enforceJson: true
 *   });
 *   if (result) {
 *       gs.info(result.text);          // string (JSON if enforceJson)
 *       gs.info(result.tokensIn);      // input tokens used
 *       gs.info(result.tokensOut);     // output tokens used
 *   }
 *
 * REQUIRED system properties:
 *   x_1158634_kb_int_0.gemini_api_key   — your AIza... key (password type)
 *   x_1158634_kb_int_0.default_model    — e.g. "gemini-2.5-flash"
 */
var LLMConnector = Class.create();
LLMConnector.prototype = {
    initialize: function() {
        this.apiKeyProperty = 'x_1158634_kb_int_0.gemini_api_key';
        this.endpointBase = 'https://generativelanguage.googleapis.com/v1beta/models/';
        this.defaultModel = gs.getProperty('x_1158634_kb_int_0.default_model', 'gemini-2.5-flash');
    },

    /**
     * Call Gemini.
     * @param {string} systemPrompt — instructions to the model
     * @param {string} userPrompt — the actual content to process
     * @param {object} options
     *        options.model         — override default model
     *        options.maxTokens     — output token cap (default 4096)
     *        options.temperature   — default 0.3
     *        options.enforceJson   — if true, sets responseMimeType=application/json with our KB schema
     * @returns {object|null} { text, model, tokensIn, tokensOut } or null on failure
     */
    callGemini: function(systemPrompt, userPrompt, options) {
        options = options || {};
        var model = options.model || this.defaultModel;
        var maxTokens = options.maxTokens || 4096;
        var temperature = (typeof options.temperature === 'number') ? options.temperature : 0.3;
        var enforceJson = options.enforceJson !== false; // default true

        var apiKey = gs.getProperty(this.apiKeyProperty);
        if (!apiKey) {
            gs.error('LLMConnector: missing API key in property ' + this.apiKeyProperty);
            return null;
        }

        var endpoint = this.endpointBase + model + ':generateContent';

        var generationConfig = {
            temperature: temperature,
            maxOutputTokens: maxTokens
        };
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
            contents: [
                { role: 'user', parts: [{ text: userPrompt }] }
            ],
            generationConfig: generationConfig,
            safetySettings: [
                { category: 'HARM_CATEGORY_HARASSMENT',        threshold: 'BLOCK_ONLY_HIGH' },
                { category: 'HARM_CATEGORY_HATE_SPEECH',       threshold: 'BLOCK_ONLY_HIGH' },
                { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_ONLY_HIGH' },
                { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_ONLY_HIGH' }
            ]
        };

        // Retry loop with exponential backoff on 429
        var maxRetries = 3;
        var backoff = 4000; // ms
        for (var attempt = 0; attempt < maxRetries; attempt++) {
            var resp = this._makeRequest(endpoint, apiKey, body);
            if (!resp) return null;

            if (resp.status === 200) {
                return this._parseGeminiResponse(resp.bodyText, model);
            }
            if (resp.status === 429) {
                gs.warn('LLMConnector: rate-limited (429), backing off ' + backoff + 'ms (attempt ' + (attempt + 1) + '/' + maxRetries + ')');
                gs.sleep(backoff);
                backoff *= 2;
                continue;
            }
            // Non-retryable error
            gs.error('LLMConnector: HTTP ' + resp.status + ' — ' + resp.bodyText);
            return null;
        }

        // Exhausted retries
        gs.eventQueue('x_1158634_kb_int_0.daily_cap_hit', null, model, 'LLMConnector');
        gs.error('LLMConnector: exhausted retries on rate limit. Daily cap may be reached for ' + model);
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
            return {
                status: response.getStatusCode(),
                bodyText: response.getBody()
            };
        } catch (e) {
            gs.error('LLMConnector: REST exception — ' + e.message);
            return null;
        }
    },

    _parseGeminiResponse: function(bodyText, model) {
        var parsed;
        try {
            parsed = JSON.parse(bodyText);
        } catch (e) {
            gs.error('LLMConnector: response not JSON — ' + bodyText.substring(0, 500));
            return null;
        }

        if (!parsed.candidates || parsed.candidates.length === 0) {
            gs.error('LLMConnector: no candidates in response — ' + bodyText.substring(0, 500));
            return null;
        }

        var cand = parsed.candidates[0];
        if (cand.finishReason && cand.finishReason !== 'STOP' && cand.finishReason !== 'MAX_TOKENS') {
            gs.error('LLMConnector: candidate finishReason=' + cand.finishReason + ' (likely safety block) — body: ' + bodyText.substring(0, 500));
            return null;
        }

        if (!cand.content || !cand.content.parts || cand.content.parts.length === 0) {
            gs.error('LLMConnector: candidate has no content parts');
            return null;
        }

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
