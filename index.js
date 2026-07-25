import express from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import dotenv from 'dotenv';

dotenv.config();

import path from 'path';
import { fileURLToPath } from 'url';
import { requireAuth } from './middleware/auth.js';
import { loadTier } from './middleware/tierCheck.js';
import chatRoutes from './routes/chat.js';
import memoryRoutes from './routes/memory.js';
import billingRoutes, { handleStripeWebhook } from './routes/billing.js';
import crypto from 'crypto';
import userRoutes from './routes/user.js';
import audioRoutes from './routes/audio.js';
import telemetryRoutes from './routes/telemetry.js';
import { requireAdmin, requireAdminIP } from './middleware/security.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.set('trust proxy', 1);
const PORT = process.env.PORT || 3001;

// Trace ID & HTTP Security Headers
app.use((req, res, next) => {
  const traceId = req.headers['x-request-id'] || crypto.randomUUID();
  req.traceId = traceId;
  res.setHeader('X-Request-ID', traceId);

  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  next();
});

// Request Logger with Trace ID
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] [Trace: ${req.traceId}] ${req.method} ${req.url}`);
  next();
});


// Serve static files from public directory
app.use(express.static(path.join(__dirname, 'public')));

// Web Dashboard route (Gated by IP Whitelist + UI prompts for X-Admin-Key)
app.get('/dashboard', requireAdminIP, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});




// CORS Configuration
const allowedOrigins = [
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  process.env.FRONTEND_URL,
].filter(Boolean);

app.use(cors({
  origin: function (origin, callback) {
    if (!origin) return callback(null, true);
    const isAllowed = allowedOrigins.some(allowed => {
      if (!allowed) return false;
      const cleanAllowed = allowed.replace(/\/$/, '');
      const cleanOrigin = origin.replace(/\/$/, '');
      return cleanOrigin === cleanAllowed;
    });

    if (isAllowed) {
      return callback(null, true);
    }
    return callback(new Error('Acceso no permitido por políticas de CORS'));
  },
  credentials: true
}));


// Stripe webhook needs raw body — must be BEFORE json parser
app.post('/api/billing/webhook',
  express.raw({ type: 'application/json' }),
  handleStripeWebhook
);

// JSON body parser for everything else
app.use(express.json({ limit: '1mb' }));

// Global rate limit: 100 requests per minute per IP
const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiadas peticiones. Intenta de nuevo en un minuto.' }
});
app.use('/api/', limiter);

// Strict rate limit for chat: 15 requests per minute per IP
const chatLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 15,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Límite de chat alcanzado. Espera un momento.' }
});
app.use('/api/chat', chatLimiter);

// Health check & Telemetry (Public / Administrative)
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', name: 'Luma API', version: '1.0.0' });
});
app.use('/api/telemetry', telemetryRoutes);

import characterRoutes from './routes/characters.js';

// Root API Welcome Response
app.get('/', (req, res) => {
  res.json({
    name: 'Luma AI Backend API',
    version: '1.0.0',
    status: 'online',
    documentation: {
      health: 'GET /api/health',
      chat: 'POST /api/chat/completions',
      characters: 'GET /api/characters',
      memory: 'GET/POST /api/memory',
      user: 'GET /api/user/me',
      dashboard: 'GET /dashboard'
    }
  });
});

// All API routes
app.use('/api/chat', requireAuth, loadTier, chatRoutes);
app.use('/api/memory', requireAuth, loadTier, memoryRoutes);
app.use('/api/billing', requireAuth, loadTier, billingRoutes);
app.use('/api/user', requireAuth, loadTier, userRoutes);
app.use('/api/audio', requireAuth, loadTier, audioRoutes);
app.use('/api/characters', characterRoutes);



// Start server
app.listen(PORT, () => {
  console.log(`🌙 Luma API running on http://localhost:${PORT}`);
  console.log(`📊 Telemetry Dashboard available on http://localhost:${PORT}/dashboard`);
  console.log(`   Free model:    ${process.env.FREE_MODEL || 'google/gemma-2-9b-it:free'}`);
  console.log(`   Premium model: ${process.env.PREMIUM_MODEL || 'google/gemma-2-9b-it:free'}`);
});

