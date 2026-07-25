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
    const { messages, isRetry, isInternal, arquetipo_id, max_tokens, temperature, presence_penalty } = req.body;

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
    console.log(`[CHAT] Model: ${model}, Tier: ${req.tier}, Archetype: ${arquetipo_id || 'default'}, Messages: ${messages.length}`);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 120000);

    req.on('close', () => {
      controller.abort();
      clearTimeout(timeout);
    });

    // Clamp max_tokens from client (min 100, max 500, default 150)
    const clampedMaxTokens = Math.min(500, Math.max(100, Number(max_tokens) || 150));
    const clampedTemp = Number(temperature) >= 0.1 && Number(temperature) <= 1.5 ? Number(temperature) : 0.8;
    // ── Just-In-Time Micro-State Evaluator (Prompt Caching Friendly) ──
    const lastUserMsgObj = messages.filter(m => m.role === 'user').slice(-1)[0];
    const lastUserMessage = lastUserMsgObj ? lastUserMsgObj.content : '';
    const nowHour = new Date().getHours();
    const isNightTime = nowHour >= 23 || nowHour < 4;

    let jitModifier = null;

    if (isNightTime) {
      jitModifier = '[JIT MICRO-ESTADO ACTIVO: 🌙 Modo Nocturno. Es tarde en la noche; tu tono es más suave, íntimo y confesional.]';
    } else if (/celos|otra|amiga|ex|quién es|hablando con/i.test(lastUserMessage)) {
      jitModifier = '[JIT MICRO-ESTADO ACTIVO: 🔥 Modo Posesivo. Muestra celos territoriales disimulados.]';
    } else if (/triste|mal|solo|ayuda|estrés/i.test(lastUserMessage)) {
      jitModifier = '[JIT MICRO-ESTADO ACTIVO: 🌸 Modo Empático. Muestra apoyo cálido y atención incondicional.]';
    }

    if (jitModifier) {
      const systemIndex = messages.findIndex(m => m.role === 'system');
      if (systemIndex !== -1) {
        messages[systemIndex].content += `\n\n${jitModifier}`;
      }
    }

    const openRouterRes = await streamChatCompletion(messages, model, controller.signal, clampedMaxTokens, clampedTemp, clampedPresence);

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

    // Set up SSE headers for streaming
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');

    if (!openRouterRes.body) {
      throw new Error('No stream body returned from AI provider');
    }

    // Pipe the stream directly to the client
    const reader = openRouterRes.body.getReader();
    const decoder = new TextDecoder();

    let debugBuffer = '';
    try {
      while (true) {
        if (req.destroyed || res.writableEnded) {
          controller.abort();
          break;
        }
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        if (debugBuffer.length < 500) debugBuffer += chunk;
        res.write(chunk);
      }
    } catch (streamErr) {
      if (streamErr.name !== 'AbortError') {
        console.error('Stream error:', streamErr);
      }
    } finally {
      console.log(`[CHAT] Stream finished. First 500 chars:`, debugBuffer.substring(0, 500));
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
