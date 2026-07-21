import dotenv from 'dotenv';
dotenv.config();

// Configurable API URL for DeepInfra, Groq, or OpenRouter
const API_URL = process.env.DEEPINFRA_API_KEY
  ? 'https://api.deepinfra.com/v1/openai/chat/completions'
  : (process.env.GROQ_API_KEY
      ? 'https://api.groq.com/openai/v1/chat/completions'
      : (process.env.API_BASE_URL || 'https://openrouter.ai/api/v1/chat/completions'));

/**
 * Streams a chat completion from AI provider (OpenRouter / DeepInfra / Groq).
 * Returns a ReadableStream for SSE passthrough.
 */
export async function streamChatCompletion(messages, model, abortSignal) {
  const API_KEY = process.env.DEEPINFRA_API_KEY
    || process.env.GROQ_API_KEY
    || process.env.API_KEY
    || process.env.OPENROUTER_API_KEY;

  const headers = {
    'Authorization': `Bearer ${API_KEY}`,
    'Content-Type': 'application/json'
  };

  // Add site titles for OpenRouter if using OpenRouter
  if (API_URL.includes('openrouter.ai')) {
    headers['HTTP-Referer'] = process.env.FRONTEND_URL || 'http://localhost:5173';
    headers['X-Title'] = 'Luma';
  }

  const response = await fetch(API_URL, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model,
      messages,
      stream: true,
      temperature: 0.8,
      max_tokens: 150
    }),
    signal: abortSignal
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`API error ${response.status}: ${errorText}`);
  }

  return response;
}

/**
 * Returns the model string based on user tier and provider.
 */
export function getModel(tier, arquetipoId) {
  if (process.env.DEEPINFRA_API_KEY) {
    return tier === 'premium' || tier === 'obsesion'
      ? (process.env.PREMIUM_MODEL || 'meta-llama/Meta-Llama-3.1-70B-Instruct')
      : (process.env.FREE_MODEL || 'deepseek-ai/DeepSeek-V4-Flash');
  }

  if (process.env.GROQ_API_KEY) {
    return tier === 'premium' || tier === 'obsesion'
      ? (process.env.PREMIUM_MODEL || 'llama-3.3-70b-versatile')
      : (process.env.FREE_MODEL || 'llama-3.1-8b-instant');
  }

  if (tier === 'premium' || tier === 'obsesion') {
    return process.env.PREMIUM_MODEL || 'google/gemma-2-9b-it:free';
  }
  return process.env.FREE_MODEL || 'google/gemma-2-9b-it:free';
}

