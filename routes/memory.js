import { Router } from 'express';
import supabase from '../services/supabase.js';
import { generateEmbedding, summarizeEpisodes } from '../services/openrouter.js';

const router = Router();

/**
 * GET /api/memory
 * Returns the user's full emotional state and memory.
 */
router.get('/', async (req, res) => {
  try {
    const characterId = req.query.character_id || 'pareja';
    const { data, error } = await supabase
      .from('memory_state')
      .select('*')
      .eq('user_id', req.userId)
      .eq('character_id', characterId)
      .single();

    if (error && error.code === 'PGRST116') {
      // No row found — return defaults
      return res.json({
        afinidad: 50, enojo: 0, cansancio: 0, ansiedad: 0,
        aburrimiento: 0, resentimiento: 0, celos: 0, nostalgia: 0,
        rasgos_identidad: [], memory_state: { episodios: [], conocimiento: {}, perfil_psicologico: '', characters_vault: {} },
        ignored_count: 0, arquetipo_id: null, dias_activos: [],
        chat_history: [], character_id: characterId
      });
    }

    if (error) throw error;
    res.json(data);
  } catch (err) {
    console.error('Memory GET error:', err);
    res.status(500).json({ error: 'Error al cargar memoria' });
  }
});

/**
 * POST /api/memory
 * Saves/updates the user's emotional state and memory.
 * Enforces evolution feature limits for free tier.
 */
router.post('/', async (req, res) => {
  try {
    const characterId = req.body.character_id || 'pareja';
    // Whitelist allowed fields — reject anything else
    const ALLOWED_FIELDS = [
      'afinidad', 'enojo', 'cansancio', 'ansiedad', 'aburrimiento',
      'resentimiento', 'celos', 'nostalgia', 'rasgos_identidad',
      'memory_state', 'ignored_count', 'arquetipo_id', 'dias_activos',
      'chat_history', 'sensitivities', 'character_id'
    ];

    const sanitized = {};
    for (const key of ALLOWED_FIELDS) {
      if (req.body[key] !== undefined) {
        sanitized[key] = req.body[key];
      }
    }

    // Check tier evolution feature
    const isEvolutionAllowed = req.tierFeatures && req.tierFeatures.evolution;
    const emotionalFields = ['afinidad', 'enojo', 'cansancio', 'ansiedad', 'aburrimiento', 'resentimiento', 'celos', 'nostalgia'];

    if (!isEvolutionAllowed) {
      // Free tier: ignore changes to emotional spectrum parameters
      for (const field of emotionalFields) {
        delete sanitized[field];
      }
    } else {
      // Validate numeric fields are within 0-100 for tiers with evolution allowed
      for (const field of emotionalFields) {
        if (sanitized[field] !== undefined) {
          const val = Number(sanitized[field]);
          if (isNaN(val) || val < 0 || val > 100) {
            return res.status(400).json({ error: `Campo ${field} debe ser un número entre 0 y 100` });
          }
          sanitized[field] = val;
        }
      }
    }

    // Validate ignored_count
    if (sanitized.ignored_count !== undefined) {
      const val = Number(sanitized.ignored_count);
      if (isNaN(val) || val < 0) {
        return res.status(400).json({ error: 'ignored_count debe ser un número >= 0' });
      }
      sanitized.ignored_count = val;
    }

    // Validate arquetipo_id
    const VALID_ARQUETIPOS = ['pareja', 'amigaToxica', 'rival', 'ex', 'mejorAmigo'];
    if (sanitized.arquetipo_id && !VALID_ARQUETIPOS.includes(sanitized.arquetipo_id) && !sanitized.arquetipo_id.startsWith('custom_') && !sanitized.arquetipo_id.startsWith('imported_')) {
      return res.status(400).json({ error: 'arquetipo_id inválido' });
    }

    // Cap chat_history to last 50 items to prevent unbounded DB growth
    if (Array.isArray(sanitized.chat_history)) {
      sanitized.chat_history = sanitized.chat_history.slice(-50);
    }

    const payload = {
      user_id: req.userId,
      character_id: characterId,
      ...sanitized,
      updated_at: new Date().toISOString()
    };

    const { error } = await supabase
      .from('memory_state')
      .upsert(payload, { onConflict: 'user_id,character_id' });

    if (error) throw error;
    res.json({ ok: true, evolutionApplied: isEvolutionAllowed });
  } catch (err) {
    console.error('Memory POST error:', err);
    res.status(500).json({ error: 'Error al guardar memoria' });
  }
});

/**
 * DELETE /api/memory
 * Clears all memory for the user.
 */
router.delete('/', async (req, res) => {
  try {
    const characterId = req.query.character_id || 'pareja';
    await supabase.from('memory_state').delete().eq('user_id', req.userId).eq('character_id', characterId);
    await supabase.from('episodes').delete().eq('user_id', req.userId).eq('character_id', characterId);
    res.json({ ok: true });
  } catch (err) {
    console.error('Memory DELETE error:', err);
    res.status(500).json({ error: 'Error al borrar memoria' });
  }
});

/**
 * GET /api/memory/episodes?keywords=word1,word2 or ?q=search_phrase
 * Performs semantic vector search (via pgvector RPC with time-decay recency) with fallback to keyword ilike search.
 */
router.get('/episodes', async (req, res) => {
  try {
    const characterId = req.query.character_id || 'pareja';
    const queryStr = req.query.q || req.query.keywords || '';
    const rawKeywords = queryStr
      .split(',')
      .map(k => k.replace(/[^\w\sñáéíóú]/gi, '').trim())
      .filter(k => k.length > 0);

    if (rawKeywords.length === 0) {
      return res.json([]);
    }

    const searchPhrase = rawKeywords.join(' ');

    // Attempt 1: Semantic Vector Search via generateEmbedding & match_episodes RPC (with time decay score)
    const queryEmbedding = await generateEmbedding(searchPhrase);
    if (queryEmbedding && Array.isArray(queryEmbedding)) {
      const { data: vectorResults, error: rpcError } = await supabase.rpc('match_episodes', {
        query_embedding: queryEmbedding,
        match_threshold: 0.25,
        match_count: 3,
        p_user_id: req.userId,
        p_character_id: characterId
      });

      if (!rpcError && vectorResults && vectorResults.length > 0) {
        return res.json(vectorResults.map(r => r.text));
      }
    }

    // Attempt 2: Fallback to keyword ILIKE search in Postgres
    const orCondition = rawKeywords.map(k => `text.ilike.%${k}%`).join(',');

    const { data, error } = await supabase
      .from('episodes')
      .select('text, created_at')
      .eq('user_id', req.userId)
      .eq('character_id', characterId)
      .or(orCondition)
      .order('created_at', { ascending: false })
      .limit(3);

    if (error) throw error;

    res.json((data || []).map(r => r.text));
  } catch (err) {
    console.error('Episodes GET error:', err);
    res.status(500).json({ error: 'Error buscando episodios' });
  }
});

/**
 * POST /api/memory/episodes
 * Saves a new episode non-blockingly (returns HTTP 200 immediately, processes embedding & insertion asynchronously).
 */
router.post('/episodes', async (req, res) => {
  try {
    const { text, character_id: charId } = req.body;
    if (!text) return res.status(400).json({ error: 'text requerido' });

    const characterId = charId || 'pareja';
    const userId = req.userId;

    // Instant HTTP 200 response to client (~10ms latency)
    res.json({ ok: true, async: true });

    // Background asynchronous execution for embedding, DB save, and smart episode consolidation
    setImmediate(async () => {
      try {
        const embedding = await generateEmbedding(text);
        const insertPayload = { user_id: userId, character_id: characterId, text };
        if (embedding) {
          insertPayload.embedding = embedding;
        }

        const { error: insertError } = await supabase
          .from('episodes')
          .insert(insertPayload);

        if (insertError) console.error('Async episode insert error:', insertError);

        // Smart cleanup & condensation of episodes older than 30 days
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

        // Fetch old episodes before deletion to summarize them into long-term psychological memory
        const { data: oldEpisodes } = await supabase
          .from('episodes')
          .select('text')
          .eq('user_id', userId)
          .eq('character_id', characterId)
          .lt('created_at', thirtyDaysAgo.toISOString());

        if (oldEpisodes && oldEpisodes.length > 0) {
          const oldTexts = oldEpisodes.map(e => e.text);
          const summary = await summarizeEpisodes(oldTexts);

          if (summary) {
            // Append condensed summary to user's memory_state.perfil_psicologico
            const { data: currentMemory } = await supabase
              .from('memory_state')
              .select('memory_state')
              .eq('user_id', userId)
              .eq('character_id', characterId)
              .single();

            const existingState = currentMemory?.memory_state || {};
            const existingProfile = existingState.perfil_psicologico || '';
            const updatedProfile = existingProfile
              ? `${existingProfile}\n- [Resumen Pasado]: ${summary}`
              : `- [Resumen Pasado]: ${summary}`;

            await supabase
              .from('memory_state')
              .upsert({
                user_id: userId,
                character_id: characterId,
                memory_state: {
                  ...existingState,
                  perfil_psicologico: updatedProfile
                },
                updated_at: new Date().toISOString()
              }, { onConflict: 'user_id,character_id' });

          }

          // Delete summarized old episodes
          await supabase
            .from('episodes')
            .delete()
            .eq('user_id', userId)
            .eq('character_id', characterId)
            .lt('created_at', thirtyDaysAgo.toISOString());
        }
      } catch (bgError) {
        console.error('Background episode processing error:', bgError);
      }
    });
  } catch (err) {
    console.error('Episode POST error:', err);
    res.status(500).json({ error: 'Error guardando episodio' });
  }
});

export default router;


