---
name: oauth-sso-security
description: >-
  Use this skill to audit, diagnose, and harden OAuth 2.0, OpenID Connect (OIDC), and Social SSO authentication flows. Specializes in redirect URI validation, CSRF/state parameter verification, token leakage via Referer/History, pre-account takeover (account linking attacks), and session synchronization.
---

# OAuth 2.0 & Social SSO Security Skill

This skill provides audit runbooks and remediation patterns for Social Authentication (Google, GitHub, Apple) and SSO implementations, particularly within Supabase and Jamstack architectures.

## Core Security Pillars

### 1. Redirect URI Hardening
- **Strict Whitelisting**: Ensure authentication redirect URLs (`redirectTo`) are strictly bounded to exact trusted domain origins.
- **Open Redirect Prevention**: Never allow arbitrary user-supplied redirect targets or relative paths that can be abused for credential leakage.
- **Fragment Token Leaks**:
  - In Implicit and PKCE flows, tokens/codes are returned via URL hash fragments (`#access_token=...`) or query parameters (`?code=...`).
  - Verify that the application strips the hash/query immediately upon processing to prevent leakage via browser history, screenshots, or third-party analytics scripts.

### 2. Pre-Account Takeover & Identity Linking
- **Unverified Email Collisions**:
  - If a user signs up with password using `alice@example.com` without email verification, an attacker could attempt to sign in with Google using that email or vice-versa.
  - In Supabase, ensure `auth.email_confirmed_at` is respected, and account linking is governed by strict identity verification (`identities` table).
- **Profile Synchronization**:
  - Ensure the database trigger (`handle_new_user`) cleanly links or populates profile records without overwriting critical security roles (`role`, `status`).

### 3. Cross-Site Request Forgery (CSRF) & State Parameter
- Verify that OAuth initiation generates and validates a cryptographic `state` or PKCE `code_challenge` / `code_verifier`.
- Ensure browsers maintain `SameSite=Lax` or `SameSite=Strict` cookies during third-party redirects.
