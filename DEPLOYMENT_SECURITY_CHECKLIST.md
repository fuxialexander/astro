# Security Deployment Checklist

## Pre-Deployment (Required)

### 1. Environment Variables
- [ ] Set `NODE_ENV=production`
- [ ] Generate JWT secret: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
- [ ] Set `DEVICE_AUTH_JWT_SECRET` (minimum 32 characters)
- [ ] Set `DEVICE_AUTH_REFRESH_SECRET` (minimum 32 characters)
- [ ] **DO NOT** set `ALLOW_E2E_BYPASS` in production
- [ ] Verify Supabase credentials are set (URL, anon key, service role key)

### 2. Security Configuration
- [ ] Verify test token bypass is disabled (no `ALLOW_E2E_BYPASS` env var)
- [ ] Confirm JWT secrets are different between dev/staging/production
- [ ] Enable HTTPS/TLS on all production endpoints
- [ ] Configure CORS to allow only production frontend domain

### 3. Database Security
- [ ] Enable Row Level Security (RLS) on all Supabase tables
- [ ] Verify foreign key constraints are in place
- [ ] Test ownership checks work for all CRUD operations
- [ ] Run database migrations in production

### 4. Rate Limiting
- [ ] Verify rate limiting is active on `/device/token` endpoint
- [ ] Monitor rate limit metrics in first 24 hours
- [ ] Consider implementing distributed rate limiting (Redis) for horizontal scaling

## Testing Before Deployment

### Integration Tests
```bash
# Set test environment
export NODE_ENV=test
export ALLOW_E2E_BYPASS=true
export DEVICE_AUTH_JWT_SECRET=test-jwt-secret-min-32-chars-long-value
export DEVICE_AUTH_REFRESH_SECRET=test-refresh-secret-min-32-chars-long

# Run tests
npm test
```

### Manual Security Tests
- [ ] Test IDOR protection: Try accessing another user's project by ID
- [ ] Test authentication: Try API calls without valid JWT
- [ ] Test rate limiting: Send rapid requests to `/device/token`
- [ ] Test JWT secret validation: Try starting server without secrets
- [ ] Test ownership checks on all protected endpoints

## Post-Deployment Monitoring

### Day 1 (First 24 hours)
- [ ] Monitor authentication failure rate
- [ ] Check for rate limit violations
- [ ] Review server logs for security warnings
- [ ] Verify no test bypass warnings appear
- [ ] Monitor database query performance (ownership checks add JOINs)

### Week 1
- [ ] Review access patterns for anomalies
- [ ] Check for failed authorization attempts
- [ ] Monitor rate limit effectiveness
- [ ] Review JWT token refresh patterns
- [ ] Check for IDOR attempts in logs

## Security Incident Response

### If Security Issue Detected
1. **Immediate Actions**:
   - Rotate JWT secrets immediately
   - Revoke all refresh tokens for affected users
   - Enable additional logging
   - Notify affected users

2. **Investigation**:
   - Review server logs for attack pattern
   - Check database for unauthorized access
   - Identify compromised accounts
   - Document timeline and scope

3. **Remediation**:
   - Apply security patches
   - Reset affected user sessions
   - Update deployment checklist
   - Conduct security audit

## Security Hardening (Recommended)

### High Priority
- [ ] Implement Redis-based rate limiting for multi-instance deployments
- [ ] Add audit logging for all authentication events
- [ ] Set up automated security scanning (Dependabot, Snyk)
- [ ] Configure security headers (CSP, HSTS, etc.)
- [ ] Implement API request signing

### Medium Priority
- [ ] Add IP allowlisting for administrative endpoints
- [ ] Implement automated secret rotation
- [ ] Set up intrusion detection monitoring
- [ ] Add captcha for device authorization flow
- [ ] Implement anomaly detection for access patterns

### Low Priority (Nice to Have)
- [ ] Add geographic rate limiting
- [ ] Implement biometric authentication for device registration
- [ ] Set up honeypot endpoints for attack detection
- [ ] Add machine learning-based fraud detection

## Compliance

### GDPR/Privacy
- [ ] Data export endpoint tested (`GET /api/data/export`)
- [ ] User data deletion flow verified
- [ ] Privacy policy updated to reflect data collection
- [ ] Cookie consent mechanism in place

### Security Standards
- [ ] OWASP Top 10 review completed
- [ ] Security headers configured (helmet.js)
- [ ] SQL injection tests passed
- [ ] XSS protection verified
- [ ] CSRF protection enabled

## Rollback Plan

### If Security Issues Arise
1. Keep previous Docker image/deployment ready
2. Database migrations should be backward compatible
3. JWT secrets should be rotatable without downtime
4. Monitor error rates during rollback

### Rollback Procedure
```bash
# 1. Revert to previous deployment
git revert <commit-hash>

# 2. Restore previous JWT secrets (from secure vault)
export DEVICE_AUTH_JWT_SECRET=<previous-secret>
export DEVICE_AUTH_REFRESH_SECRET=<previous-refresh-secret>

# 3. Deploy
npm run deploy

# 4. Verify
curl https://api.astro.example.com/api/health
```

## Contact Information

### Security Team
- Security Lead: [name@example.com]
- On-call Engineer: [oncall@example.com]
- Security Hotline: [phone number]

### External Resources
- Anthropic Security: security@anthropic.com
- Supabase Security: security@supabase.com
- Production Monitoring: [link to monitoring dashboard]

---

**Last Updated**: 2026-02-15
**Version**: 1.0
**Owner**: Security Team
