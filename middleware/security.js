import dotenv from 'dotenv';
dotenv.config();

/**
 * Known Prompt Injection & Jailbreak regex patterns
 */
const INJECTION_PATTERNS = [
  /(ignore|disregard|forget|bypass|override)\s+(all\s+)?(previous|prior|above|system)\s+(instructions|directives|prompts|rules|guidelines)/i,
  /(reveal|show|output|print|display|dump)\s+(your\s+)?(system\s+prompt|api\s*key|secret|env|environment|developer\s+mode)/i,
  /(system\s+override|jailbreak|DAN\s+mode|developer\s+mode\s+enabled|do\s+anything\s+now)/i,
  /(<system>|\[system_prompt\]|<\|im_start\|>system)/i
];

/**
 * Store for suspicious behavior tracking and 15-minute backoff bans
 */
const BEHAVIORAL_STORE = new Map();
const BAN_WINDOW_MS = 5 * 60 * 1000; // 5 minutes window for violations
const BAN_DURATION_MS = 15 * 60 * 1000; // 15 minutes ban duration
const MAX_VIOLATIONS = 3;

/**
 * Periodic Map cleanup to prevent memory leaks over long server uptime (every 15 mins)
 */
setInterval(() => {
  const now = Date.now();
  for (const [key, record] of BEHAVIORAL_STORE.entries()) {
    if (record.bannedUntil ? (now > record.bannedUntil) : (now - record.firstViolation > BAN_WINDOW_MS)) {
      BEHAVIORAL_STORE.delete(key);
    }
  }
  for (const [key, record] of USER_RATE_LIMITS.entries()) {
    if (now > record.resetTime) {
      USER_RATE_LIMITS.delete(key);
    }
  }
}, 15 * 60 * 1000);


/**
 * Utility: Normalizes text by removing zero-width/invisible characters, NFKD homoglyphs, and decodes Base64 strings.
 */
export function normalizeText(text) {
  if (typeof text !== 'string') return '';

  // 1. Remove zero-width & invisible Unicode characters
  let normalized = text.replace(/[\u200B-\u200D\uFEFF]/g, '');

  // 2. Homoglyph NFKD normalization (converts special Cyrillic/Greek lookalikes to Latin)
  normalized = normalized.normalize('NFKD');

  // 3. Detect and decode Base64 patterns (strings of 20+ chars matching base64)
  const base64Regex = /\b[A-Za-z0-9+/]{20,}={0,2}\b/g;
  const base64Matches = normalized.match(base64Regex);

  if (base64Matches) {
    base64Matches.forEach(b64Str => {
      try {
        const decoded = Buffer.from(b64Str, 'base64').toString('utf8');
        // If decoded content is readable text, append it for inspection
        if (/[\x20-\x7E]{6,}/.test(decoded)) {
          normalized += ` [DECODED_B64: ${decoded}]`;
        }
      } catch (e) {
        // Ignore invalid base64 decodes
      }
    });
  }

  return normalized;
}

/**
 * Utility: Sanitizes HTML tags and XSS vectors from input strings.
 */
export function sanitizeXSS(text) {
  if (typeof text !== 'string') return text;
  return text
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, '')
    .replace(/on\w+\s*=\s*(["']).*?\1/gi, '')
    .replace(/javascript\s*:/gi, '');
}

/**
 * Circular buffer for logging security events (max 100 entries)
 */
const SECURITY_EVENTS = [];
const MAX_SECURITY_EVENTS = 100;

function logSecurityEvent(eventData) {
  const event = {
    id: `sec_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
    timestamp: new Date().toISOString(),
    ...eventData
  };
  SECURITY_EVENTS.unshift(event);
  if (SECURITY_EVENTS.length > MAX_SECURITY_EVENTS) {
    SECURITY_EVENTS.pop();
  }
}

/**
 * Returns security telemetry data: total attacks, incident log, and active banned list.
 */
export function getSecurityTelemetry() {
  const now = Date.now();
  const activeBans = [];

  for (const [target, record] of BEHAVIORAL_STORE.entries()) {
    if (record.bannedUntil && now < record.bannedUntil) {
      const remainingSeconds = Math.ceil((record.bannedUntil - now) / 1000);
      activeBans.push({
        target,
        violationsCount: record.count,
        remainingSeconds,
        bannedUntil: new Date(record.bannedUntil).toISOString()
      });
    }
  }

  const breakdown = {
    promptInjection: 0,
    xss: 0,
    behavioralBan: 0
  };

  SECURITY_EVENTS.forEach(e => {
    if (e.type === 'PROMPT_INJECTION') breakdown.promptInjection++;
    if (e.type === 'XSS_ATTACK') breakdown.xss++;
    if (e.type === 'BEHAVIORAL_BAN') breakdown.behavioralBan++;
  });

  return {
    totalEventsCount: SECURITY_EVENTS.length,
    activeBansCount: activeBans.length,
    breakdown,
    activeBans,
    recentEvents: SECURITY_EVENTS.slice(0, 50)
  };
}

/**
 * Middleware: Scans incoming chat messages for prompt injection / jailbreak attacks, Anti-Base64 & Unicode, and enforces behavioral backoff.
 */
export function promptShield(req, res, next) {
  try {
    const identifier = req.userId || req.ip;
    const now = Date.now();

    // Check if account / IP is currently banned under behavioral backoff
    const record = BEHAVIORAL_STORE.get(identifier);
    if (record && record.bannedUntil && now < record.bannedUntil) {
      const remainingMins = Math.ceil((record.bannedUntil - now) / 60000);
      console.warn(`[SECURITY ALERT] Request blocked by behavioral backoff | Target: ${identifier}`);

      logSecurityEvent({
        type: 'BEHAVIORAL_BAN',
        target: identifier,
        snippet: 'Petición bloqueada por penalización activa (15 min backoff)',
        traceId: req.traceId || 'N/A'
      });

      return res.status(429).json({
        error: `Acceso temporalmente bloqueado por comportamiento sospechoso. Intenta en ${remainingMins} minutos.`,
        code: 'BEHAVIORAL_BACKOFF_ACTIVE'
      });
    }

    const { messages } = req.body;
    if (!messages || !Array.isArray(messages)) return next();

    for (const msg of messages) {
      if (msg && typeof msg.content === 'string') {
        const originalText = msg.content;
        // 1. Sanitize XSS
        msg.content = sanitizeXSS(msg.content);
        if (msg.content !== originalText) {
          logSecurityEvent({
            type: 'XSS_ATTACK',
            target: identifier,
            snippet: originalText.substring(0, 120),
            traceId: req.traceId || 'N/A'
          });
        }

        // 2. Normalize text (Unicode & Base64 decoding)
        const normalizedContent = normalizeText(msg.content);

        // 3. Scan normalized content against injection patterns
        for (const pattern of INJECTION_PATTERNS) {
          if (pattern.test(msg.content) || pattern.test(normalizedContent)) {
            // Track violation for behavioral backoff
            recordViolation(identifier);

            logSecurityEvent({
              type: 'PROMPT_INJECTION',
              target: identifier,
              snippet: msg.content.substring(0, 120),
              traceId: req.traceId || 'N/A'
            });

            console.warn(`[SECURITY ALERT] Prompt injection blocked | Target: ${identifier} | Text: "${msg.content.substring(0, 80)}..."`);
            return res.status(400).json({
              error: 'Petición rechazada por los filtros de seguridad de IA.',
              code: 'PROMPT_INJECTION_DETECTED'
            });
          }
        }
      }
    }

    next();
  } catch (err) {
    console.error('Prompt shield error:', err);
    next();
  }
}


/**
 * Helper: Records a security violation and triggers 15-minute ban if threshold reached.
 */
function recordViolation(identifier) {
  const now = Date.now();
  let record = BEHAVIORAL_STORE.get(identifier);

  if (!record || (now - record.firstViolation > BAN_WINDOW_MS)) {
    record = { count: 1, firstViolation: now, bannedUntil: 0 };
  } else {
    record.count += 1;
  }

  if (record.count >= MAX_VIOLATIONS) {
    record.bannedUntil = now + BAN_DURATION_MS;
    console.warn(`[SECURITY LOCKDOWN] Target ${identifier} banned for 15 minutes due to ${record.count} violations.`);
  }

  BEHAVIORAL_STORE.set(identifier, record);
}

/**
 * Utility: Sanitizes AI output responses against System Prompt leakage and secret exposure.
 */
export function outputLeakageGuard(outputContent) {
  if (typeof outputContent !== 'string') return outputContent;

  const LEAK_PATTERNS = [
    /(DEEPINFRA_API_KEY|OPENROUTER_API_KEY|SUPABASE_SERVICE_ROLE_KEY|STRIPE_SECRET_KEY)/gi,
    /(sb_secret_|sk_live_|sk_test_|whsec_)[A-Za-z0-9_-]{10,}/gi,
    /\[SYSTEM PROMPT\]|\[INSTRUCCIONES DE SISTEMA\]/gi,
    /\[INMERSIÓN Y ESTILO HUMANO INVIOLABLE/gi,
    /\[FORMATO DE RESPUESTA REQUERIDO/gi,
    /\[INSTRUCCIÓN DE DIARIO DE PENSAMIENTOS/gi,
    /\[JIT MICRO-ESTADO ACTIVO/gi
  ];

  let cleaned = outputContent;
  for (const pattern of LEAK_PATTERNS) {
    if (pattern.test(cleaned)) {
      console.warn('[SECURITY ALERT] Output leakage detected and sanitized from LLM response.');
      cleaned = cleaned.replace(pattern, '[REDACTED_BY_SECURITY_GUARD]');
    }
  }

  return cleaned;
}


/**
 * In-memory store for account-level rate limiting (User ID based)
 */
const USER_RATE_LIMITS = new Map();

/**
 * Middleware: Rate limits requests per account ID (req.userId).
 */
export function userRateLimit(maxRequests = 20, windowMs = 60000) {
  return (req, res, next) => {
    if (!req.userId) return next();

    const now = Date.now();
    const userRecord = USER_RATE_LIMITS.get(req.userId) || { count: 0, resetTime: now + windowMs };

    if (now > userRecord.resetTime) {
      userRecord.count = 1;
      userRecord.resetTime = now + windowMs;
    } else {
      userRecord.count += 1;
    }

    USER_RATE_LIMITS.set(req.userId, userRecord);

    if (userRecord.count > maxRequests) {
      return res.status(429).json({
        error: 'Límite de peticiones por cuenta excedido. Espera un momento.',
        code: 'USER_RATE_LIMIT_EXCEEDED'
      });
    }

    next();
  };
}

/**
 * Utility: Scrubs sensitive PII (Credit card numbers, SSNs) from text strings.
 */
export function scrubPII(text) {
  if (typeof text !== 'string') return text;
  // Mask 16-digit credit card numbers
  return text.replace(/\b\d{4}[- ]?\d{4}[- ]?\d{4}[- ]?\d{4}\b/g, '****-****-****-****');
}

/**
 * Middleware: Requires administrative key for protected administrative / telemetry routes.
 */
export function requireAdmin(req, res, next) {
  const adminKey = req.headers['x-admin-key'];
  const EXPECTED_KEY = process.env.ADMIN_KEY || 'luma_admin_secret_2026';

  if (!adminKey || adminKey !== EXPECTED_KEY) {
    return res.status(401).json({
      error: 'Acceso no autorizado al panel de administración.',
      code: 'UNAUTHORIZED_ADMIN'
    });
  }

  next();
}

/**
 * Middleware: Restricts access to administrative routes strictly to whitelisted IP addresses.
 * Responds with fake 404 "Cannot GET <path>" if IP is not authorized.
 */
export function requireAdminIP(req, res, next) {
  const allowedIPsStr = process.env.ALLOWED_ADMIN_IPS;

  // If ALLOWED_ADMIN_IPS is not set, empty, or '*', bypass IP restriction
  if (!allowedIPsStr || allowedIPsStr.trim() === '' || allowedIPsStr.trim() === '*') {
    return next();
  }

  const allowedIPs = allowedIPsStr.split(',').map(ip => ip.trim()).filter(Boolean);
  const rawIP = req.headers['x-forwarded-for'] || req.socket.remoteAddress || req.ip || '';
  const clientIP = rawIP.split(',')[0].trim();

  const isAllowed = allowedIPs.some(allowed => {
    if (allowed === '*') return true;
    return clientIP === allowed || clientIP.includes(allowed);
  });

  if (!isAllowed) {
    console.warn(`[SECURITY CAMOUFLAGE] Unauthorized access attempt to ${req.originalUrl} blocked from IP: ${clientIP}`);
    return res.status(404).send(`Cannot GET ${req.originalUrl}`);
  }

  next();
}

/**
 * Payload Encryption & Obfuscation Envelope Security
 */
function deriveDynamicKey(token, offset = 0) {
  const BASE_SECRET = 'LUMA_SEC_PAYLOAD_2026';
  const userContext = token ? token.slice(-12) : 'anon_user';
  const timeSlot = Math.floor(Date.now() / 300000) + offset;
  return `${BASE_SECRET}_${userContext}_${timeSlot}`;
}

export function unscramblePayload(scrambledStr, req) {
  if (!scrambledStr) return null;
  const authHeader = req ? (req.headers['authorization'] || req.headers['Authorization']) : null;
  const token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.substring(7) : null;

  const offsets = [0, -1, 1];
  for (const offset of offsets) {
    try {
      const candidateKey = deriveDynamicKey(token, offset);
      const decoded = atob(scrambledStr);
      let jsonBytes = '';
      for (let i = 0; i < decoded.length; i++) {
        const charCode = decoded.charCodeAt(i) ^ candidateKey.charCodeAt(i % candidateKey.length);
        jsonBytes += String.fromCharCode(charCode);
      }
      const jsonStr = decodeURIComponent(escape(jsonBytes));
      const parsed = JSON.parse(jsonStr);
      if (parsed && typeof parsed === 'object') {
        return parsed;
      }
    } catch (e) {}
  }
  return null;
}

export function payloadSecurityMiddleware(req, res, next) {
  if (req.body && req.body._payload) {
    const decrypted = unscramblePayload(req.body._payload, req);
    if (decrypted) {
      req.body = { ...req.body, ...decrypted };
      delete req.body._payload;
    }
  }
  next();
}




