import { Router } from 'express';
import { streamChatCompletion, getModel } from '../services/openrouter.js';
import supabase from '../services/supabase.js';
import { isArchetypeAllowed } from '../middleware/tierCheck.js';

const router = Router();

/**
 * POST /api/chat/completions
 * Proxies chat to OpenRouter with server-side API key.
 * Enforces daily message limits for free tier.
 */
router.post('/completions', async (req, res) => {
  try {
    const { messages, isRetry, isInternal, arquetipo_id } = req.body;

    if (!messages || !Array.isArray(messages)) {
      return res.status(400).json({ error: 'messages array requerido' });
    }

    // Verify archetype authorization for user's tier
    if (arquetipo_id && !isArchetypeAllowed(req.tier, arquetipo_id)) {
      return res.status(403).json({
        error: 'El arquetipo seleccionado no está disponible en tu plan actual.',
        upgrade: true
      });
    }

    // Pre-check limit for free tier
    if (req.tier === 'free' && !isRetry) {
      if (isInternal) {
        if (req.dailyInternalCount >= req.tierFeatures.maxInternalPerDay) {
          return res.status(429).json({
            error: 'Límite interno alcanzado',
            isInternal: true
          });
        }
      } else {
        if (req.dailyMessageCount >= req.tierFeatures.maxMessagesPerDay) {
          return res.status(429).json({
            error: 'Límite diario alcanzado',
            limit: req.tierFeatures.maxMessagesPerDay,
            upgrade: true,
            message: `Has agotado tus ${req.tierFeatures.maxMessagesPerDay} mensajes diarios. Mejora tu plan para seguir hablando.`
          });
        }
      }
    }

    const model = getModel(req.tier, arquetipo_id);
    const inputChars = messages.reduce((acc, m) => acc + (m.content ? m.content.length : 0), 0);
    const estInputTokens = Math.round(inputChars / 3.8);
    console.log(`[CHAT AUDIT] New Request | Model: ${model} | Tier: ${req.tier} | Archetype: ${arquetipo_id || 'default'} | Msg Count: ${messages.length} | Input Chars: ${inputChars} | Est Input Tokens: ~${estInputTokens}`);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 120000);

    res.on('close', () => {
      if (!res.writableEnded) {
        controller.abort();
      }
      clearTimeout(timeout);
    });

    // Set up SSE headers for streaming immediately so client gets 200 OK instantly
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    if (typeof res.flushHeaders === 'function') {
      res.flushHeaders();
    }

    const openRouterRes = await streamChatCompletion(messages, model, controller.signal);

    // Stream started successfully — deduct daily message usage now
    if (req.tier === 'free' && !isRetry) {
      if (isInternal) {
        supabase
          .from('users')
          .update({ daily_internal_count: req.dailyInternalCount + 1 })
          .eq('id', req.userId)
          .then(({ error }) => { if (error) console.error('Error updating internal count:', error); });
      } else {
        supabase
          .from('users')
          .update({ daily_message_count: req.dailyMessageCount + 1 })
          .eq('id', req.userId)
          .then(({ error }) => { if (error) console.error('Error updating message count:', error); });
      }
    }

    if (!openRouterRes.body) {
      throw new Error('No stream body returned from AI provider');
    }

    // Pipe the stream directly to the client
    const reader = openRouterRes.body.getReader();
    const decoder = new TextDecoder();

    let fullStreamOutput = '';
    try {
      while (true) {
        if (res.destroyed || res.writableEnded) {
          controller.abort();
          break;
        }
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        fullStreamOutput += chunk;
        res.write(chunk);
        if (typeof res.flush === 'function') res.flush();
      }
    } catch (streamErr) {
      if (streamErr.name !== 'AbortError') {
        console.error('Stream error:', streamErr);
      }
    } finally {
      const outputChars = fullStreamOutput.length;
      const estOutputTokens = Math.round(outputChars / 4.0);
      console.log(`[CHAT AUDIT] Stream Finished | Turn Msgs: ${messages.length} | Output Chars: ${outputChars} | Est Output Tokens: ~${estOutputTokens} | Total Est Turn Tokens: ~${estInputTokens + estOutputTokens}`);
      clearTimeout(timeout);
      res.end();
    }
  } catch (error) {
    console.error('Chat proxy error:', error);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Error al procesar el mensaje', detalle: error.message });
    } else {
      res.end();
    }
  }
});

export default router;
