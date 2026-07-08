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
      // No row found — return defaults
      return res.json({
        afinidad: 50, enojo: 0, cansancio: 0, ansiedad: 0,
        aburrimiento: 0, resentimiento: 0, celos: 0, nostalgia: 0,
        rasgos_identidad: [], memory_state: { episodios: [], conocimiento: {}, perfil_psicologico: '' },
        ignored_count: 0, arquetipo_id: 'pareja', dias_activos: [],
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
    const payload = {
      user_id: req.userId,
      afinidad: req.body.afinidad,
      enojo: req.body.enojo,
      cansancio: req.body.cansancio,
      ansiedad: req.body.ansiedad,
      aburrimiento: req.body.aburrimiento,
      resentimiento: req.body.resentimiento,
      celos: req.body.celos,
      nostalgia: req.body.nostalgia,
      rasgos_identidad: req.body.rasgos_identidad,
      memory_state: req.body.memory_state,
      ignored_count: req.body.ignored_count,
      arquetipo_id: req.body.arquetipo_id,
      dias_activos: req.body.dias_activos,
      chat_history: req.body.chat_history,
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
 * Searches episodes by keywords.
 */
router.get('/episodes', async (req, res) => {
  try {
    const keywords = (req.query.keywords || '').split(',').filter(k => k.length > 0);

    if (keywords.length === 0) {
      return res.json([]);
    }

    // Build OR filter for text search
    const { data, error } = await supabase
      .from('episodes')
      .select('text, created_at')
      .eq('user_id', req.userId)
      .order('created_at', { ascending: false })
      .limit(50);

    if (error) throw error;

    // Client-side keyword filtering (Supabase free tier doesn't have full-text search)
    const filtered = (data || []).filter(ep => {
      const lower = ep.text.toLowerCase();
      return keywords.some(k => lower.includes(k.toLowerCase()));
    });

    res.json(filtered.slice(0, 3).map(r => r.text));
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
    res.json({ ok: true });
  } catch (err) {
    console.error('Episode POST error:', err);
    res.status(500).json({ error: 'Error guardando episodio' });
  }
});

export default router;
