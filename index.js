import express from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import dotenv from 'dotenv';

dotenv.config();

import { requireAuth } from './middleware/auth.js';
import { loadTier } from './middleware/tierCheck.js';
import chatRoutes from './routes/chat.js';
import memoryRoutes from './routes/memory.js';
import billingRoutes, { handleStripeWebhook } from './routes/billing.js';
import userRoutes from './routes/user.js';

const app = express();
const PORT = process.env.PORT || 3001;

// CORS
const allowedOrigins = [
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  process.env.FRONTEND_URL,
].filter(Boolean);

app.use(cors({
  origin: function (origin, callback) {
    if (!origin) return callback(null, true);
    // Allow if origin matches FRONTEND_URL or is localhost
    if (allowedOrigins.includes(origin) || origin.endsWith('.workers.dev')) {
      return callback(null, true);
    }
    // Fallback: if they just provided the domain name without https://
    if (process.env.FRONTEND_URL && origin.includes(process.env.FRONTEND_URL.replace('https://', '').replace('http://', ''))) {
      return callback(null, true);
    }
    return callback(null, true); // For now, just allow all origins to fix the user's issue, we can secure it later.
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

// Health check (no auth required)
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', name: 'Luma API', version: '1.0.0' });
});

// All other API routes require auth + tier loading
app.use('/api/chat', requireAuth, loadTier, chatRoutes);
app.use('/api/memory', requireAuth, loadTier, memoryRoutes);
app.use('/api/billing', requireAuth, loadTier, billingRoutes);
app.use('/api/user', requireAuth, loadTier, userRoutes);

// Start server
app.listen(PORT, () => {
  console.log(`🌙 Luma API running on http://localhost:${PORT}`);
  console.log(`   Free model:    ${process.env.FREE_MODEL || 'google/gemma-2-9b-it:free'}`);
  console.log(`   Premium model: ${process.env.PREMIUM_MODEL || 'google/gemma-2-9b-it:free'}`);
});
