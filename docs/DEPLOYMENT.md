# ██████ PROJECT SILHOUETTE — DEPLOYMENT GUIDE ██████
## Step-by-Step Instructions for All Three Backend Platforms

---

**Classification:** INTERNAL USE ONLY

---

## PART 1 — BEFORE YOU BEGIN

### 1.1 Generate Required Credentials

**SHA-256 hash of your admin password:**

```bash
# Linux / macOS:
echo -n "yourpassword" | sha256sum

# Windows PowerShell:
$p = [System.Text.Encoding]::UTF8.GetBytes("yourpassword")
[BitConverter]::ToString([System.Security.Cryptography.SHA256]::Create().ComputeHash($p)).Replace("-","").ToLower()
```

**JWT secret (64-char random string):**

```bash
# Linux / macOS:
openssl rand -hex 32

# Windows PowerShell:
-join ((65..90)+(97..122)+(48..57) | Get-Random -Count 64 | % {[char]$_})
```

---

## PART 2 — CLOUDFLARE WORKERS (PRIMARY — FREE)

### Step 1: Install Wrangler CLI
```bash
npm install -g wrangler
wrangler login
```

### Step 2: Copy backend files
```
Copy: tracking-backend/cloudflare-worker/  →  your new directory
Copy: tracking-backend/lib/                →  same directory
```

Directory structure should be:
```
silhouette-worker/
├── wrangler.toml
├── package.json
└── src/
    └── index.js
lib/
├── formatter.js
├── google-tasks.js
├── evernote.js
└── onenote.js
```

### Step 3: Edit wrangler.toml
```toml
name = "silhouette-tracker"
account_id = "YOUR_CLOUDFLARE_ACCOUNT_ID"  # Dashboard → Right sidebar
```

Find your Account ID at: https://dash.cloudflare.com → select any zone → right sidebar.

### Step 4: Store secrets
```bash
wrangler secret put ADMIN_USERNAME
# Enter: your chosen username

wrangler secret put ADMIN_PASSWORD_HASH
# Enter: SHA-256 hash generated in Part 1

wrangler secret put JWT_SECRET
# Enter: 64-char random string from Part 1

wrangler secret put NOTE_SERVICE
# Enter: google-tasks

wrangler secret put GOOGLE_CLIENT_ID
wrangler secret put GOOGLE_CLIENT_SECRET
wrangler secret put GOOGLE_REFRESH_TOKEN
wrangler secret put GOOGLE_TASKLIST_ID
# (see docs/API-SETUP.md for how to get these values)
```

### Step 5: Deploy
```bash
cd silhouette-worker
npm install
wrangler deploy
```

Wrangler will print your Worker URL:
```
https://silhouette-tracker.YOUR_SUBDOMAIN.workers.dev
```

### Step 6: Connect GitHub Pages frontend
In **both** `tracker.min.js` and `auth.js`, replace the placeholder URL:

```
Search:  https://YOUR_WORKER.YOUR_SUBDOMAIN.workers.dev
Replace: https://silhouette-tracker.YOUR_SUBDOMAIN.workers.dev
```

Also update `dashboard.html` line with `DATA_ENDPOINT`.

Also update the `BACKEND_URL` in `tracker.js` (the unminified source).

### Step 7: Test
```bash
# Test health:
curl https://silhouette-tracker.YOUR_SUBDOMAIN.workers.dev/health

# Test track (should return 200):
curl -X POST https://silhouette-tracker.YOUR_SUBDOMAIN.workers.dev/api/track \
  -H "Content-Type: application/json" \
  -H "Origin: https://blueboop.is-a.dev" \
  -d '{"fingerprint":"test123","timestamp":"2026-03-06T00:00:00.000Z","browser":"Test","os":"TestOS"}'

# Test auth:
curl -X POST https://silhouette-tracker.YOUR_SUBDOMAIN.workers.dev/api/auth \
  -H "Content-Type: application/json" \
  -H "Origin: https://blueboop.is-a.dev" \
  -d '{"username":"admin","password":"yourpassword"}'
# → Should return: {"token":"eyJ..."}
```

---

## PART 3 — VERCEL FUNCTIONS (FREE ALTERNATIVE)

### Step 1: Install Vercel CLI
```bash
npm install -g vercel
vercel login
```

### Step 2: Copy backend files
```
Copy: tracking-backend/vercel-function/  →  your new directory
Copy: tracking-backend/lib/              →  same directory (as ../lib/)
```

### Step 3: Set environment variables in Vercel Dashboard

1. Go to https://vercel.com → Your Project → Settings → Environment Variables
2. Add the following variables (set to **Production** + **Preview** + **Development**):

| Variable              | Value                          |
|-----------------------|--------------------------------|
| `ADMIN_USERNAME`      | your admin username            |
| `ADMIN_PASSWORD_HASH` | SHA-256 hash of password       |
| `JWT_SECRET`          | 64-char random string          |
| `NOTE_SERVICE`        | `google-tasks`                 |
| `GOOGLE_CLIENT_ID`    | from Google Cloud Console      |
| `GOOGLE_CLIENT_SECRET`| from Google Cloud Console      |
| `GOOGLE_REFRESH_TOKEN`| from OAuth Playground          |
| `GOOGLE_TASKLIST_ID`  | from Tasks API                 |
| `ALLOWED_ORIGIN_1`    | `https://blueboop.is-a.dev`    |
| `ALLOWED_ORIGIN_2`    | `https://nicholas-tritsaris.github.io` |

### Step 4: Deploy
```bash
cd vercel-function-dir
npm install
vercel --prod
```

Vercel will print your deployment URL:
```
https://your-project.vercel.app
```

### Step 5: Connect GitHub Pages frontend
Replace the placeholder URL in `tracker.min.js`, `auth.js`, and `dashboard.html`:
```
https://YOUR_WORKER.YOUR_SUBDOMAIN.workers.dev
→
https://your-project.vercel.app
```

---

## PART 4 — NODE.JS EXPRESS (VPS)

### Step 1: Set up VPS
```bash
# On your VPS (Ubuntu/Debian example):
sudo apt update && sudo apt install -y nodejs npm nginx

# Install PM2 process manager (keeps server running):
npm install -g pm2
```

### Step 2: Copy backend files to VPS
```bash
# Using scp or Git:
scp -r tracking-backend/express-server/ user@your-vps:/opt/silhouette/
scp -r tracking-backend/lib/           user@your-vps:/opt/silhouette/lib/
```

### Step 3: Configure environment
```bash
cd /opt/silhouette/express-server
cp .env.example .env
nano .env  # Fill in your values
chmod 600 .env  # Restrict access

npm install
```

### Step 4: Start with PM2
```bash
npm run pm2
pm2 save
pm2 startup  # Auto-restart on reboot
```

### Step 5: Configure Nginx reverse proxy (optional but recommended)
```nginx
# /etc/nginx/sites-available/silhouette
server {
    listen 80;
    server_name tracker.your-domain.com;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/silhouette /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

Add SSL with Let's Encrypt:
```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d tracker.your-domain.com
```

### Step 6: Connect GitHub Pages frontend
Replace the placeholder URL:
```
https://YOUR_WORKER.YOUR_SUBDOMAIN.workers.dev
→
https://tracker.your-domain.com
```

---

## PART 5 — CONNECTING GITHUB PAGES TO THE BACKEND

### 5.1 Files to update after backend deployment

After deploying your chosen backend, update these two files in your GitHub Pages repo:

**`tracker.min.js`** — line 1 (the `B=` variable):
```javascript
var B='https://YOUR_ACTUAL_BACKEND_URL/api/track';
```

**`auth.js`** — line at `AUTH_ENDPOINT`:
```javascript
var AUTH_ENDPOINT = 'https://YOUR_ACTUAL_BACKEND_URL/api/auth';
```

**`dashboard.html`** — line at `DATA_ENDPOINT`:
```javascript
var DATA_ENDPOINT = 'https://YOUR_ACTUAL_BACKEND_URL/api/data';
```

### 5.2 Commit and push
```bash
git add tracker.min.js auth.js dashboard.html
git commit -m "Configure backend endpoint URL"
git push origin main
```

GitHub Pages auto-deploys within ~2 minutes.

### 5.3 Verify end-to-end
1. Visit `https://blueboop.is-a.dev`
2. Open Browser DevTools → Network tab
3. Look for a POST request to `/api/track` → should return `200 { "status": "ok" }`
4. Click the LOGIN button (top-right)
5. Enter your admin username and password
6. You should be redirected to `https://blueboop.is-a.dev/dashboard.html`
7. Dashboard should load and fetch tracking entries

---

## PART 6 — ADMIN CREDENTIALS FOLDER

The user requested a folder with login credentials. For security, credentials are stored in the backend environment — NOT in the repo. However, for reference:

Create `auth/` directory locally (add to `.gitignore`):
```
auth/
  credentials.md   ← Your reference doc (NEVER commit this)
```

`auth/credentials.md` content template:
```markdown
# Admin Credentials — DO NOT COMMIT

Username: admin
Password: (your chosen password)
Password SHA-256: (hash)
JWT Secret: (64-char string)
Backend URL: https://YOUR_WORKER.workers.dev

Generated: 2026-03-06
```

Add `auth/` to `.gitignore`:
```bash
echo "auth/" >> .gitignore
```

---

**END OF DEPLOYMENT GUIDE**  
**██████ CLASSIFICATION: INTERNAL USE ONLY ██████**
