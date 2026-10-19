---
name: auth-session-access-control
description: >-
  Use this skill to design, audit, and remediate authentication workflows, session handling, Role-Based Access Control (RBAC), privilege escalation vulnerabilities, and credential recovery mechanisms in client-server and Jamstack applications.
---

# Authentication, Session & Access Control Security Skill

This skill guides the implementation of bulletproof authentication, session integrity, role validation, and credential protection.

## Core Security Pillars

### 1. Role-Based Access Control (RBAC) Architecture
- **Never Trust Client-Side State**:
  - `localStorage` or `sessionStorage` roles (`user`, `admin`) are strictly for UI rendering conveniences (e.g. showing or hiding an admin navigation link).
  - All critical business logic, data mutations, and administrative actions must be enforced independently at the database/API level via JWT claims (`auth.uid()`) and database authorization checks.
- **Anti-Privilege-Escalation Triggers**:
  - Users must not be able to modify their own `role` or `status` columns.
  - Enforce database-level triggers to abort unauthorized role alterations:
    ```sql
    IF (NEW.role IS DISTINCT FROM OLD.role) AND NOT public.is_admin() THEN
      RAISE EXCEPTION 'Apenas administradores podem alterar papéis de usuário.';
    END IF;
    ```

### 2. Credential Recovery & Account Takeover (ATO) Prevention
- **Entropy & Rate Limiting**:
  - Short numerical recovery codes (e.g., 6 digits) have limited entropy (1,000,000 combinations) and can be brute-forced without aggressive rate limiting.
  - Enforce server-side attempt lockouts (max 5 failed attempts within an hour) and tie recovery requests to a specific account identifier (email/username), preventing enumeration across the entire user base.
- **Cryptographic Hashing for Stored Secrets**:
  - Recovery codes, tokens, and verification codes must be stored in salted cryptographic hashes (e.g., `digest(salt || code, 'sha256')` or `crypt()`), never in plaintext.
- **Single-Use Invalidation**:
  - Invalidate the recovery token immediately after successful password reset.

### 3. Session Lifecycle & Invalidation
- **Instant Eviction for Banned Accounts**:
  - Ban checks must be executed upon page load against the authoritative database profile.
  - If `status = 'banned'`, force `auth.signOut()`, purge client storage, and redirect immediately.
- **Secure Token Storage**:
  - Rely on Supabase's built-in PKCE / OAuth / JWT token handling with automatic refresh token rotation.
  - Purge cached session objects upon explicit logout or authentication failure.
