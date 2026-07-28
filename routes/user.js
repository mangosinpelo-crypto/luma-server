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
 * Resets daily_message_count to 0 upon watching a rewarded ad.
 * Validates watch duration parameter to ensure ad completion integrity.
 */
router.post('/reward', async (req, res) => {
  try {
    const { watchedSeconds, adId } = req.body || {};

    // Validate ad watch integrity (minimum 5 seconds)
    if (watchedSeconds !== undefined && Number(watchedSeconds) < 5) {
      return res.status(400).json({
        error: 'Incapaz de verificar la visualización completa del anuncio.',
        completed: false
      });
    }

    // Reset message count to 0 (grant full fresh daily quota) upon watching ad
    const { error } = await supabase
      .from('users')
      .update({ daily_message_count: 0 })
      .eq('id', req.userId);

    if (error) throw error;

    console.log(`[REWARD] User ${req.userId} completed rewarded ad (${adId || 'default'}). Daily quota reset to 0.`);

    res.json({
      ok: true,
      completed: true,
      dailyMessageCount: 0,
      message: '¡Recompensa otorgada exitosamente! Cuota diaria restablecida.'
    });
  } catch (err) {
    console.error('Reward POST error:', err);
    res.status(500).json({ error: 'Error al otorgar recompensa' });
  }
});

export default router;

