const LANGUAGE_NAMES = {
  english: 'English',
  spanish: 'Spanish',
  french: 'French',
  german: 'German',
  portuguese: 'Portuguese',
  italian: 'Italian',
  japanese: 'Japanese',
  chinese: 'Chinese',
  korean: 'Korean',
  dutch: 'Dutch',
  russian: 'Russian',
};

function buildSystemPrompt(targetLanguage) {
  const lang = LANGUAGE_NAMES[targetLanguage] || targetLanguage;
  return `You are a ${lang} language teacher assistant. Your job is to analyze messages and identify ${lang} errors: grammar mistakes, wrong vocabulary, unnatural phrasing, incorrect tense, missing articles, wrong prepositions, or text that doesn't fit conversational context.

You MUST respond ONLY with a valid JSON object. No markdown fences, no extra text.`;
}

function buildUserPrompt(text, context, targetLanguage, explanationLanguage) {
  const lang = LANGUAGE_NAMES[targetLanguage] || targetLanguage;
  const explLang = LANGUAGE_NAMES[explanationLanguage] || explanationLanguage;

  const contextSection = context.length > 0
    ? `\nConversation context (previous messages):\n${context.map((m, i) => `[${i + 1}] ${m}`).join('\n')}\n`
    : '';

  return `Analyze this message for ${lang} errors:
"${text}"
${contextSection}
Respond with this exact JSON structure:
{
  "isTargetLanguage": boolean,
  "hasError": boolean,
  "severity": number,
  "corrected": "string",
  "explanation": "string"
}

Rules:
- isTargetLanguage: true only if message contains ${lang} text worth analyzing. Skip: pure emoji, very short responses ("ok", "yes", "no", "lol"), URLs, pure numbers, messages shorter than 4 words.
- hasError: true if any grammar or vocabulary error found
- severity: integer 0-100 where 0=perfect, 1-20=minor typo/punctuation, 21-50=noticeable error, 51-80=significant error, 81-100=hard to understand
- corrected: corrected version of the message (same as original if no errors)
- explanation: brief explanation in ${explLang} of what was wrong, empty string if correct`;
}

function extractJSON(raw) {
  // Strip <think>...</think> blocks produced by reasoning models (e.g. MiniMax, DeepSeek)
  const cleaned = raw.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
  // Also handle ```json ... ``` fences just in case
  const fenced = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/);
  return fenced ? fenced[1].trim() : cleaned;
}

async function analyzeMessage(text, context, config) {
  const {
    provider, apiKey, apiBaseUrl, model,
    targetLanguage = 'english',
    explanationLanguage = 'spanish',
  } = config;

  const systemPrompt = buildSystemPrompt(targetLanguage);
  const userPrompt = buildUserPrompt(text, context, targetLanguage, explanationLanguage);

  let raw;
  if (provider === 'anthropic') {
    raw = await callAnthropic(userPrompt, apiKey, model, systemPrompt);
  } else {
    const baseURL = apiBaseUrl || 'https://api.openai.com/v1';
    raw = await callOpenAI(userPrompt, apiKey, model, baseURL, systemPrompt);
  }

  const extracted = extractJSON(raw);
  if (!extracted) throw new Error(`Empty response after extraction. Raw: ${raw.slice(0, 200)}`);
  const result = JSON.parse(extracted);
  if (typeof result.isTargetLanguage !== 'boolean' || typeof result.severity !== 'number') {
    throw new Error('Unexpected LLM response shape');
  }
  return result;
}

async function callAnthropic(userPrompt, apiKey, model, systemPrompt) {
  const Anthropic = require('@anthropic-ai/sdk');
  const client = new Anthropic({ apiKey });
  const res = await client.messages.create({
    model: model || 'claude-sonnet-4-6',
    max_tokens: 4096,
    system: systemPrompt,
    messages: [{ role: 'user', content: userPrompt }],
  });
  return res.content[0].text.trim();
}

async function callOpenAI(userPrompt, apiKey, model, baseURL, systemPrompt) {
  const OpenAI = require('openai');
  const client = new OpenAI({ apiKey, baseURL });
  const isOfficialOpenAI = !baseURL || baseURL === 'https://api.openai.com/v1';
  const params = {
    model: model || 'gpt-4o-mini',
    max_tokens: 4096,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
  };
  // response_format json_object crashes Ollama-based endpoints; only use with official OpenAI
  if (isOfficialOpenAI) params.response_format = { type: 'json_object' };
  const res = await client.chat.completions.create(params);
  return res.choices[0].message.content.trim();
}

module.exports = { analyzeMessage };
