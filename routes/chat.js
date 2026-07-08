import { Router } from 'express';
import { streamChatCompletion, getModel } from '../services/openrouter.js';
import supabase from '../services/supabase.js';

const router = Router();

/**
 * POST /api/chat/completions
 * Proxies chat to OpenRouter with server-side API key.
 * Enforces daily message limits for free tier.
 */
router.post('/completions', async (req, res) => {
  try {
    const { messages, isRetry, isInternal } = req.body;

    if (!messages || !Array.isArray(messages)) {
      return res.status(400).json({ error: 'messages array requerido' });
    }

    // Check limits for free tier
    if (req.tier === 'free' && !isRetry) {
      if (isInternal) {
        if (req.dailyInternalCount >= req.tierFeatures.maxInternalPerDay) {
          return res.status(429).json({
            error: 'Límite interno alcanzado',
            isInternal: true
          });
        }
        await supabase
          .from('users')
          .update({ daily_internal_count: req.dailyInternalCount + 1 })
          .eq('id', req.userId);
      } else {
        if (req.dailyMessageCount >= req.tierFeatures.maxMessagesPerDay) {
          return res.status(429).json({
            error: 'Límite diario alcanzado',
            limit: req.tierFeatures.maxMessagesPerDay,
            upgrade: true,
            message: `Has agotado tus ${req.tierFeatures.maxMessagesPerDay} mensajes diarios. Mejora tu plan para seguir hablando.`
          });
        }
        await supabase
          .from('users')
          .update({ daily_message_count: req.dailyMessageCount + 1 })
          .eq('id', req.userId);
      }
    }

    const model = getModel(req.tier, req.body.arquetipo_id);

    // Set up SSE headers for streaming
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 120000);

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
        if (req.destroyed || res.writableEnded) {
          controller.abort();
          break;
        }
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
