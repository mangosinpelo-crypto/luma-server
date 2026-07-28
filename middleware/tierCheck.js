import supabase from '../services/supabase.js';

// Feature definitions per tier
const TIER_FEATURES = {
  free: {
    maxMessagesPerDay: 15,
    maxInternalPerDay: 15,
    arquetipos: ['pareja', 'rival', 'amigaToxica', 'ex', 'mejorAmigo'],
    autonomousMessages: false,
    evolution: false,
    multipleCharacters: true,
    customArchetype: true,
    realLifeMode: false,
    exportHistory: false
  },
  premium: {
    maxMessagesPerDay: Infinity,
    maxInternalPerDay: Infinity,
    arquetipos: ['pareja', 'amigaToxica', 'rival', 'ex', 'mejorAmigo'],
    autonomousMessages: true,
    evolution: true,
    multipleCharacters: true,
    customArchetype: true,
    realLifeMode: false,
    exportHistory: false
  },
  obsesion: {
    maxMessagesPerDay: Infinity,
    maxInternalPerDay: Infinity,
    arquetipos: ['pareja', 'amigaToxica', 'rival', 'ex', 'mejorAmigo'],
    autonomousMessages: true,
    evolution: true,
    multipleCharacters: true,
    customArchetype: true,
    realLifeMode: true,
    exportHistory: true
  }
};

/**
 * Middleware: Loads user tier and attaches tier info to request.
 * Must be used AFTER requireAuth.
 */
export async function loadTier(req, res, next) {
  if (req.method === 'OPTIONS') {
    return next();
  }
  try {
    const { data, error } = await supabase
      .from('users')
      .select('tier, daily_message_count, daily_internal_count, daily_message_reset')
      .eq('id', req.userId)
      .single();

    if (error || !data) {
      // User doesn't exist in users table yet, create with free tier and default mejorAmigo archetype
      const { error: insertError } = await supabase
        .from('users')
        .insert({ id: req.userId, tier: 'free', arquetipo_id: 'mejorAmigo' });

      if (insertError) console.error('Error creating user row:', insertError);

      req.tier = 'free';
      req.tierFeatures = TIER_FEATURES.free;
      req.dailyMessageCount = 0;
      req.dailyInternalCount = 0;
      return next();
    }

    req.tier = data.tier || 'free';
    req.tierFeatures = TIER_FEATURES[req.tier] || TIER_FEATURES.free;

    // Enforce archetype consistency for free tier in database
    if (req.tier === 'free' && (!data.arquetipo_id || !isArchetypeAllowed('free', data.arquetipo_id))) {
      await supabase
        .from('users')
        .update({ arquetipo_id: 'mejorAmigo' })
        .eq('id', req.userId);
      data.arquetipo_id = 'mejorAmigo';
    }

    // Reset daily counter if it's a new day
    const resetDate = new Date(data.daily_message_reset);
    const now = new Date();
    if (resetDate.toDateString() !== now.toDateString()) {
      await supabase
        .from('users')
        .update({ daily_message_count: 0, daily_internal_count: 0, daily_message_reset: now.toISOString() })
        .eq('id', req.userId);
      data.daily_message_count = 0;
      data.daily_internal_count = 0;
    }

    req.dailyMessageCount = data.daily_message_count || 0;
    req.dailyInternalCount = data.daily_internal_count || 0;
    next();
  } catch (err) {
    console.error('Tier check error:', err);
    req.tier = 'free';
    req.tierFeatures = TIER_FEATURES.free;
    req.dailyMessageCount = 0;
    req.dailyInternalCount = 0;
    next();
  }
}

/**
 * Middleware factory: requires a specific feature.
 */
export function requireFeature(featureName) {
  return (req, res, next) => {
    if (!req.tierFeatures || !req.tierFeatures[featureName]) {
      return res.status(403).json({
        error: 'Feature no disponible en tu plan',
        feature: featureName,
        currentTier: req.tier,
        upgrade: true
      });
    }
    next();
  };
}

export function isArchetypeAllowed(tier, arquetipoId) {
  if (!arquetipoId) return true; // fallback to default archetype if unspecified
  if (typeof arquetipoId === 'string' && (arquetipoId.startsWith('custom_') || arquetipoId.startsWith('imported_'))) return true;
  const features = TIER_FEATURES[tier] || TIER_FEATURES.free;
  return Array.isArray(features.arquetipos) && features.arquetipos.includes(arquetipoId);
}

export { TIER_FEATURES };

