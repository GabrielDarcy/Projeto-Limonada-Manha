---
name: sql-database-integrity
description: >-
  Use this skill to audit, design, and enforce PostgreSQL database schemas, constraints, transactional integrity, SQL injection defense in stored procedures, check constraints with regex validation, and idempotent zero-downtime database migrations.
---

# PostgreSQL Database Integrity & Schema Hardening Skill

This skill provides comprehensive standards for PostgreSQL schemas, relational integrity, constraint validation, injection prevention, and safe migrations.

## Core Security Pillars

### 1. Database-Level Schema Validation
- **Regex Check Constraints**:
  - Never allow invalid data into the database even if the frontend form validation is bypassed:
    ```sql
    CONSTRAINT profiles_username_format CHECK (username ~* '^[a-z0-9._]{3,30}$'),
    CONSTRAINT profiles_email_format CHECK (email ~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$')
    ```
- **Enum / Value Set Constraints**:
  - Constrain text columns to authorized value domains (`animal_type IN ('Cachorro', 'Gato', 'Fazenda', 'Exótico', 'Marinho', 'Outro')`, `status IN ('active', 'adopted', 'banned')`).
- **Array Size & Content Boundaries**:
  - Constrain JSON or array columns (e.g. `image_urls text[]`) to reasonable sizes: `CHECK (array_length(image_urls, 1) <= 4)`.

### 2. SQL Injection & RPC Defense
- **Parameterized SQL**:
  - In PL/pgSQL functions, never use string concatenation with `EXECUTE` unless using format specifiers with `%L` (literals) and `%I` (identifiers).
  - Use static SQL queries with `$1, $2, ...` or declared parameters whenever possible.
- **Search Path Isolation**:
  - Lock `search_path` to avoid function hijacking through malicious schemas or temporary tables.

### 3. Anti-Spam & Rate Limiting Triggers
- **Database-Level Rate Limits**:
  - Prevent script kiddies or automated scrapers from flooding the database by inserting hundreds of posts:
    ```sql
    CREATE OR REPLACE FUNCTION public.check_post_rate_limit()
    RETURNS TRIGGER AS $$
    DECLARE
      post_count integer;
    BEGIN
      SELECT COUNT(*) INTO post_count
      FROM public.posts
      WHERE user_id = NEW.user_id
        AND created_at > (now() - interval '1 hour');

      IF post_count >= 10 THEN
        RAISE EXCEPTION 'RATE_LIMIT_EXCEEDED: Limite de postagens por hora excedido.';
      END IF;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog;
    ```

### 4. Relational Integrity & Cascades
- Foreign keys must specify explicit delete actions:
  - `ON DELETE CASCADE` for owned children (user posts, user recovery codes, user likes).
  - `ON DELETE RESTRICT` or `SET NULL` for shared referential items.
- Ensure indexes exist on all foreign key columns and filtered search attributes to prevent table locks and slow sequential scans.
