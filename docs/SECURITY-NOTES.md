# ██████ PROJECT SILHOUETTE — SECURITY NOTES ██████
## Operational Security Guidance

---

**Classification:** INTERNAL USE ONLY

---

## 1. CREDENTIAL MANAGEMENT

### 1.1 What the system stores — and where

| Credential               | Location                                          | Risk if leaked                |
|--------------------------|---------------------------------------------------|-------------------------------|
| `ADMIN_USERNAME`         | Backend env vars only                             | Needs password to exploit     |
| `ADMIN_PASSWORD_HASH`    | Backend env vars only                             | Needs rainbow table / brute   |
| `JWT_SECRET`             | Backend env vars only                             | Attacker can forge JWT tokens |
| `GOOGLE_REFRESH_TOKEN`   | Backend env vars only                             | Full Google Tasks access      |
| `EVERNOTE_DEV_TOKEN`     | Backend env vars only                             | Full Evernote account access  |
| `MS_REFRESH_TOKEN`       | Backend env vars only                             | Full OneNote access           |
| All above               | NEVER in any file committed to git                | N/A (kept safe)               |

### 1.2 Secret rotation

- **JWT_SECRET:** Rotate every 90 days. All existing sessions will be invalidated.
- **GOOGLE_REFRESH_TOKEN:** Rotates automatically on each use.
- **MS_REFRESH_TOKEN:** Rotates automatically. Persist new value.
- **ADMIN_PASSWORD_HASH:** Change if password is compromised.
- **EVERNOTE_DEV_TOKEN:** Revoke at https://www.evernote.com/api/DeveloperToken.action

### 1.3 .gitignore additions

Add to your `.gitignore`:
```
# Project Silhouette secrets
auth/
.env
.env.*
tracking-backend/.env
tracking-backend/**/.env
*.pem
*.key
```

---

## 2. JWT SECURITY

### 2.1 Token properties
- **Algorithm:** HS256 (HMAC-SHA-256)
- **Expiry:** 1 hour
- **Storage:** `sessionStorage` (cleared on tab/browser close)
- **NOT** stored in `localStorage` (persistent) or cookies

### 2.2 Why sessionStorage?
- Cleared when the browser tab is closed
- Not accessible by other tabs/origins
- Not sent automatically with requests (unlike cookies)

### 2.3 JWT is NOT a session cookie
- The token must be sent manually in `Authorization: Bearer <token>` header
- No CSRF risk

---

## 3. CORS POLICY

The backend enforces a strict allowlist of allowed origins:

```javascript
const ALLOWED_ORIGINS = [
  'https://blueboop.is-a.dev',
  'https://nicholas-tritsaris.github.io',
  'http://localhost:3000',      // Remove in production if not needed
  'http://127.0.0.1:5500',      // Remove in production if not needed
];
```

**What this means:**
- Requests from any other origin are rejected with `403 origin_denied`
- The tracker payload can only be sent from the authorized frontend
- The dashboard API can only be called from the authorized frontend

**To harden for production (optional):** Remove the localhost entries.

---

## 4. RATE LIMITING

### Backend rate limits per IP:

| Endpoint       | Limit                           | Rationale                        |
|----------------|---------------------------------|----------------------------------|
| `POST /api/auth` | 10 requests per 15 minutes    | Prevent brute-force login        |
| `POST /api/track` | 300 requests per 15 minutes  | Allow legitimate tracking        |
| `GET /api/data`  | 300 requests per 15 minutes   | Dashboard data fetches           |

### Cloudflare Workers additional protection:

Add a Cloudflare Rate Limiting rule in the dashboard:
- URI Path: `/api/auth`
- Requests: 10
- Period: 10 minutes
- Action: Block

---

## 5. PAYLOAD VALIDATION

### Input sanitization
All string fields from the frontend are sanitized before storage:
- `<script>` tags are stripped
- All HTML tags are stripped
- Strings are truncated to 4096 characters
- Arrays are truncated to 50 elements
- Object depth limited to 5 levels

### Maximum payload size
- Cloudflare Workers: 32KB
- Vercel Functions: 32KB
- Express: 32KB

### What is NOT validated (accepted as-is after sanitization):
- JavaScript primitives (numbers, booleans)
- Timestamps (stored as strings)

---

## 6. THREAT MODEL

| Threat                              | Mitigation                                                            |
|-------------------------------------|-----------------------------------------------------------------------|
| Credential exposure in GitHub repo  | All secrets in backend env vars, never committed                      |
| CORS bypass                         | Strict origin allowlist on all endpoints                              |
| JWT forgery                         | 64-char random JWT_SECRET; HS256 signing                             |
| JWT replay after logout             | Short 1-hour expiry; sessionStorage cleared on logout                 |
| Brute force login                   | Rate limiting (10 attempts/15 min per IP)                            |
| Payload injection into note service | Input sanitization, HTML/script stripping                             |
| Backend URL enumeration             | Non-guessable Cloudflare Workers subdomain                           |
| XSS in dashboard                    | All data rendered with `textContent`, not `innerHTML`                 |
| Data exfiltration via dashboard     | JWT required for `/api/data` endpoint                                 |
| Tracker bypassed by user            | No compensation needed — silent failure by design                    |
| DoS via /api/track flooding         | Global rate limiting; Workers auto-scale                              |

---

## 7. PRIVACY COMPLIANCE NOTES

This system collects device fingerprints without explicit user consent (configured to fire unconditionally as requested). You should be aware of:

- **GDPR (EU):** Fingerprinting without consent may require a legal basis (e.g. legitimate interest). Consider adding a privacy notice.
- **CCPA (California):** No special requirements for fingerprinting (only personal data sales are restricted).
- **PIPEDA (Canada):** Similar to GDPR — consent or legitimate interest required.
- **Australia Privacy Act:** No cookie law equivalent; tracking of pseudonymous data is generally permitted with a clear privacy policy.

**Your existing consent banner** in `index.html` covers Google Analytics. To comply with stricter jurisdictions, you may want to gate the tracker behind the same consent.

---

## 8. OPERATIONAL SECURITY CHECKLIST

Before going live, verify:

- [ ] Backend deployed with all secrets set (none are placeholder values)
- [ ] BACKEND_URL in `tracker.min.js`, `auth.js`, `dashboard.html` points to your deployed backend
- [ ] Backend `localhost:3000` in ALLOWED_ORIGINS removed (production only)
- [ ] Test login works end-to-end
- [ ] Test `/api/track` receives data and creates entries in your note service
- [ ] Test `/api/data` returns entries to the dashboard
- [ ] `.env` file is NOT committed to git
- [ ] `auth/` directory is NOT committed to git
- [ ] HTTPS is enforced on the backend (Cloudflare Workers and Vercel do this automatically)

---

**END OF SECURITY NOTES**  
**██████ CLASSIFICATION: INTERNAL USE ONLY ██████**
