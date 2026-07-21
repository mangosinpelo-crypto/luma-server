import { Router } from 'express';
import supabase from '../services/supabase.js';

const router = Router();

/**
 * GET /api/memory
 * Returns the user's full emotional state and memory.
 */
router.get('/', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('memory_state')
      .select('*')
      .eq('user_id', req.userId)
      .single();

    if (error && error.code === 'PGRST116') {
      // No row found — return defaults (arquetipo_id is null so client uses its lumaActiveCharacter)
      return res.json({
        afinidad: 50, enojo: 0, cansancio: 0, ansiedad: 0,
        aburrimiento: 0, resentimiento: 0, celos: 0, nostalgia: 0,
        rasgos_identidad: [], memory_state: { episodios: [], conocimiento: {}, perfil_psicologico: '', characters_vault: {} },
        ignored_count: 0, arquetipo_id: null, dias_activos: [],
        chat_history: []
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
 */
router.post('/', async (req, res) => {
  try {
    // Whitelist allowed fields — reject anything else
    const ALLOWED_FIELDS = [
      'afinidad', 'enojo', 'cansancio', 'ansiedad', 'aburrimiento',
      'resentimiento', 'celos', 'nostalgia', 'rasgos_identidad',
      'memory_state', 'ignored_count', 'arquetipo_id', 'dias_activos',
      'chat_history'
    ];

    const sanitized = {};
    for (const key of ALLOWED_FIELDS) {
      if (req.body[key] !== undefined) {
        sanitized[key] = req.body[key];
      }
    }

    // Validate numeric fields are within 0-100
    const numericFields = ['afinidad', 'enojo', 'cansancio', 'ansiedad', 'aburrimiento', 'resentimiento', 'celos', 'nostalgia'];
    for (const field of numericFields) {
      if (sanitized[field] !== undefined) {
        const val = Number(sanitized[field]);
        if (isNaN(val) || val < 0 || val > 100) {
          return res.status(400).json({ error: `Campo ${field} debe ser un número entre 0 y 100` });
        }
        sanitized[field] = val;
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
    if (sanitized.arquetipo_id && !VALID_ARQUETIPOS.includes(sanitized.arquetipo_id)) {
      return res.status(400).json({ error: 'arquetipo_id inválido' });
    }

    // Cap chat_history to last 50 items to prevent unbounded DB growth
    if (Array.isArray(sanitized.chat_history)) {
      sanitized.chat_history = sanitized.chat_history.slice(-50);
    }

    const payload = {
      user_id: req.userId,
      ...sanitized,
      updated_at: new Date().toISOString()
    };

    const { error } = await supabase
      .from('memory_state')
      .upsert(payload, { onConflict: 'user_id' });

    if (error) throw error;
    res.json({ ok: true });
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
    await supabase.from('memory_state').delete().eq('user_id', req.userId);
    await supabase.from('episodes').delete().eq('user_id', req.userId);
    res.json({ ok: true });
  } catch (err) {
    console.error('Memory DELETE error:', err);
    res.status(500).json({ error: 'Error al borrar memoria' });
  }
});

/**
 * GET /api/memory/episodes?keywords=word1,word2
 * Searches episodes by keywords using Postgres ilike filters.
 */
router.get('/episodes', async (req, res) => {
  try {
    const keywords = (req.query.keywords || '')
      .split(',')
      .map(k => k.replace(/[^\w\sñáéíóú]/gi, '').trim())
      .filter(k => k.length > 0);

    if (keywords.length === 0) {
      return res.json([]);
    }

    // Construct Supabase OR filter for Postgres search: text.ilike.%word1%,text.ilike.%word2%
    const orCondition = keywords.map(k => `text.ilike.%${k}%`).join(',');

    const { data, error } = await supabase
      .from('episodes')
      .select('text, created_at')
      .eq('user_id', req.userId)
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
 * Saves a new episode.
 */
router.post('/episodes', async (req, res) => {
  try {
    const { text } = req.body;
    if (!text) return res.status(400).json({ error: 'text requerido' });

    const { error } = await supabase
      .from('episodes')
      .insert({ user_id: req.userId, text });

    if (error) throw error;
    
    // Non-blocking cleanup of episodes older than 30 days
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    supabase.from('episodes')
      .delete()
      .eq('user_id', req.userId)
      .lt('created_at', thirtyDaysAgo.toISOString())
      .then(({ error: cleanupError }) => { 
        if (cleanupError) console.error('Cleanup error:', cleanupError); 
      });

    res.json({ ok: true });
  } catch (err) {
    console.error('Episode POST error:', err);
    res.status(500).json({ error: 'Error guardando episodio' });
  }
});

export default router;
