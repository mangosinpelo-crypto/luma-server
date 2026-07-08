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
 * Returns the model string based on user tier and archetype.
 */
export function getModel(tier, arquetipoId) {
  if (tier === 'premium' || tier === 'obsesion') {
    return process.env.PREMIUM_MODEL || 'google/gemma-2-9b-it:free';
  }
  // Free tier options based on arquetipo to give distinct flavor for free
  if (arquetipoId === 'ex') return 'meta-llama/llama-3-8b-instruct:free';
  if (arquetipoId === 'rival') return 'microsoft/phi-3-mini-128k-instruct:free';
  return process.env.FREE_MODEL || 'google/gemma-2-9b-it:free';
}
