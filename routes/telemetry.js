import { Router } from 'express';
import supabase from '../services/supabase.js';
import { requireAdmin, requireAdminIP, getSecurityTelemetry } from '../middleware/security.js';

const router = Router();

// Protect all telemetry administrative routes with IP Whitelist + Admin Key
router.use(requireAdminIP);
router.use(requireAdmin);


/**
 * GET /api/telemetry/summary
 * Returns global token usage summary, estimated USD costs, and breakdown by user tier.
 */
router.get('/summary', async (req, res) => {
  try {
    const { data: users, error } = await supabase
      .from('users')
      .select('tier, total_input_tokens, total_output_tokens, estimated_cost_usd, total_chats_count');

    if (error) throw error;

    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let totalEstimatedCostUSD = 0;
    let totalChats = 0;

    const tierBreakdown = {
      free: { count: 0, inputTokens: 0, outputTokens: 0, costUSD: 0 },
      premium: { count: 0, inputTokens: 0, outputTokens: 0, costUSD: 0 },
      obsesion: { count: 0, inputTokens: 0, outputTokens: 0, costUSD: 0 }
    };

    (users || []).forEach(u => {
      const input = Number(u.total_input_tokens) || 0;
      const output = Number(u.total_output_tokens) || 0;
      const cost = Number(u.estimated_cost_usd) || 0;
      const chats = Number(u.total_chats_count) || 0;
      const tier = u.tier && tierBreakdown[u.tier] ? u.tier : 'free';

      totalInputTokens += input;
      totalOutputTokens += output;
      totalEstimatedCostUSD += cost;
      totalChats += chats;

      tierBreakdown[tier].count += 1;
      tierBreakdown[tier].inputTokens += input;
      tierBreakdown[tier].outputTokens += output;
      tierBreakdown[tier].costUSD += cost;
    });

    const avgCostPerChat = totalChats > 0 ? (totalEstimatedCostUSD / totalChats) : 0;
    const avgCostPerUser = users?.length > 0 ? (totalEstimatedCostUSD / users.length) : 0;

    res.json({
      totalUsers: users?.length || 0,
      totalChats,
      totalInputTokens,
      totalOutputTokens,
      totalTokens: totalInputTokens + totalOutputTokens,
      totalEstimatedCostUSD: Number(totalEstimatedCostUSD.toFixed(6)),
      avgCostPerChat: Number(avgCostPerChat.toFixed(6)),
      avgCostPerUser: Number(avgCostPerUser.toFixed(6)),
      tierBreakdown
    });
  } catch (err) {
    console.error('Telemetry summary error:', err);
    res.status(500).json({ error: 'Error al obtener resumen de telemetría' });
  }
});

/**
 * GET /api/telemetry/top-users
 * Returns top users ordered by estimated cost USD.
 */
router.get('/top-users', async (req, res) => {
  try {
    const { data: users, error } = await supabase
      .from('users')
      .select('id, tier, total_input_tokens, total_output_tokens, estimated_cost_usd, total_chats_count, created_at')
      .order('estimated_cost_usd', { ascending: false })
      .limit(10);

    if (error) throw error;

    res.json(users || []);
  } catch (err) {
    console.error('Telemetry top users error:', err);
    res.status(500).json({ error: 'Error al obtener usuarios de mayor consumo' });
  }
});

/**
 * GET /api/telemetry/security-events
 * Returns security incidents log, breakdown, and active banned IP/user accounts.
 */
router.get('/security-events', (req, res) => {
  try {
    const securityData = getSecurityTelemetry();
    res.json(securityData);
  } catch (err) {
    console.error('Telemetry security events error:', err);
    res.status(500).json({ error: 'Error al obtener eventos de seguridad' });
  }
});

export default router;

