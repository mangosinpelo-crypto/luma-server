import { Router } from 'express';
import supabase from '../services/supabase.js';
import { TIER_FEATURES } from '../middleware/tierCheck.js';

const router = Router();

/**
 * GET /api/user/me
 * Returns user profile with tier info and features.
 */
router.get('/me', async (req, res) => {
  try {
    const { data } = await supabase
      .from('users')
      .select('tier, daily_message_count, daily_internal_count, created_at')
      .eq('id', req.userId)
      .single();

    const tier = data?.tier || 'free';

    res.json({
      id: req.userId,
      email: req.userEmail,
      tier,
      features: TIER_FEATURES[tier] || TIER_FEATURES.free,
      dailyMessageCount: data?.daily_message_count || 0,
      dailyInternalCount: data?.daily_internal_count || 0,
      createdAt: data?.created_at
    });
  } catch (err) {
    console.error('User GET error:', err);
    res.status(500).json({ error: 'Error al obtener perfil' });
  }
});

export default router;
