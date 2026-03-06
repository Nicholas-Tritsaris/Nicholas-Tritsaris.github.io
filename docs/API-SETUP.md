# ██████ PROJECT SILHOUETTE — API SETUP GUIDE ██████
## Evernote, Google Tasks, and OneNote API Credentials

---

**Classification:** INTERNAL USE ONLY

---

## OPTION A — GOOGLE TASKS API (RECOMMENDED — FREE, HIGH LIMITS)

### Why Google Tasks?
- Completely free
- ~50,000 requests/day per project
- Simple REST API
- Works in all environments (Cloudflare Workers, Vercel, Express)
- Tasks viewable at: https://tasks.google.com

### Step 1: Create a Google Cloud Project

1. Go to https://console.cloud.google.com
2. Click **New Project** → Name it "Silhouette Tracker" → Create
3. Select the new project

### Step 2: Enable Google Tasks API

1. In the project: **APIs & Services** → **Library**
2. Search "Tasks API" → Click **Google Tasks API** → **Enable**

### Step 3: Create OAuth 2.0 Credentials

1. Go to **APIs & Services** → **Credentials**
2. Click **Create Credentials** → **OAuth client ID**
3. If prompted, configure consent screen:
   - User Type: **External**
   - App name: "Silhouette Tracker"
   - Support email: your email
   - Scopes: add `https://www.googleapis.com/auth/tasks`
   - Test users: add your Gmail address
4. Application type: **Web application**
5. Name: "Silhouette Backend"
6. Authorized redirect URIs: `https://developers.google.com/oauthplayground`
7. Click **Create**
8. **Download the JSON** or note down:
   - `client_id` → `GOOGLE_CLIENT_ID`
   - `client_secret` → `GOOGLE_CLIENT_SECRET`

### Step 4: Get a Refresh Token (OAuth Playground)

1. Go to https://developers.google.com/oauthplayground
2. Click the settings gear icon (top right) → **Use your own OAuth credentials**
3. Enter your `client_id` and `client_secret`
4. In the left panel, find **Tasks API v1** → Select `https://www.googleapis.com/auth/tasks`
5. Click **Authorize APIs** → sign in with your Google account → Allow
6. Click **Exchange authorization code for tokens**
7. Copy the **Refresh token** → `GOOGLE_REFRESH_TOKEN`

**The refresh token does not expire (unless revoked).**

### Step 5: Get the Task List ID

```bash
# Use curl to get your task list IDs:
curl "https://tasks.googleapis.com/tasks/v1/users/@me/lists" \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN"
```

Or use https://developers.google.com/tasks/reference/rest/v1/tasklists/list

Find the `id` of your target list → `GOOGLE_TASKLIST_ID`

**Tip:** Create a dedicated task list named "Silhouette Visits" and use its ID.

---

## OPTION B — EVERNOTE API

### Limitations
- 100 API calls/hour on free tier (developer token)
- Dashboard data retrieval requires Node.js Express (Thrift protocol)
- Not recommended for high-traffic sites

### Step 1: Create an Evernote Account

Sign up at https://evernote.com if you don't have an account.

### Step 2: Get a Developer Token

1. Go to https://www.evernote.com/api/DeveloperToken.action
2. Log in with your Evernote credentials
3. Click **Create a developer token**
4. Copy the token → `EVERNOTE_DEV_TOKEN`

**The developer token never expires and allows full access to your account.**

### Step 3: Get the Notebook GUID

1. Open Evernote web at https://www.evernote.com/client/web
2. Create a new notebook called "Silhouette Visits"
3. Use the Evernote API to find the GUID:

```bash
# Using the Evernote API Explorer or:
curl "https://www.evernote.com/edam/user" \
  -H "Authorization: S=s1:U=abc:..." \
  # Note: Direct REST queries to NoteStore require Thrift. Use the Node.js SDK:
```

With Node.js SDK:
```javascript
const Evernote = require('@evernote/evernote');
const client = new Evernote.Client({ token: process.env.EVERNOTE_DEV_TOKEN });
const noteStore = await client.getNoteStore();
const notebooks = await noteStore.listNotebooks();
notebooks.forEach(nb => console.log(nb.name, nb.guid));
```

Copy the GUID of your "Silhouette Visits" notebook → `EVERNOTE_NOTEBOOK_GUID`

### Step 4: Install Evernote SDK (Express server only)

```bash
cd tracking-backend/express-server
npm install @evernote/evernote
```

---

## OPTION C — ONENOTE (MICROSOFT GRAPH)

### Limitations
- ~70 requests/minute per user
- Requires Azure App Registration
- Slightly more complex setup than Google Tasks

### Step 1: Create an Azure App Registration

1. Go to https://portal.azure.com → **Azure Active Directory** → **App registrations**
2. Click **New registration**
3. Name: "Silhouette Tracker"
4. Supported account types: **Accounts in any organizational directory and personal Microsoft accounts**
5. Redirect URI: **Web** → `https://oauth.pstmn.io/v1/callback` (for Postman) or `https://developers.microsoft.com`
6. Click **Register**
7. Note down:
   - **Application (client) ID** → `MS_CLIENT_ID`

### Step 2: Create a Client Secret

1. In your app registration: **Certificates & secrets** → **New client secret**
2. Description: "Silhouette Backend"
3. Expiry: **24 months**
4. Click **Add**
5. Copy the **Value** immediately → `MS_CLIENT_SECRET` (won't be shown again!)

### Step 3: Add API Permissions

1. In your app: **API permissions** → **Add a permission** → **Microsoft Graph**
2. Click **Delegated permissions**
3. Search and add:
   - `Notes.ReadWrite`
   - `Notes.Create`
   - `offline_access` (required for refresh tokens)
4. Click **Grant admin consent** if available

### Step 4: Get a Refresh Token

Use Postman or OAuth 2.0 Playground:

**Authorization URL:**
```
https://login.microsoftonline.com/consumers/oauth2/v2.0/authorize
?client_id=YOUR_CLIENT_ID
&response_type=code
&redirect_uri=https://oauth.pstmn.io/v1/callback
&scope=Notes.ReadWrite%20Notes.Create%20offline_access
&response_mode=query
```

**Token URL:**
```
https://login.microsoftonline.com/consumers/oauth2/v2.0/token
```

**POST body:**
```
client_id=YOUR_CLIENT_ID
client_secret=YOUR_CLIENT_SECRET
grant_type=authorization_code
code=AUTH_CODE_FROM_ABOVE
redirect_uri=https://oauth.pstmn.io/v1/callback
scope=Notes.ReadWrite Notes.Create offline_access
```

Copy the `refresh_token` → `MS_REFRESH_TOKEN`

### Step 5: Get the Section ID

1. Open OneNote at https://www.onenote.com
2. Create a new notebook called "Silhouette" and a section called "Visits"
3. Call the Graph API to find the section ID:

```bash
# First get an access token using your refresh token, then:
curl "https://graph.microsoft.com/v1.0/me/onenote/sections" \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN"
# Find section "Visits" and copy its id → MS_SECTION_ID
```

---

## OPTION D — FIREBASE FIRESTORE (RECOMMENDED)

### Why Firestore?
- Completely free tier: 50,000 reads/day, 20,000 writes/day, 1GB storage
- Simple REST API — works in all environments (Cloudflare Workers, Vercel, Express)
- Native JSON storage — no need to parse/serialize
- Real-time updates built-in (for guestbook/hit counter on frontend)
- No OAuth flow — just service account authentication

### Step 1: Create a Firebase Project

1. Go to https://console.firebase.google.com
2. Click **Create a project** → Name it "Silhouette"
3. Disable Google Analytics (not needed for this project)
4. Click **Create project**

### Step 2: Enable Firestore

1. In Firebase Console: **Build** → **Firestore Database**
2. Click **Create database**
3. Choose **Start in production mode** (recommended for security)
4. Select a region (closest to your users)
5. Click **Enable**

### Step 3: Create a Service Account

1. In Firebase Console: **Project Settings** (gear icon ⚙️)
2. Go to **Service accounts** tab
3. Click **Generate new private key**
4. Click **Generate key** — a JSON file downloads
5. Open the JSON and extract these values:

| JSON Field | → Environment Variable |
|---|---|
| `project_id` | `FIREBASE_PROJECT_ID` |
| `client_email` | `FIREBASE_CLIENT_EMAIL` |
| `private_key` | `FIREBASE_PRIVATE_KEY` (see note below) |

**Important for `FIREBASE_PRIVATE_KEY`:** The JSON contains `\n` for line breaks. Keep these! In your `.env` file, either:
- Use double quotes and preserve `\n`: `"-----BEGIN PRIVATE KEY-----\nMII..."`
- Or use actual newlines with proper escaping

### Step 4: Set Up Firestore Collection

1. In Firestore Database: **Start collection**
2. Collection ID: `silhouette_visits`
3. Document ID: Leave auto-generated (or create a placeholder)
4. Click **Save**

The tracking backend will automatically create entries in this collection.

### Step 5: Update Configuration

**For Express server (.env):**
```
NOTE_SERVICE=firestore
FIREBASE_PROJECT_ID=your-project-id
FIREBASE_CLIENT_EMAIL=firebase-adminsdk@your-project.iam.gserviceaccount.com
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nMIIE...\n-----END PRIVATE KEY-----\n"
```

**For Cloudflare Workers (wrangler secrets):**
```bash
wrangler secret put NOTE_SERVICE
# (enter "firestore" when prompted)

wrangler secret put FIREBASE_PROJECT_ID
wrangler secret put FIREBASE_CLIENT_EMAIL
wrangler secret put FIREBASE_PRIVATE_KEY
```

---

## SUMMARY TABLE

| Setting                | Google Tasks                  | Evernote                     | OneNote             | Firestore             |
|------------------------|-------------------------------|------------------------------|---------------------|-----------------------|
| `NOTE_SERVICE`         | `google-tasks`                | `evernote`                   | `onenote`           | `firestore`           |
| Primary credential     | `GOOGLE_REFRESH_TOKEN`        | `EVERNOTE_DEV_TOKEN`         | `MS_REFRESH_TOKEN`  | Service Account JSON  |
| Container ID           | `GOOGLE_TASKLIST_ID`          | `EVERNOTE_NOTEBOOK_GUID`     | `MS_SECTION_ID`     | Collection: `silhouette_visits` |
| Rate limit             | ~50K req/day                  | 100 req/hour                 | ~70 req/min         | 50K reads + 20K writes/day |
| Dashboard data via API | ✅ Full support               | ⚠️ Express only (Thrift)    | ✅ Full support     | ✅ Full support       |
| Cost                   | Free                          | Free (dev token)             | Free                | Free (generous tier) |
| Complexity             | Easy                          | Medium                       | Hard                | Easy                  |

---

**END OF API SETUP GUIDE**  
**██████ CLASSIFICATION: INTERNAL USE ONLY ██████**
