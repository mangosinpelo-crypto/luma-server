# 🌙 Luma Server — Backend API

Backend Express.js para **Luma**, encargado de la gestión de usuarios, memoria emocional, integración con IA (DeepInfra/OpenRouter/Groq), límites de nivel (Free/Premium/Obsesión) y pagos con Stripe.

---

## 🛠️ Tecnologías

- **Node.js** (v18+) & **Express.js v5**
- **Supabase** (`@supabase/supabase-js`) — DB PostgreSQL y Auth JWT.
- **Stripe** — Checkout y Webhooks de suscripciones.
- **AI Streaming** — Integración con SSE para respuestas en tiempo real via DeepInfra / OpenRouter / Groq.

---

## 🚀 Despliegue en Producción (Deploy)

### 1. Configuración de Base de Datos en Supabase
Ejecuta el archivo [`schema.sql`](file:///root/luma-server/schema.sql) en el **SQL Editor** de tu panel de Supabase para crear las tablas requeridas:
- `users`
- `memory_state`
- `episodes`

### 2. Variables de Entorno (`.env`)
Configura las siguientes variables de entorno en tu plataforma de hosting (Render, Railway, Fly.io, Vercel, VPS, etc.):

| Variable | Descripción | Ejemplo |
|----------|-------------|---------|
| `PORT` | Puerto del servidor | `3001` |
| `FRONTEND_URL` | URL de la app frontend (para CORS y Stripe) | `https://luma-app.workers.dev` |
| `DEEPINFRA_API_KEY` | Key de API de DeepInfra (Recomendado) | `k5VwDfp...` |
| `FREE_MODEL` | Modelo para usuarios Free | `mistralai/Mistral-Nemo-Instruct-2407` |
| `PREMIUM_MODEL` | Modelo para usuarios Premium / Obsesión | `NousResearch/Hermes-3-Llama-3.1-70B` |
| `SUPABASE_URL` | URL del proyecto Supabase | `https://xxx.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | Service Role Secret (Backend Key) | `sb_secret_...` |
| `STRIPE_SECRET_KEY` | Key secreta de Stripe | `sk_live_...` |
| `STRIPE_WEBHOOK_SECRET` | Secret del Webhook de Stripe | `whsec_...` |
| `STRIPE_PRICE_PREMIUM` | ID de precio en Stripe para Premium | `price_1P...` |
| `STRIPE_PRICE_OBSESION` | ID de precio en Stripe para Obsesión | `price_1P...` |

### 3. Opciones de Deploy

#### Opción A: Render / Railway
1. Conecta tu repositorio de GitHub.
2. En Render, usa el archivo `render.yaml` o configura:
   - **Environment**: Node
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`

#### Opción B: Docker
```bash
docker build -t luma-server .
docker run -p 3001:3001 --env-file .env luma-server
```

---

## 💻 Desarrollo Local

```bash
# Instalar dependencias
npm install

# Copiar variables de entorno
cp .env.example .env

# Ejecutar en modo desarrollo con auto-reload
npm run dev
```

---

## 📡 Endpoints de la API

- **`GET /api/health`** — Estado del servicio (público)
- **`POST /api/chat/completions`** — Streaming de chat (requiere auth JWT)
- **`GET /api/user/me`** — Perfil de usuario y límites
- **`GET /api/memory`** — Cargar estado emocional y memoria
- **`POST /api/memory`** — Guardar estado emocional y memoria
- **`DELETE /api/memory`** — Reiniciar memoria
- **`GET /api/memory/episodes`** — Buscar episodios por palabras clave
- **`POST /api/memory/episodes`** — Guardar nuevo episodio
- **`POST /api/billing/checkout`** — Crear sesión de Stripe Checkout
- **`POST /api/billing/portal`** — Portal de gestión de suscripciones de Stripe
- **`POST /api/billing/webhook`** — Webhook de Stripe (procesa eventos de pago)
- **`GET /api/audio/voices`** — Configuración de voces TTS