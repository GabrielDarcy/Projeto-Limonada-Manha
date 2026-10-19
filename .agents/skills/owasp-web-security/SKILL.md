---
name: owasp-web-security
description: >-
  Use this skill to audit, diagnose, and remediate web application security vulnerabilities based on OWASP Top 10 standards. Specializes in client-side HTML, CSS, JavaScript, DOM-based XSS, injection prevention, Content Security Policy (CSP), CORS, CSRF, and HTTP security headers.
---

# OWASP Web Application Security Skill

This skill equips the agent with automated audit procedures, threat analysis patterns, and remediation guides for modern web applications built with HTML5, CSS3, and JavaScript.

## Core Security Domains

### 1. Cross-Site Scripting (XSS) Prevention
- **Context-Aware Output Encoding**: Ensure all dynamic data injected into the DOM is encoded for its specific context (HTML body, attribute, URL, JavaScript variable).
- **Safe DOM APIs**:
  - Prefer `textContent`, `setAttribute`, `replaceChildren()` over `innerHTML` or `outerHTML`.
  - If `innerHTML` is required for rich rendering, enforce a centralized sanitizer (`escapeHTML`) that escapes `&`, `<`, `>`, `"`, and `'`.
- **Dangerous URL Schemes**:
  - Guard all `href` and `src` attributes against `javascript:`, `vbscript:`, and `data:text/html` pseudo-protocols.
  - Always validate URLs with a strict scheme whitelist (`https:`, `http:`, or explicit `data:image/...`).

### 2. Content Security Policy (CSP) & Secure Headers
- **Directives Enforcement**:
  - `default-src 'self'`: Default fallback to same-origin.
  - `script-src`: Restrict scripts to trusted CDNs or hashes/nonces. Avoid `'unsafe-eval'`.
  - `object-src 'none'`: Block Flash, Java, and legacy plugins.
  - `base-uri 'self'`: Prevent base-tag hijacking.
  - `frame-ancestors 'none'` or `'self'`: Defend against clickjacking (superior to `X-Frame-Options`).
  - `upgrade-insecure-requests`: Migrate all HTTP assets to HTTPS.
- **Mandatory Headers**:
  - `X-Content-Type-Options: nosniff`: Prevent MIME-type confusion attacks.
  - `Referrer-Policy: strict-origin-when-cross-origin`: Prevent leaking query parameters across third-party domains.
  - `Strict-Transport-Security: max-age=31536000; includeSubDomains; preload`: Enforce TLS.

### 3. Clickjacking & UI Redressing Defense
- Check that `frame-ancestors` directive is active on web servers (`_headers`, Netlify, Vercel, Nginx).
- For defense-in-depth on older browsers, include `X-Frame-Options: DENY`.

### 4. Input Validation & Defense-in-Depth
- Validate inputs twice: client-side for immediate user feedback, server/database-side for non-bypassable integrity.
- Never rely on `disabled` HTML attributes or client-side form constraints for actual security enforcement.
