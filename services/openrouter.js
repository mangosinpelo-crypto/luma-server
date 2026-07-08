import dotenv from 'dotenv';
dotenv.config();

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

/**
 * Streams a chat completion from OpenRouter.
 * Returns a ReadableStream for SSE passthrough.
 */
export async function streamChatCompletion(messages, model, abortSignal) {
  const response = await fetch(OPENROUTER_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': process.env.FRONTEND_URL || 'http://localhost:5173',
      'X-Title': 'Luma'
    },
    body: JSON.stringify({
      model,
      messages,
      stream: true
    }),
    signal: abortSignal
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OpenRouter error ${response.status}: ${errorText}`);
  }

  return response;
}

/**
 * Returns the model string based on user tier.
 */
export function getModelForTier(tier) {
  if (tier === 'premium' || tier === 'obsesion') {
    return process.env.PREMIUM_MODEL || 'google/gemma-2-9b-it:free';
  }
  return process.env.FREE_MODEL || 'google/gemma-2-9b-it:free';
}
