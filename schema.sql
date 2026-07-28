-- ═══════════════════════════════════════════════════════════
-- LUMA SERVER — ESQUEMA DE BASE DE DATOS PARA SUPABASE (schema.sql)
-- Ejecuta este script en el Editor SQL de tu proyecto en Supabase
-- ═══════════════════════════════════════════════════════════

-- Habilitar extensión pgvector para Búsqueda Semántica Vectorial
CREATE EXTENSION IF NOT EXISTS vector;

-- 1. Tabla de Usuarios (con Telemetría de Costos y Tokens)
CREATE TABLE IF NOT EXISTS public.users (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    tier TEXT NOT NULL DEFAULT 'free',
    daily_message_count INT NOT NULL DEFAULT 0,
    daily_internal_count INT NOT NULL DEFAULT 0,
    daily_message_reset TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    stripe_customer_id TEXT,
    total_input_tokens BIGINT NOT NULL DEFAULT 0,
    total_output_tokens BIGINT NOT NULL DEFAULT 0,
    estimated_cost_usd NUMERIC(10, 6) NOT NULL DEFAULT 0.000000,
    total_chats_count INT NOT NULL DEFAULT 0,
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

-- 3. Tabla de Episodios (Memoria Episódica con Búsqueda Vectorial)
CREATE TABLE IF NOT EXISTS public.episodes (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    text TEXT NOT NULL,
    embedding VECTOR(1536), -- Vector para búsqueda semántica (text-embedding-3-small)
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 4. Tabla de Personajes (Oficiales y creados por usuarios)
CREATE TABLE IF NOT EXISTS public.characters (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    creator_id UUID REFERENCES public.users(id) ON DELETE CASCADE, -- NULL si es un personaje oficial de Luma
    is_official BOOLEAN NOT NULL DEFAULT false,
    name TEXT NOT NULL,
    avatar_url TEXT,
    tagline TEXT,
    description TEXT,
    system_prompt TEXT NOT NULL,
    first_message TEXT NOT NULL,
    arquetipo_id TEXT NOT NULL DEFAULT 'pareja',
    tier_required TEXT NOT NULL DEFAULT 'free',
    voice_id TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 5. Tabla de Conversaciones (Instancias de Chat por Usuario y Personaje)
CREATE TABLE IF NOT EXISTS public.conversations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    character_id UUID NOT NULL REFERENCES public.characters(id) ON DELETE CASCADE,
    memory_state JSONB NOT NULL DEFAULT '{}'::jsonb,
    chat_history JSONB NOT NULL DEFAULT '[]'::jsonb,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(user_id, character_id)
);

-- Índices para optimizar consultas de alto rendimiento
CREATE INDEX IF NOT EXISTS idx_users_stripe_customer_id ON public.users(stripe_customer_id);
CREATE INDEX IF NOT EXISTS idx_episodes_user_id ON public.episodes(user_id);
CREATE INDEX IF NOT EXISTS idx_episodes_created_at ON public.episodes(created_at);
CREATE INDEX IF NOT EXISTS idx_characters_is_official ON public.characters(is_official);
CREATE INDEX IF NOT EXISTS idx_characters_creator_id ON public.characters(creator_id);
CREATE INDEX IF NOT EXISTS idx_conversations_user_id ON public.conversations(user_id);

-- Índice HNSW para Búsqueda Vectorial Ultarrápida (<2ms)
CREATE INDEX IF NOT EXISTS idx_episodes_embedding_hnsw 
ON public.episodes USING hnsw (embedding vector_cosine_ops);

-- Habilitar RLS (Row Level Security)
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.memory_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.episodes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.characters ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;

-- Políticas para permitir acceso desde el Service Role del Backend
CREATE POLICY "Service Role Full Access Users" ON public.users FOR ALL USING (true);
CREATE POLICY "Service Role Full Access Memory" ON public.memory_state FOR ALL USING (true);
CREATE POLICY "Service Role Full Access Episodes" ON public.episodes FOR ALL USING (true);
CREATE POLICY "Service Role Full Access Characters" ON public.characters FOR ALL USING (true);
CREATE POLICY "Service Role Full Access Conversations" ON public.conversations FOR ALL USING (true);


-- Función para búsqueda semántica con Re-ranking por Decaimiento Temporal (Time-Decay Recency Scoring)
CREATE OR REPLACE FUNCTION match_episodes (
  query_embedding VECTOR(1536),
  match_threshold FLOAT,
  match_count INT,
  p_user_id UUID
)
RETURNS TABLE (
  text TEXT,
  similarity FLOAT,
  score FLOAT
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    episodes.text,
    (1 - (episodes.embedding <=> query_embedding))::FLOAT AS similarity,
    -- Formula: similitud * exp(-0.02 * días_transcurridos)
    ((1 - (episodes.embedding <=> query_embedding)) * EXP(-0.02 * (EXTRACT(EPOCH FROM (NOW() - episodes.created_at)) / 86400)))::FLOAT AS score
  FROM episodes
  WHERE episodes.user_id = p_user_id
    AND episodes.embedding IS NOT NULL
    AND (1 - (episodes.embedding <=> query_embedding)) > match_threshold
  ORDER BY score DESC
  LIMIT match_count;
END;
$$;


