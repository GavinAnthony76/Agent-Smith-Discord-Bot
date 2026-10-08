/** Credentials are used only for transport; never returned or passed to the model. */
export function createAIProvider(settings, { env = process.env, transport = fetch } = {}) {
  const base = env.AI_INTEGRATIONS_OPENAI_BASE_URL;
  const key = env.AI_INTEGRATIONS_OPENAI_API_KEY;
  const configured = Boolean(base && key);
  return {
    configured,
    async complete(messages, signal) {
      if (!configured) throw new Error('provider_not_configured');
      const body = { model: settings.model, messages, max_completion_tokens: settings.maxTokens };
      // Reasoning-model APIs restrict temperature. Keep their model default.
      if (!/^(gpt-[56]|o\d)/i.test(settings.model)) body.temperature = settings.temperature;
      if (/^gpt-5/i.test(settings.model)) body.reasoning_effort = 'low';
      const deadline = new AbortController();
      const timer = setTimeout(() => deadline.abort(), 25000);
      try {
      const response = await transport(`${base.replace(/\/+$/, '')}/chat/completions`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
        body: JSON.stringify(body), signal: AbortSignal.any([signal, deadline.signal]),
      });
      if (!response.ok) throw new Error(`provider_http_${response.status}`);
      const data = await response.json();
      const content = data.choices?.[0]?.message?.content;
      if (typeof content !== 'string' || !content.trim()) throw new Error('provider_empty_response');
      return content;
      } finally { clearTimeout(timer); }
    },
  };
}
