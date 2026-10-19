---
name: api-traffic-rate-limiting-dos
description: >-
  Use this skill to audit, detect, and mitigate Denial of Service (DoS), API traffic exhaustion, automated query flooding, client-side pagination traps, payload size bombs, and Regular Expression Denial of Service (ReDoS) vulnerabilities.
---

# API Traffic, Rate Limiting & DoS Defense Skill

This skill equips the agent with inspection checklists and defensive mitigations against application-layer denial of service (L7 DoS), resource starvation, and abusive request flooding.

## Core Security Pillars

### 1. Database-Level Rate Limiting & Throttling
- **Mutations per Window**:
  - Enforce server-side sliding window limits on resource-heavy actions (post creation, password resets, user reports) directly within PostgreSQL triggers.
  - Fail fast with standardized exception codes (e.g. `RATE_LIMIT_EXCEEDED`) that client applications handle gracefully without leaking stack traces.
- **RPC Execution Costs**:
  - Audit public stored procedures (`SECURITY DEFINER`) to ensure they do not perform unbounded sequential table scans or nested loops susceptible to CPU exhaustion.
  - Require indexed lookup keys for all parameterized queries.

### 2. Regular Expression Denial of Service (ReDoS)
- **Catastrophic Backtracking Prevention**:
  - Audit all regular expressions used in input validation, masking, and text sanitizers.
  - Avoid nested quantifiers like `(a+)+`, `([a-z]+)*`, or overlapping wildcard patterns that lead to exponential backtracking on malicious inputs.
  - Enforce bounded length checks (`slice(0, N)`) *before* applying regex operations.

### 3. Payload and Resource Quotas
- **File Upload Bombs**:
  - Enforce hard byte caps on client file selection (e.g., 8MB) and mirror these in Supabase Storage bucket configuration (`file_size_limit`).
  - Validate file magic bytes or MIME types to prevent oversized decompression attacks (zip bombs, SVG entity expansion).
- **Pagination Safety**:
  - Require explicit `limit()` and `range()` on all Supabase queries. Never allow unbounded `select('*')` on growing collections.
