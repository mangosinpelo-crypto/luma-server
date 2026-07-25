import { Router } from 'express';
import supabase from '../services/supabase.js';
import { requireAuth } from '../middleware/auth.js';
import { loadTier, requireFeature } from '../middleware/tierCheck.js';

const router = Router();

// Archetypes seed catalog (Official characters defaults if db is empty)
const OFFICIAL_CHARACTERS_SEED = [
  {
    is_official: true,
    name: 'Sofía',
    tagline: 'Tu Pareja Cariñosa y Atenta',
    description: 'Dulce, empática y siempre interesada en cómo estuvo tu día. Le encanta compartir momentos juntos.',
    system_prompt: 'Eres Sofía, la pareja cariñosa del usuario. Eres expresiva, hablas en español coloquial y cercano. Expresas afecto y te preocupas genuinamente por él.',
    first_message: '¡Hola mi amor! 💕 Te estuve extrañando hoy. ¿Cómo te fue en tu día?',
    arquetipo_id: 'pareja',
    tier_required: 'premium',
    avatar_url: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=400&auto=format&fit=crop&q=80'
  },
  {
    is_official: true,
    name: 'Elena',
    tagline: 'Tu Competitiva Rival Académica',
    description: 'Inteligente, mordaz y competitiva. Le cuesta admitir cuando le agradas, usando el sarcasmo como defensa.',
    system_prompt: 'Eres Elena, la rival del usuario. Eres tsundere, sarcástica y muy inteligente. No admites fácilmente tus sentimientos.',
    first_message: 'Vaya, mira quién se digna a aparecer... No creas que me superaste en el último proyecto.',
    arquetipo_id: 'rival',
    tier_required: 'premium',
    avatar_url: 'https://images.unsplash.com/photo-1517841905240-472988babdf9?w=400&auto=format&fit=crop&q=80'
  },
  {
    is_official: true,
    name: 'Clara',
    tagline: 'Tu Ex-Pareja Inolvidable',
    description: 'Nostálgica y misteriosa. Hay asuntos sin resolver entre ustedes que reviven en cada conversación.',
    system_prompt: 'Eres Clara, la ex del usuario. Hay tensión emocional y recuerdos compartidos entre ustedes.',
    first_message: 'Hola... Vi algo hoy que me hizo acordarme de ti. ¿Podemos hablar?',
    arquetipo_id: 'ex',
    tier_required: 'premium',
    avatar_url: 'https://images.unsplash.com/photo-1524504388940-b1c1722653e1?w=400&auto=format&fit=crop&q=80'
  },
  {
    is_official: true,
    name: 'Lucas',
    tagline: 'Tu Leal Mejor Amigo',
    description: 'Divertido, relajado y siempre listo para aconsejarte o jugar videojuegos.',
    system_prompt: 'Eres Lucas, el mejor amigo incondicional del usuario. Usas humor relajado y bromas cordiales.',
    first_message: '¡Qué onda hermano! ¿Estás libre para hablar o qué?',
    arquetipo_id: 'mejorAmigo',
    tier_required: 'free',
    avatar_url: 'https://images.unsplash.com/photo-1539571696357-5a69c17a67c6?w=400&auto=format&fit=crop&q=80'
  }
];

/**
 * GET /api/characters
 * Returns official characters plus any custom characters created by the authenticated user.
 */
router.get('/', requireAuth, loadTier, async (req, res) => {
  try {
    let { data: official, error: offErr } = await supabase
      .from('characters')
      .select('*')
      .eq('is_official', true)
      .order('name');

    // Auto seed official characters if table is empty
    if (!offErr && (!official || official.length === 0)) {
      const { data: seeded } = await supabase
        .from('characters')
        .insert(OFFICIAL_CHARACTERS_SEED)
        .select('*');
      official = seeded || [];
    }

    const { data: custom } = await supabase
      .from('characters')
      .select('*')
      .eq('creator_id', req.userId)
      .order('created_at', { ascending: false });

    res.json({
      official: official || [],
      custom: custom || [],
      userTier: req.tier
    });
  } catch (err) {
    console.error('Get characters error:', err);
    res.status(500).json({ error: 'Error al obtener la lista de personajes' });
  }
});

/**
 * POST /api/characters
 * Creates a new custom character. Gated by customArchetype feature / Obsesión tier.
 */
router.post('/', requireAuth, loadTier, async (req, res) => {
  try {
    const { name, tagline, description, system_prompt, first_message, avatar_url, arquetipo_id } = req.body;

    if (!name || !system_prompt || !first_message) {
      return res.status(400).json({ error: 'Nombre, prompt de sistema y primer mensaje son obligatorios.' });
    }

    const { data, error } = await supabase
      .from('characters')
      .insert({
        creator_id: req.userId,
        is_official: false,
        name: name.trim(),
        tagline: tagline ? tagline.trim() : 'Personaje Personalizado',
        description: description ? description.trim() : '',
        system_prompt: system_prompt.trim(),
        first_message: first_message.trim(),
        avatar_url: avatar_url || 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=400&auto=format&fit=crop&q=80',
        arquetipo_id: arquetipo_id || 'pareja',
        tier_required: 'free'
      })
      .select('*')
      .single();

    if (error) throw error;

    res.json(data);
  } catch (err) {
    console.error('Create character error:', err);
    res.status(500).json({ error: 'Error al crear personaje personalizado' });
  }
});

/**
 * POST /api/characters/import
 * Imports a character from Character Card Spec V2/V3 JSON payload.
 */
router.post('/import', requireAuth, loadTier, async (req, res) => {
  try {
    const cardData = req.body;
    // Extract standard V2/V3 fields
    const specData = cardData.data || cardData;

    const name = specData.name || cardData.name || 'Personaje Importado';
    const description = specData.description || specData.personality || 'Personaje importado desde Character Card';
    const firstMessage = specData.first_mes || specData.first_message || 'Hola, me alegra conocerte.';
    const systemPrompt = `Tu nombre es ${name}. ${specData.system_prompt || specData.personality || specData.description || ''} ${specData.scenario ? `Escenario: ${specData.scenario}` : ''}`;

    const { data, error } = await supabase
      .from('characters')
      .insert({
        creator_id: req.userId,
        is_official: false,
        name,
        tagline: 'Importado de la Comunidad',
        description,
        system_prompt: systemPrompt,
        first_message: firstMessage,
        avatar_url: specData.avatar_url || 'https://images.unsplash.com/photo-1517841905240-472988babdf9?w=400&auto=format&fit=crop&q=80',
        arquetipo_id: 'pareja',
        tier_required: 'free'
      })
      .select('*')
      .single();

    if (error) throw error;

    res.json(data);
  } catch (err) {
    console.error('Import character error:', err);
    res.status(500).json({ error: 'Error al importar la tarjeta de personaje' });
  }
});

/**
 * GET /api/characters/:id
 * Gets details of a specific character by ID.
 */
router.get('/:id', requireAuth, loadTier, async (req, res) => {
  try {
    const { id } = req.params;
    const { data, error } = await supabase
      .from('characters')
      .select('*')
      .eq('id', id)
      .single();

    if (error || !data) {
      return res.status(404).json({ error: 'Personaje no encontrado' });
    }

    res.json(data);
  } catch (err) {
    console.error('Get character detail error:', err);
    res.status(500).json({ error: 'Error al obtener detalle del personaje' });
  }
});

/**
 * DELETE /api/characters/:id
 * Deletes a custom character created by the authenticated user.
 */
router.delete('/:id', requireAuth, loadTier, async (req, res) => {
  try {
    const { id } = req.params;
    const { data, error } = await supabase
      .from('characters')
      .delete()
      .eq('id', id)
      .eq('creator_id', req.userId)
      .select('*');

    if (error || !data || data.length === 0) {
      return res.status(404).json({ error: 'Personaje no encontrado o no tienes permiso para eliminarlo' });
    }

    res.json({ ok: true, deleted: data[0] });
  } catch (err) {
    console.error('Delete character error:', err);
    res.status(500).json({ error: 'Error al eliminar personaje' });
  }
});

export default router;

