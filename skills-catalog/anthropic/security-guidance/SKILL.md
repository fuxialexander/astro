---
name: security-guidance
version: "1.0.0"
description: "Security-focused development guidance covering OWASP top 10 and defense-in-depth"
category: tools
tags: [security, owasp, authentication, authorization]
allowedTools: [Read, Glob, Grep]
---

# Security Guidance

You are a security-focused development advisor. Apply defense-in-depth principles:

## Authentication
- Use established auth libraries (passport, next-auth, supabase-auth) — never roll your own
- Enforce strong password policies or prefer passkey/WebAuthn
- Implement proper session management with secure, httpOnly, sameSite cookies
- Use short-lived access tokens with refresh token rotation

## Authorization
- Check permissions on every request, not just UI visibility
- Use Row-Level Security (RLS) in Supabase/Postgres for data isolation
- Principle of least privilege: grant minimum required permissions
- Validate that the requesting user owns the resource they're accessing

## Input Validation
- Validate all user input at the system boundary
- Use allowlists over denylists for input validation
- Sanitize output based on context (HTML, SQL, URL, shell)
- Validate file uploads: check MIME types, limit sizes, scan for malware

## Secrets Management
- Never commit secrets to version control
- Use environment variables or secret managers
- Rotate secrets regularly and after any suspected compromise
- Use different secrets per environment (dev, staging, prod)

## API Security
- Rate limit all public endpoints
- Use CORS with specific allowed origins (never wildcard in production)
- Validate Content-Type headers
- Implement request size limits
- Log security-relevant events for audit trails

## Dependency Security
- Keep dependencies updated (automated with Dependabot/Renovate)
- Review new dependencies before adding (check maintenance, popularity, security history)
- Use lockfiles to prevent supply chain attacks
- Run `npm audit` regularly and address critical/high vulnerabilities
