interface LlmConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
}

/** Groq's API is OpenAI-compatible, so both providers share this one call path.
 * Both are tried in order (if configured) so a quota-exhausted OpenAI key doesn't
 * block falling through to a working free Groq key. */
function getLlmConfigs(): LlmConfig[] {
  const configs: LlmConfig[] = [];
  if (process.env.OPENAI_API_KEY) {
    configs.push({
      baseUrl: "https://api.openai.com/v1/chat/completions",
      apiKey: process.env.OPENAI_API_KEY,
      model: "gpt-4o-mini",
    });
  }
  if (process.env.GROQ_API_KEY) {
    configs.push({
      baseUrl: "https://api.groq.com/openai/v1/chat/completions",
      apiKey: process.env.GROQ_API_KEY,
      model: "llama-3.3-70b-versatile",
    });
  }
  return configs;
}

async function tryChat(
  config: LlmConfig,
  messages: { role: "system" | "user"; content: string }[],
  temperature: number
): Promise<Record<string, unknown> | null> {
  try {
    const res = await fetch(config.baseUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.apiKey}` },
      body: JSON.stringify({
        model: config.model,
        messages,
        response_format: { type: "json_object" },
        temperature,
      }),
      signal: AbortSignal.timeout(30000),
    });

    if (!res.ok) return null;

    const data = await res.json();
    const content = data.choices?.[0]?.message?.content;
    if (!content) return null;

    return JSON.parse(content);
  } catch {
    return null;
  }
}

/** Calls whichever LLM provider is configured (OpenAI, then Groq) and returns the parsed
 * JSON content, or null if none are configured or all fail — callers should fall back to a mock. */
export async function chatJSON(
  messages: { role: "system" | "user"; content: string }[],
  temperature = 0.7
): Promise<Record<string, unknown> | null> {
  for (const config of getLlmConfigs()) {
    const result = await tryChat(config, messages, temperature);
    if (result) return result;
  }
  return null;
}

/** Same as chatJSON, but Groq-only — never touches a paid OpenAI key even if one is
 * configured. For automated/background calls (e.g. Trend Radar pattern extraction)
 * that run unattended and could fire many times a day: those must stay at zero
 * marginal cost, not silently bill through to whatever key a human-triggered feature
 * happens to have configured. Returns null (caller should skip, not fall back to
 * a paid provider) if GROQ_API_KEY isn't set. */
export async function chatJSONFree(
  messages: { role: "system" | "user"; content: string }[],
  temperature = 0.7
): Promise<Record<string, unknown> | null> {
  if (!process.env.GROQ_API_KEY) return null;
  return tryChat(
    {
      baseUrl: "https://api.groq.com/openai/v1/chat/completions",
      apiKey: process.env.GROQ_API_KEY,
      model: "llama-3.3-70b-versatile",
    },
    messages,
    temperature
  );
}
