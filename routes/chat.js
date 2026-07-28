import { Router } from 'express';
import { streamChatCompletion, getModel } from '../services/openrouter.js';
import supabase from '../services/supabase.js';
import { isArchetypeAllowed } from '../middleware/tierCheck.js';
import { promptShield, userRateLimit, outputLeakageGuard } from '../middleware/security.js';

const router = Router();


/**
 * POST /api/chat/completions
 * Proxies chat to AI providers with prompt injection shielding, account rate limits, and daily limits.
 */
router.post('/completions', userRateLimit(20, 60000), promptShield, async (req, res) => {


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

    // 1. Sliding Window Context Pruning (Keep system message + last 8 turns to save up to 70% input tokens)
    let prunedMessages = messages;
    if (messages.length > 9) {
      const systemMessage = messages[0]?.role === 'system' ? messages[0] : null;
      const recentMessages = messages.slice(-8);
      prunedMessages = systemMessage ? [systemMessage, ...recentMessages] : recentMessages;
    }

    // 2. Dynamic Max Tokens per Tier
    const TIER_MAX_TOKENS = { free: 250, premium: 800, obsesion: 1200 };
    const maxTokens = TIER_MAX_TOKENS[req.tier] || 300;

    const model = getModel(req.tier, arquetipo_id);
    const inputChars = prunedMessages.reduce((acc, m) => acc + (m.content ? m.content.length : 0), 0);
    const estInputTokens = Math.round(inputChars / 3.8);
    console.log(`[CHAT AUDIT] Request | Model: ${model} | Tier: ${req.tier} | Raw Msgs: ${messages.length} -> Pruned: ${prunedMessages.length} | Est Input Tokens: ~${estInputTokens} | Max Tokens: ${maxTokens}`);

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
      jitModifier = '[JIT MICRO-ESTADO ACTIVO: 🌙 Modo Nocturno. Tono suave e íntimo por mensaje de texto. JAMÁS rompas la cuarta pared ni menciones código/IA. No narres escenas de novela.]';
    } else if (/celos|otra|amiga|ex|quién es|hablando con/i.test(lastUserMessage)) {
      jitModifier = '[JIT MICRO-ESTADO ACTIVO: 🔥 Modo Posesivo. Celos territoriales sutiles sin frases de anime ni narración de novela.]';
    } else if (/triste|mal|solo|ayuda|estrés/i.test(lastUserMessage)) {
      jitModifier = '[JIT MICRO-ESTADO ACTIVO: 🌸 Modo Empático. Apoyo genuino como persona real sin narrar escenas teatrales.]';
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
        let chunk = decoder.decode(value, { stream: true });
        chunk = outputLeakageGuard(chunk);
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
      const totalTurnTokens = estInputTokens + estOutputTokens;

      // Estimated cost calculation ($0.60 per 1M input & output tokens)
      const COST_PER_TOKEN = 0.0000006;
      const turnCostUSD = totalTurnTokens * COST_PER_TOKEN;

      console.log(`[CHAT AUDIT] Stream Finished | Output Tokens: ~${estOutputTokens} | Total Turn Tokens: ~${totalTurnTokens} | Est Turn Cost: $${turnCostUSD.toFixed(6)} USD`);

      // Asynchronously record user telemetry metrics in Supabase
      supabase
        .rpc('increment_user_telemetry', {
          p_user_id: req.userId,
          p_input_tokens: estInputTokens,
          p_output_tokens: estOutputTokens,
          p_cost_usd: turnCostUSD
        })
        .then(({ error: rpcErr }) => {
          if (rpcErr) {
            // Fallback to manual select & update if RPC is not present
            supabase.from('users')
              .select('total_input_tokens, total_output_tokens, estimated_cost_usd, total_chats_count')
              .eq('id', req.userId)
              .single()
              .then(({ data: uData }) => {
                if (uData) {
                  supabase.from('users').update({
                    total_input_tokens: (Number(uData.total_input_tokens) || 0) + estInputTokens,
                    total_output_tokens: (Number(uData.total_output_tokens) || 0) + estOutputTokens,
                    estimated_cost_usd: (Number(uData.estimated_cost_usd) || 0) + turnCostUSD,
                    total_chats_count: (Number(uData.total_chats_count) || 0) + 1
                  }).eq('id', req.userId).then(() => {});
                }
              });
          }
        });

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

