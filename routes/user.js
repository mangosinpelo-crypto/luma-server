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

/**
 * POST /api/user/reward
 * Decrements daily_message_count in Supabase upon watching a rewarded ad.
 */
router.post('/reward', async (req, res) => {
  try {
    const amount = Number(req.body.amount) || 5;
    const rewardAmount = Math.min(Math.max(amount, 1), 10);

    const { data: user } = await supabase
      .from('users')
      .select('daily_message_count')
      .eq('id', req.userId)
      .single();

    const currentCount = user?.daily_message_count || 0;
    const newCount = Math.max(0, currentCount - rewardAmount);

    const { error } = await supabase
      .from('users')
      .update({ daily_message_count: newCount })
      .eq('id', req.userId);

    if (error) throw error;

    res.json({ ok: true, dailyMessageCount: newCount });
  } catch (err) {
    console.error('Reward POST error:', err);
    res.status(500).json({ error: 'Error al otorgar recompensa' });
  }
});

export default router;
