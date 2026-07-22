-- ═══════════════════════════════════════════════════════════
-- LUMA SERVER — ESQUEMA DE BASE DE DATOS PARA SUPABASE (schema.sql)
-- Ejecuta este script en el Editor SQL de tu proyecto en Supabase
-- ═══════════════════════════════════════════════════════════

-- 1. Tabla de Usuarios
CREATE TABLE IF NOT EXISTS public.users (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    tier TEXT NOT NULL DEFAULT 'free',
    daily_message_count INT NOT NULL DEFAULT 0,
    daily_internal_count INT NOT NULL DEFAULT 0,
    daily_message_reset TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    stripe_customer_id TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. Tabla de Memoria y Estado Emocional
CREATE TABLE IF NOT EXISTS public.memory_state (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL UNIQUE REFERENCES public.users(id) ON DELETE CASCADE,
    afinidad INT NOT NULL DEFAULT 50,
    enojo INT NOT NULL DEFAULT 0,
    cansancio INT NOT NULL DEFAULT 0,
    ansiedad INT NOT NULL DEFAULT 0,
    aburrimiento INT NOT NULL DEFAULT 0,
    resentimiento INT NOT NULL DEFAULT 0,
    celos INT NOT NULL DEFAULT 0,
    nostalgia INT NOT NULL DEFAULT 0,
    rasgos_identidad JSONB NOT NULL DEFAULT '[]'::jsonb,
    memory_state JSONB NOT NULL DEFAULT '{}'::jsonb,
    ignored_count INT NOT NULL DEFAULT 0,
    arquetipo_id TEXT,
    dias_activos JSONB NOT NULL DEFAULT '[]'::jsonb,
    chat_history JSONB NOT NULL DEFAULT '[]'::jsonb,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. Tabla de Episodios (Memoria Episódica)
CREATE TABLE IF NOT EXISTS public.episodes (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    text TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Índices para optimizar consultas de alto rendimiento
CREATE INDEX IF NOT EXISTS idx_users_stripe_customer_id ON public.users(stripe_customer_id);
CREATE INDEX IF NOT EXISTS idx_episodes_user_id ON public.episodes(user_id);
CREATE INDEX IF NOT EXISTS idx_episodes_created_at ON public.episodes(created_at);

-- Habilitar RLS (Row Level Security)
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.memory_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.episodes ENABLE ROW LEVEL SECURITY;

-- Políticas para permitir acceso desde el Service Role del Backend
CREATE POLICY "Service Role Full Access Users" ON public.users FOR ALL USING (true);
CREATE POLICY "Service Role Full Access Memory" ON public.memory_state FOR ALL USING (true);
CREATE POLICY "Service Role Full Access Episodes" ON public.episodes FOR ALL USING (true);
