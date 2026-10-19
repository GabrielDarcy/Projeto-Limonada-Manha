---
name: data-privacy-lgpd-hardening
description: >-
  Use this skill to audit, diagnose, and enforce data privacy compliance according to Brazilian LGPD (Lei Geral de Proteção de Dados) and international GDPR standards. Identifies personal data leaks, phone/email scraping risks, right to erasure violations, and insecure data retention.
---

# Data Privacy & LGPD Hardening Skill

This skill provides audit runbooks and remediation patterns for privacy compliance, anti-scraping mechanisms, consent verification, and secure user data lifecycles.

## Core Security Pillars

### 1. Minimization & Anti-Harvesting
- **Anti-Scraping for Contact Data**:
  - Unauthenticated users and web crawlers must not be able to easily scrape phone numbers, emails, and social media handles in bulk.
  - Implement obfuscation, copy-on-click, or auth-gated reveals for personal contact information.
- **Sensitive Identity Attributes**:
  - Date of birth (`birth_date`), exact address, and recovery codes must never be serialized into public feed queries or API responses.
  - Public profile endpoints must project only public personas (`id`, `full_name`, `username`, `avatar_url`).

### 2. Right to Erasure & Account Liquidation (LGPD Art. 18)
- **Complete Deletion Flow**:
  - When a user requests account deletion, verify that the operation purges:
    1. Authentication credentials (`auth.users`)
    2. Profile information (`public.profiles`)
    3. User-created posts (`public.posts`)
    4. Private recovery records (`public.user_recovery_codes`)
    5. User storage assets in `avatars` bucket.
  - Deletion must be atomic and irreversible, preventing orphaned personal data.

### 3. Consent and Transparent Terms
- Explicit agreement to Terms of Use and Privacy Policy during signup.
- Disclosures of data processing, third-party integrations (e.g. IBGE API, Supabase, Google Fonts), and donation tracking.
