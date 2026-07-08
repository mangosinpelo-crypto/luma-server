import { Router } from 'express';
import { streamChatCompletion, getModelForTier } from '../services/openrouter.js';
import supabase from '../services/supabase.js';

const router = Router();

/**
 * POST /api/chat/completions
 * Proxies chat to OpenRouter with server-side API key.
 * Enforces daily message limits for free tier.
 */
router.post('/completions', async (req, res) => {
  try {
    const { messages } = req.body;

    if (!messages || !Array.isArray(messages)) {
      return res.status(400).json({ error: 'messages array requerido' });
    }

    // Check daily limit for free tier
    if (req.tier === 'free') {
      if (req.dailyMessageCount >= req.tierFeatures.maxMessagesPerDay) {
        return res.status(429).json({
          error: 'Límite diario alcanzado',
          limit: req.tierFeatures.maxMessagesPerDay,
          upgrade: true,
          message: `Has alcanzado tu límite de ${req.tierFeatures.maxMessagesPerDay} mensajes diarios. Mejora tu plan para mensajes ilimitados.`
        });
      }

      // Increment daily counter
      await supabase
        .from('users')
        .update({ daily_message_count: req.dailyMessageCount + 1 })
        .eq('id', req.userId);
    }

    const model = getModelForTier(req.tier);

    // Set up SSE headers for streaming
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60000);

    req.on('close', () => {
      controller.abort();
      clearTimeout(timeout);
    });

    const openRouterRes = await streamChatCompletion(messages, model, controller.signal);

    // Pipe the stream directly to the client
    const reader = openRouterRes.body.getReader();
    const decoder = new TextDecoder();

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        res.write(chunk);
      }
    } catch (streamErr) {
      if (streamErr.name !== 'AbortError') {
        console.error('Stream error:', streamErr);
      }
    } finally {
      clearTimeout(timeout);
      res.end();
    }
  } catch (error) {
    console.error('Chat proxy error:', error);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Error al procesar el mensaje' });
    } else {
      res.end();
    }
  }
});

export default router;
