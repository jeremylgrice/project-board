# 🏡 Our Space — Self-hosted Shared Notes

A private, self-hosted Notion-like app for two people.
Both of you can open it from your phones and edits sync live.

---

## ✅ Features
- **Block-based editor** — paragraphs, headings, bullets, numbered lists, to-dos, quotes, code, callouts, dividers
- **Slash commands** — type `/` to pick any block type
- **Nested pages** — create sub-pages from the sidebar
- **Emoji page icons** — click the emoji to change it
- **Live sync** — WebSocket pushes changes to the other person instantly
- **Mobile-friendly** — full responsive design, works great on phones
- **Self-hosted** — your data never leaves your machine

---

## 🚀 Setup (first time)

### Requirements
- [Node.js 18+](https://nodejs.org) installed on your computer/server

### Environment variables

Create a file called `.env` in the project root folder (same folder as `server.js`). Paste in the following and fill in each value:

```
SESSION_SECRET=<random long string>

GOOGLE_CLIENT_ID=<from Google Cloud Console>
GOOGLE_CLIENT_SECRET=<from Google Cloud Console>
ALLOWED_EMAILS=you@example.com,partner@example.com

FIREBASE_SERVICE_ACCOUNT=<paste service account JSON as a single line — see below>

APP_URL=http://localhost:3000
```

---

#### `SESSION_SECRET`
Any long random string — used to sign login cookies. You can generate one by running this in your terminal:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```
Paste the output as the value.

---

#### `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`
This app uses Google sign-in. You need to register it in Google Cloud:

1. Go to [console.cloud.google.com](https://console.cloud.google.com)
2. Create a new project (or select your existing one)
3. In the left menu go to **APIs & Services → OAuth consent screen**
   - Choose **External**, click Create
   - Fill in an app name (e.g. "Our Space"), your email for support and developer contact
   - Click Save and Continue through the rest (no scopes needed, no test users needed)
4. In the left menu go to **APIs & Services → Credentials**
   - Click **+ Create Credentials → OAuth client ID**
   - Application type: **Web application**
   - Under **Authorised redirect URIs**, add: `http://localhost:3000/auth/google/callback`
   - Click Create
5. Copy the **Client ID** → paste as `GOOGLE_CLIENT_ID`
6. Copy the **Client Secret** → paste as `GOOGLE_CLIENT_SECRET`

---

#### `ALLOWED_EMAILS`
A comma-separated list of Google account email addresses that are allowed to log in. Anyone not on this list will be blocked even if they sign in with Google successfully. Example:
```
ALLOWED_EMAILS=you@gmail.com,partner@gmail.com
```

---

#### `FIREBASE_SERVICE_ACCOUNT`
The app stores all data in Firebase Firestore. You need a service account key to give the server permission to read/write it.

1. Go to [console.firebase.google.com](https://console.firebase.google.com)
2. Select your project (create one if needed)
3. In the left menu go to **Project Settings** (gear icon) → **Service accounts** tab
4. Click **Generate new private key** → **Generate key**
5. A JSON file will download to your computer — open it in a text editor
6. Select all the text and copy it
7. Paste it as the value of `FIREBASE_SERVICE_ACCOUNT` — it must be on a **single line with no line breaks**

   If you paste it and it ends up on multiple lines, you can collapse it to one line by running:
   ```bash
   cat your-downloaded-file.json | tr -d '\n'
   ```
   Then paste that output as the value.

Also make sure Firestore is enabled in your Firebase project:
- In the Firebase Console left menu go to **Build → Firestore Database**
- Click **Create database**, choose **Start in production mode**, pick a region, click Enable

---

#### `APP_URL`
The base URL the server is running at. For local development this is always:
```
APP_URL=http://localhost:3000
```
If you deploy to a server with a domain, change it to that (e.g. `https://ourspace.example.com`). This is used for the Google OAuth callback URL.

---

**To add a new env key in the future:** add `KEY=value` on a new line in `.env`, grouped with related keys or at the bottom. Then restart the server.

### Steps

```bash
# 1. Install dependencies (only needed once)
npm install

# 2. Start the server
npm start
```

You'll see output like:
```
✅  Our Notion is running!

   💻  Local:   http://localhost:3000
   📱  Phone:   http://192.168.1.42:3000
```

**Open the Phone URL on both your phones** (must be on the same Wi-Fi).

---

## 📱 Using from your phones

1. Make sure your computer (the one running the server) is on and awake
2. Both phones must be on the same Wi-Fi as the server computer
3. Open the Phone URL shown in the terminal in your mobile browser
4. Optionally: **Add to Home Screen** from your browser menu for an app-like experience

---

## 🌐 Hosting

This app is hosted on **Railway** at [railway.app](https://railway.app).

### Deploying / redeploying to Railway

1. Push your changes to the `main` branch on GitHub — Railway auto-deploys on push
2. Or trigger a manual deploy from the Railway dashboard

### Environment variables on Railway

Railway has its own env var store — the `.env` file is **not** uploaded. You need to set each variable in the Railway dashboard:

1. Open your project on [railway.app](https://railway.app)
2. Click your service → **Variables** tab
3. Add each key from your `.env` file one by one (`SESSION_SECRET`, `GOOGLE_CLIENT_ID`, etc.)
4. Make sure `APP_URL` is set to your Railway public URL (e.g. `https://your-app.up.railway.app`)
5. Railway restarts the service automatically after saving

### Google OAuth callback URL

When running on Railway (not localhost), you need to add your Railway URL as an authorised redirect URI in Google Cloud:

1. Go to [console.cloud.google.com](https://console.cloud.google.com) → APIs & Services → Credentials
2. Click your OAuth client
3. Under **Authorised redirect URIs** add: `https://your-app.up.railway.app/auth/google/callback`
4. Click Save

---

## 📁 Data
All notes are stored in **Firebase Firestore** (cloud). Data is tied to your Firebase project — no local database file to back up.

---

## 🛠 Development / auto-restart
```bash
npm run dev   # Uses node --watch (Node 18+)
```

---

## Keyboard shortcuts
| Key | Action |
|-----|--------|
| `Enter` | New block below |
| `Shift+Enter` | Line break within block |
| `Backspace` (empty block) | Delete block |
| `Tab` | Indent list item |
| `Shift+Tab` | Dedent list item |
| `/` | Open block type menu |
| `↑` / `↓` | Move between blocks |
# project-board
