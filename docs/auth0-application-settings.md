# Auth0 Application Settings for Blueboop SPA

This guide explains how to configure your Auth0 Application to work with the **Blueboop Single Page Application (SPA)**. For this setup, we assume no dedicated backend API exists yet.

## Basic Information
- **Domain**: Your Auth0 tenant domain (e.g., `blueboop.au.auth0.com`). This is used as `AUTH0_DOMAIN` in `auth.js`.
- **Client ID**: A unique identifier for your application. This is used as `AUTH0_CLIENT_ID` in `auth.js`.
- **Client Secret**: **DO NOT USE DIRECTLY.** SPAs cannot safely store secrets. The Auth0 SPA SDK uses the PKCE flow to authenticate without a client secret.

## Application Type
- **Choose**: **Single Page Application**
- **Why**: This application is a static site (HTML/JS) running entirely in the user's browser. Choosing "Single Page Application" enables the correct security profiles and default configurations (like PKCE) for this architecture.

## Application URIs
Fill in these fields based on where your app is hosted (e.g., `https://blueboop.is-a.dev`).

### Application Login URI
- **Value**: `https://blueboop.is-a.dev/`
- **Explanation**: This is where Auth0 will redirect users when an authentication request is triggered by Auth0 itself.

### Allowed Callback URLs
- **Value**: `https://blueboop.is-a.dev/`, `https://blueboop.is-a.dev/dashboard.html`, `http://localhost:3000/` (for local development)
- **Explanation**: A comma-separated list of URLs that Auth0 is allowed to redirect to after a user logs in. For Blueboop, this must include both the homepage and the dashboard URL.

### Allowed Logout URLs
- **Value**: `https://blueboop.is-a.dev/`, `http://localhost:3000/`
- **Explanation**: A comma-separated list of URLs that Auth0 is allowed to redirect to after a user logs out.

### Allowed Web Origins
- **Value**: `https://blueboop.is-a.dev`, `http://localhost:3000`
- **Explanation**: URLs that are allowed to perform "Silent Authentication" (refreshing tokens without a full page redirect).

### Allowed CORS Origins
- **Value**: `https://blueboop.is-a.dev`, `http://localhost:3000`
- **Explanation**: URLs allowed to make Cross-Origin Resource Sharing (CORS) requests to Auth0's APIs.

## Advanced Options
For a basic SPA, you can leave these as default (usually disabled):
- **Back-Channel Logout**: Not needed for simple SPAs.
- **Refresh Token Rotation**: Recommended for better security in SPAs, but optional for initial setup.
- **MRRT (Multi-Resource Refresh Tokens)**: Not needed without a backend API.
- **Token Sender-Constraining**: Can be left disabled.
- **PAR (Pushed Authorization Requests)** and **JAR**: Can be left disabled.

## ⚠️ Warning: Destructive Actions
In the "Danger Zone" or "Advanced Settings" sections, **do not** perform the following without understanding the impact:
- **Rotate Client Secret**: While not used by the SPA, it might be used by other parts of your system.
- **Delete Application**: This will immediately break login for all users of this project.

---

## Quick Setup Checklist for Blueboop SPA
1. [ ] Create a new application in the Auth0 Dashboard.
2. [ ] Set the name to "Blueboop SPA".
3. [ ] Select **Single Page Application** as the application type.
4. [ ] Copy the **Domain** and **Client ID** into your `auth.js` configuration.
5. [ ] In the **Settings** tab, scroll down to **Application URIs**.
6. [ ] Add `https://blueboop.is-a.dev/`, `https://blueboop.is-a.dev/dashboard.html`, and `http://localhost:3000/` to **Allowed Callback URLs**.
7. [ ] Add `https://blueboop.is-a.dev/` and `http://localhost:3000/` to **Allowed Logout URLs**.
8. [ ] Add `https://blueboop.is-a.dev` and `http://localhost:3000` to **Allowed Web Origins**.
9. [ ] Add `https://blueboop.is-a.dev` and `http://localhost:3000` to **Allowed CORS Origins**.
10. [ ] Scroll to the bottom and click **Save Changes**.
