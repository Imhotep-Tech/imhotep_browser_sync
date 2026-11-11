-- ==============================================================================
-- Imhotep Browser Sync - Supabase Database Vault Schema
-- Zero-Knowledge Cloud Storage with Row-Level Security (RLS) & Realtime Sync
-- ==============================================================================

-- 1. EXTENSIONS
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 2. TABLES

-- Profiles: Stores account-level E2EE PBKDF2 salt and metadata
CREATE TABLE IF NOT EXISTS public.profiles (
    user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    salt TEXT NOT NULL,
    device_count INTEGER NOT NULL DEFAULT 1 CHECK (device_count >= 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Devices: Connected browser instances & telemetry
CREATE TABLE IF NOT EXISTS public.devices (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    device_name TEXT NOT NULL,
    device_type TEXT NOT NULL CHECK (device_type IN ('desktop', 'mobile_android', 'tablet')),
    last_seen TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- History Sync: Encrypted micro-batch browser history records
CREATE TABLE IF NOT EXISTS public.history_sync (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    device_id UUID REFERENCES public.devices(id) ON DELETE SET NULL,
    encrypted_payload TEXT NOT NULL, -- AES-256-GCM encrypted visit payload
    payload_iv TEXT NOT NULL,        -- Base64 encoded 12-byte IV
    visit_timestamp TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Extension Sync: Encrypted inventory of installed browser extensions per device
CREATE TABLE IF NOT EXISTS public.extension_sync (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    device_id UUID NOT NULL REFERENCES public.devices(id) ON DELETE CASCADE,
    encrypted_payload TEXT NOT NULL, -- AES-256-GCM encrypted extension manifests
    payload_iv TEXT NOT NULL,        -- Base64 encoded 12-byte IV
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_extension_sync_user_device UNIQUE (user_id, device_id)
);

-- 3. INDEXES FOR PERFORMANCE & RETENTION
CREATE INDEX IF NOT EXISTS idx_devices_user_id ON public.devices (user_id);
CREATE INDEX IF NOT EXISTS idx_devices_last_seen ON public.devices (last_seen DESC);

CREATE INDEX IF NOT EXISTS idx_history_sync_user_visit ON public.history_sync (user_id, visit_timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_history_sync_device_id ON public.history_sync (device_id);
CREATE INDEX IF NOT EXISTS idx_history_sync_retention ON public.history_sync (visit_timestamp);

CREATE INDEX IF NOT EXISTS idx_extension_sync_user ON public.extension_sync (user_id);

-- 4. ROLLING 90-DAY RETENTION MECHANISM
-- Function to purge records older than 90 days
CREATE OR REPLACE FUNCTION public.cleanup_expired_history()
RETURNS INTEGER AS $$
DECLARE
    deleted_rows INTEGER;
BEGIN
    DELETE FROM public.history_sync
    WHERE visit_timestamp < (now() - INTERVAL '90 days');
    GET DIAGNOSTICS deleted_rows = ROW_COUNT;
    RETURN deleted_rows;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Probabilistic maintenance trigger on insert (prunes 1 in every ~50 batch inserts to avoid overhead)
CREATE OR REPLACE FUNCTION public.trigger_history_retention_cleanup()
RETURNS trigger AS $$
BEGIN
    IF random() < 0.02 THEN
        PERFORM public.cleanup_expired_history();
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS trg_cleanup_history_retention ON public.history_sync;
CREATE TRIGGER trg_cleanup_history_retention
    AFTER INSERT ON public.history_sync
    FOR EACH STATEMENT
    EXECUTE FUNCTION public.trigger_history_retention_cleanup();

-- Automatic timestamp updater for profiles and extension_sync
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_profiles_updated_at ON public.profiles;
CREATE TRIGGER trg_profiles_updated_at
    BEFORE UPDATE ON public.profiles
    FOR EACH ROW
    EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_extension_sync_updated_at ON public.extension_sync;
CREATE TRIGGER trg_extension_sync_updated_at
    BEFORE UPDATE ON public.extension_sync
    FOR EACH ROW
    EXECUTE FUNCTION public.set_updated_at();

-- 5. ROW LEVEL SECURITY (RLS) - ZERO-KNOWLEDGE ISOLATION
-- Enable RLS strictly on all public schema tables
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.history_sync ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.extension_sync ENABLE ROW LEVEL SECURITY;

-- Explicitly revoke public access and grant to authenticated role
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.profiles TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.devices TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.history_sync TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.extension_sync TO authenticated;

-- Policies for public.profiles
DROP POLICY IF EXISTS "profiles_select_own" ON public.profiles;
CREATE POLICY "profiles_select_own"
    ON public.profiles
    FOR SELECT
    TO authenticated
    USING ((select auth.uid()) = user_id);

DROP POLICY IF EXISTS "profiles_insert_own" ON public.profiles;
CREATE POLICY "profiles_insert_own"
    ON public.profiles
    FOR INSERT
    TO authenticated
    WITH CHECK ((select auth.uid()) = user_id);

DROP POLICY IF EXISTS "profiles_update_own" ON public.profiles;
CREATE POLICY "profiles_update_own"
    ON public.profiles
    FOR UPDATE
    TO authenticated
    USING ((select auth.uid()) = user_id)
    WITH CHECK ((select auth.uid()) = user_id);

DROP POLICY IF EXISTS "profiles_delete_own" ON public.profiles;
CREATE POLICY "profiles_delete_own"
    ON public.profiles
    FOR DELETE
    TO authenticated
    USING ((select auth.uid()) = user_id);

-- Policies for public.devices
DROP POLICY IF EXISTS "devices_select_own" ON public.devices;
CREATE POLICY "devices_select_own"
    ON public.devices
    FOR SELECT
    TO authenticated
    USING ((select auth.uid()) = user_id);

DROP POLICY IF EXISTS "devices_insert_own" ON public.devices;
CREATE POLICY "devices_insert_own"
    ON public.devices
    FOR INSERT
    TO authenticated
    WITH CHECK ((select auth.uid()) = user_id);

DROP POLICY IF EXISTS "devices_update_own" ON public.devices;
CREATE POLICY "devices_update_own"
    ON public.devices
    FOR UPDATE
    TO authenticated
    USING ((select auth.uid()) = user_id)
    WITH CHECK ((select auth.uid()) = user_id);

DROP POLICY IF EXISTS "devices_delete_own" ON public.devices;
CREATE POLICY "devices_delete_own"
    ON public.devices
    FOR DELETE
    TO authenticated
    USING ((select auth.uid()) = user_id);

-- Policies for public.history_sync
DROP POLICY IF EXISTS "history_sync_select_own" ON public.history_sync;
CREATE POLICY "history_sync_select_own"
    ON public.history_sync
    FOR SELECT
    TO authenticated
    USING ((select auth.uid()) = user_id);

DROP POLICY IF EXISTS "history_sync_insert_own" ON public.history_sync;
CREATE POLICY "history_sync_insert_own"
    ON public.history_sync
    FOR INSERT
    TO authenticated
    WITH CHECK ((select auth.uid()) = user_id);

DROP POLICY IF EXISTS "history_sync_update_own" ON public.history_sync;
CREATE POLICY "history_sync_update_own"
    ON public.history_sync
    FOR UPDATE
    TO authenticated
    USING ((select auth.uid()) = user_id)
    WITH CHECK ((select auth.uid()) = user_id);

DROP POLICY IF EXISTS "history_sync_delete_own" ON public.history_sync;
CREATE POLICY "history_sync_delete_own"
    ON public.history_sync
    FOR DELETE
    TO authenticated
    USING ((select auth.uid()) = user_id);

-- Policies for public.extension_sync
DROP POLICY IF EXISTS "extension_sync_select_own" ON public.extension_sync;
CREATE POLICY "extension_sync_select_own"
    ON public.extension_sync
    FOR SELECT
    TO authenticated
    USING ((select auth.uid()) = user_id);

DROP POLICY IF EXISTS "extension_sync_insert_own" ON public.extension_sync;
CREATE POLICY "extension_sync_insert_own"
    ON public.extension_sync
    FOR INSERT
    TO authenticated
    WITH CHECK ((select auth.uid()) = user_id);

DROP POLICY IF EXISTS "extension_sync_update_own" ON public.extension_sync;
CREATE POLICY "extension_sync_update_own"
    ON public.extension_sync
    FOR UPDATE
    TO authenticated
    USING ((select auth.uid()) = user_id)
    WITH CHECK ((select auth.uid()) = user_id);

DROP POLICY IF EXISTS "extension_sync_delete_own" ON public.extension_sync;
CREATE POLICY "extension_sync_delete_own"
    ON public.extension_sync
    FOR DELETE
    TO authenticated
    USING ((select auth.uid()) = user_id);

-- 6. SUPABASE REALTIME REPLICATION
-- Enable realtime publication for history_sync and extension_sync
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime'
    ) THEN
        CREATE PUBLICATION supabase_realtime;
    END IF;
END;
$$;

-- Add tables safely if not already part of the publication
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables 
        WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'history_sync'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.history_sync;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables 
        WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'extension_sync'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.extension_sync;
    END IF;
END;
$$;
