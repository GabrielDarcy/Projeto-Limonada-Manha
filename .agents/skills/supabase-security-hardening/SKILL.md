---
name: supabase-security-hardening
description: >-
  Use this skill to audit, harden, and secure Supabase database architectures, PostgreSQL schemas, Row Level Security (RLS) policies, Storage buckets, and RPC functions. Detects privilege escalation, anon key abuse, service_role leaks, and search_path poisoning.
---

# Supabase Security Hardening Skill

This skill provides procedures and runbooks to secure Supabase applications against data leaks, unauthorized mutations, privilege escalation, and infrastructure attacks.

## Core Security Pillars

### 1. Row Level Security (RLS) Enforcement
- **Universal RLS**: Every table in the `public` schema MUST have RLS explicitly enabled:
  ```sql
  ALTER TABLE public.table_name ENABLE ROW LEVEL SECURITY;
  ALTER TABLE public.table_name FORCE ROW LEVEL SECURITY;
  ```
- **Default Deny**: If no policy matches, access is denied. Ensure explicit policies exist for `SELECT`, `INSERT`, `UPDATE`, and `DELETE`.
- **Identity Isolation**:
  - `auth.uid()` checks must be used for tenant or user data:
    ```sql
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id)
    ```
- **Service Role Protection**: Never expose `service_role` keys on client-side bundles or repository files. The client must ONLY possess the `anon` public key.

### 2. PostgreSQL Function Security (`SECURITY DEFINER`)
- **Search Path Poisoning Prevention**:
  Every function declared with `SECURITY DEFINER` executes with the permissions of the database owner. It MUST explicitly lock down its `search_path`:
  ```sql
  CREATE OR REPLACE FUNCTION public.my_secure_function(...)
  RETURNS ...
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, pg_catalog
  AS $$ ... $$;
  ```
- **Explicit Role Authorization**:
  Functions must verify the caller's identity and privileges before executing sensitive actions:
  ```sql
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Acesso negado: privilégios insuficientes.';
  END IF;
  ```

### 3. Supabase Storage Bucket Security
- Storage buckets (`storage.objects`) must also be protected with RLS policies:
  - Public Read: Only for publicly shared assets (e.g., animal photos, public avatars).
  - Restricted Upload: Limit file size and allowed MIME types in SQL (`image/jpeg`, `image/png`, `image/webp`).
  - Folder Isolation: Users must only be allowed to write/delete inside folders corresponding to their own UUID:
    ```sql
    (storage.foldername(name))[1] = auth.uid()::text
    ```

### 4. Sensitive Column Protection & Separation
- Never store secrets (plain recovery codes, API tokens, hashed credentials) in tables that have public `SELECT` policies (such as `profiles`).
- Isolate private user state in dedicated tables with strict RLS (`NO ACCESS` to anon, restricted to `auth.uid()` or accessed solely through dedicated `SECURITY DEFINER` functions).
