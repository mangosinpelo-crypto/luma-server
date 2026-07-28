import supabase from '../services/supabase.js';

/**
 * Middleware: Verifies Supabase JWT from Authorization header.
 * Attaches req.userId and req.userEmail on success.
 */
export async function requireAuth(req, res, next) {
  if (req.method === 'OPTIONS') {
    return next();
  }

  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Token requerido' });
  }

  const token = authHeader.split(' ')[1];

  try {
    const { data: { user }, error } = await supabase.auth.getUser(token);

    if (error || !user) {
      return res.status(401).json({ error: 'Token inválido o expirado' });
    }

    req.userId = user.id;
    req.userEmail = user.email;
    next();
  } catch (err) {
    console.error('Auth middleware error:', err);
    return res.status(500).json({ error: 'Error de autenticación' });
  }
}
