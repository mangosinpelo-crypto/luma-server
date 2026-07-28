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
export async function streamChatCompletion(messages, model, abortSignal, maxTokens = 150, temperature = 0.8, presencePenalty = 0.3) {
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
      temperature,
      max_tokens: maxTokens,
      presence_penalty: presencePenalty,
      stop: ['</respuesta>', '\nUsuario:', '\nUser:']
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
    return process.env.FREE_MODEL || 'deepseek-ai/DeepSeek-V4-Flash';
  }

  if (process.env.GROQ_API_KEY) {
    return process.env.PREMIUM_MODEL || 'llama-3.3-70b-versatile';
  }

  return process.env.PREMIUM_MODEL || 'google/gemma-2-9b-it:free';
}

// In-memory cache for vector embeddings (TTL: 1 hour, Max entries: 500)
const EMBEDDING_CACHE = new Map();
const CACHE_TTL_MS = 60 * 60 * 1000;
const MAX_CACHE_SIZE = 500;

/**
 * Generates vector embeddings for a given text using OpenAI/DeepInfra/OpenRouter embeddings endpoint.
 * Utilizes an in-memory LRU cache to avoid redundant API calls and latency.
 * Returns an array of floats (1536 dims) or null on failure.
 */
export async function generateEmbedding(text) {
  try {
    if (!text || typeof text !== 'string') return null;
    const cleanText = text.trim();
    if (!cleanText) return null;

    // Check cache
    const cached = EMBEDDING_CACHE.get(cleanText);
    const now = Date.now();
    if (cached && (now - cached.timestamp < CACHE_TTL_MS)) {
      return cached.embedding;
    }

    const API_KEY = process.env.DEEPINFRA_API_KEY
      || process.env.OPENAI_API_KEY
      || process.env.GROQ_API_KEY
      || process.env.API_KEY
      || process.env.OPENROUTER_API_KEY;

    if (!API_KEY) return null;

    const EMBEDDING_URL = process.env.DEEPINFRA_API_KEY
      ? 'https://api.deepinfra.com/v1/openai/embeddings'
      : (process.env.OPENAI_API_KEY
          ? 'https://api.openai.com/v1/embeddings'
          : (process.env.API_BASE_URL
              ? `${process.env.API_BASE_URL.replace('/chat/completions', '')}/embeddings`
              : 'https://openrouter.ai/api/v1/embeddings'));

    const model = process.env.EMBEDDING_MODEL || 'text-embedding-3-small';

    const response = await fetch(EMBEDDING_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        input: cleanText,
        model
      })
    });

    if (!response.ok) {
      console.warn(`Embedding API warning (${response.status}):`, await response.text());
      return null;
    }

    const data = await response.json();
    if (data && data.data && data.data[0] && Array.isArray(data.data[0].embedding)) {
      const embedding = data.data[0].embedding;

      // LRU cache eviction and recency refresh
      if (EMBEDDING_CACHE.has(cleanText)) {
        EMBEDDING_CACHE.delete(cleanText);
      } else if (EMBEDDING_CACHE.size >= MAX_CACHE_SIZE) {
        const oldestKey = EMBEDDING_CACHE.keys().next().value;
        EMBEDDING_CACHE.delete(oldestKey);
      }
      EMBEDDING_CACHE.set(cleanText, { embedding, timestamp: now });

      return embedding;
    }

    return null;
  } catch (err) {
    console.warn('Error generating embedding (falling back to keyword search):', err.message);
    return null;
  }
}

/**
 * Condenses a batch of old episode texts into a bulleted long-term memory summary using AI.
 */
export async function summarizeEpisodes(episodesTexts) {
  if (!Array.isArray(episodesTexts) || episodesTexts.length === 0) return '';

  const API_KEY = process.env.DEEPINFRA_API_KEY
    || process.env.GROQ_API_KEY
    || process.env.API_KEY
    || process.env.OPENROUTER_API_KEY;

  if (!API_KEY) return episodesTexts.slice(0, 3).join('. ');

  try {
    const prompt = `Sintetiza estos recuerdos pasados de la conversación en 2 o 3 frases cortas destacando hechos emocionales o preferencias importantes del usuario:\n\n${episodesTexts.join('\n- ')}`;
    const model = getModel('free');

    const response = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: prompt }],
        stream: false,
        max_tokens: 250,
        temperature: 0.5
      })
    });

    if (!response.ok) return episodesTexts.slice(0, 3).join('. ');
    const data = await response.json();
    return data.choices && data.choices[0] && data.choices[0].message
      ? data.choices[0].message.content.trim()
      : episodesTexts.slice(0, 3).join('. ');
  } catch (err) {
    console.error('Error summarizing episodes:', err.message);
    return episodesTexts.slice(0, 3).join('. ');
  }
}



