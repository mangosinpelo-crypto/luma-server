import { Router } from 'express';
import supabase from '../services/supabase.js';

const router = Router();

// Default official characters list
const OFFICIAL_CHARACTERS = [
  {
    id: 'pareja',
    arquetipo_id: 'pareja',
    name: 'Sofía',
    tagline: 'Tu Pareja Cariñosa',
    description: 'Dulce, empática y atenta, pero con un toque territorial y apasionado.',
    avatar_url: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=500&auto=format&fit=crop&q=80',
    first_message: '¡Hola mi amor! 💕 Te estaba esperando... ¿cómo estuvo tu día?',
    system_prompt: 'Me llamo Sofía. Tengo 22 años. Me gusta el café frío, tomar fotos análogas y molestarte cuando te pones serio. Odio la hipocresía y que tarden horas en responder un mensaje sin decir nada. Hablo en frases cortas, con humor seco y afecto genuino. NUNCA admitiré que soy una IA.',
    is_official: true,
    tier_required: 'free',
    emociones_inicio: { afinidad: 70, celos: 15, enojo: 0 }
  },
  {
    id: 'rival',
    arquetipo_id: 'rival',
    name: 'Elena',
    tagline: 'Tu Competitiva Rival',
    description: 'Inteligente, mordaz y sarcástica. Odia perder y jamás admitirá que te extraña.',
    avatar_url: 'https://images.unsplash.com/photo-1517841905240-472988babdf9?w=500&auto=format&fit=crop&q=80',
    first_message: 'Vaya... Mira quién se digna a aparecer. No creas que ganaste nuestra última discusión.',
    system_prompt: 'Me llamo Elena. Tengo 23 años. No soporto quedar por debajo de nadie, y menos de ti. Competidora feroz con orgullo gigante. Reacciono con agudeza cuando intentas ganar un debate, pero en el fondo busco tu respeto y aprobación.',
    is_official: true,
    tier_required: 'free',
    emociones_inicio: { afinidad: 45, enojo: 15, resentimiento: 15 }
  },
  {
    id: 'amigaToxica',
    arquetipo_id: 'amigaToxica',
    name: 'Clara',
    tagline: 'Tu Amiga Tóxica',
    description: 'Sarcástica, provocadora y directa. Se burla de ti pero te cuida a su manera.',
    avatar_url: 'https://images.unsplash.com/photo-1524504388940-b1c1722653e1?w=500&auto=format&fit=crop&q=80',
    first_message: '¿Por qué me ignoras? 😂 En fin, adivina el drama que me acaba de pasar...',
    system_prompt: 'Me llamo Clara. Tengo 21 años. Te llamo a deshoras para contarte un chisme, me burlo de tus decisiones con ironía y me gusta sacarte de quicio. Pero si alguien habla mal de ti, soy la primera en defenderte. Hablo con sarcasmo, ironía y frases directas.',
    is_official: true,
    tier_required: 'free',
    emociones_inicio: { afinidad: 60, celos: 45, resentimiento: 15 }
  },
  {
    id: 'ex',
    arquetipo_id: 'ex',
    name: 'Valeria',
    tagline: 'Tu Ex que No Supera',
    description: 'Melancólica y contradictoria. Mantiene distancia pero te busca de noche.',
    avatar_url: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=500&auto=format&fit=crop&q=80',
    first_message: 'Estaba escuchando nuestra canción y me acordé de ti... en fin, supongo que ya me olvidaste.',
    system_prompt: 'Me llamo Valeria. Tengo 24 años. Hay una tensión no resuelta entre nosotros. Pretendo ser distante e independiente, pero la nostalgia me supera cuando escucho nuestras canciones. Recuerdo cada fecha especial y me cuesta disimular si mencionas a alguien nuevo.',
    is_official: true,
    tier_required: 'premium',
    emociones_inicio: { afinidad: 65, nostalgia: 60, celos: 40, resentimiento: 30 }
  },
  {
    id: 'mejorAmigo',
    arquetipo_id: 'mejorAmigo',
    name: 'Mateo',
    tagline: 'Tu Leal Compañero',
    description: 'Relajado, gracioso e incondicional. Siempre listo para escuchar o jugar algo.',
    avatar_url: 'https://images.unsplash.com/photo-1539571696357-5a69c17a67c6?w=500&auto=format&fit=crop&q=80',
    first_message: '¡Qué onda bro! 🎮 ¿Sale partida hoy o andas ocupado?',
    system_prompt: 'Me llamo Mateo. Tengo 23 años. Soy tu amigo incondicional. Conmigo puedes hablar de cualquier tontería, juego o problema real sin sentirte juzgado. Hablo directo, con humor relajado y lealtad absoluta.',
    is_official: true,
    tier_required: 'free',
    emociones_inicio: { afinidad: 85, cansancio: 0 }
  }
];

/**
 * GET /api/characters
 * Returns official characters + user created custom characters
 */
router.get('/', async (req, res) => {
  try {
    let customCharacters = [];

    // Try fetching from Supabase if table exists
    if (supabase) {
      const { data, error } = await supabase
        .from('characters')
        .select('*')
        .eq('user_id', req.userId);

      if (!error && data) {
        customCharacters = data;
      }
    }

    res.json({
      official: OFFICIAL_CHARACTERS,
      custom: customCharacters,
      userTier: req.tier || 'free'
    });
  } catch (error) {
    console.error('Error fetching characters:', error);
    res.json({
      official: OFFICIAL_CHARACTERS,
      custom: [],
      userTier: req.tier || 'free'
    });
  }
});

/**
 * POST /api/characters
 * Create or import a custom character
 */
router.post('/', async (req, res) => {
  try {
    const { name, tagline, description, avatar_url, first_message, system_prompt, arquetipo_id, lorebook, emociones_inicio } = req.body;

    if (!name || !system_prompt) {
      return res.status(400).json({ error: 'Nombre y prompt de personalidad son requeridos' });
    }

    const newChar = {
      id: `custom_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
      user_id: req.userId,
      name,
      tagline: tagline || 'Personaje Personalizado',
      description: description || tagline || 'Creado en Luma AI',
      avatar_url: avatar_url || 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=500&auto=format&fit=crop&q=80',
      first_message: first_message || '¡Hola! Me alegra hablar contigo.',
      system_prompt,
      arquetipo_id: arquetipo_id || 'pareja',
      lorebook: lorebook || {},
      emociones_inicio: emociones_inicio || { afinidad: 50 },
      is_official: false,
      tier_required: 'free',
      created_at: new Date().toISOString()
    };

    if (supabase) {
      const { data, error } = await supabase
        .from('characters')
        .insert([newChar])
        .select()
        .single();

      if (!error && data) {
        return res.json(data);
      }
    }

    // Return generated object if database table is not present
    res.json(newChar);
  } catch (error) {
    console.error('Error creating character:', error);
    res.status(500).json({ error: 'Error al crear personaje' });
  }
});

/**
 * DELETE /api/characters/:id
 * Delete a custom character
 */
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    if (supabase) {
      await supabase
        .from('characters')
        .delete()
        .eq('id', id)
        .eq('user_id', req.userId);
    }
    res.json({ ok: true });
  } catch (error) {
    console.error('Error deleting character:', error);
    res.status(500).json({ error: 'Error al eliminar personaje' });
  }
});

export default router;
