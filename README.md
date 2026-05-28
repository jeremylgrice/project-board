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

## 🌐 Hosting on the internet (optional)

If you want to access it from anywhere (not just home Wi-Fi), you have a few options:

### Option A: Tailscale (easiest, free)
1. Install [Tailscale](https://tailscale.com) on the server computer and both phones
2. Use your Tailscale IP instead of the local IP

### Option B: VPS (always online)
Deploy to a cheap VPS (DigitalOcean, Hetzner, etc.):
```bash
# On the server
PORT=3000 node server.js

# Use nginx or Caddy as a reverse proxy with HTTPS
```

### Option C: Fly.io / Railway (simple cloud deploy)
Both support Node.js with persistent volumes for the SQLite file.

---

## 📁 Data
All notes are stored in `data.db` (SQLite) in the project folder.
Back it up occasionally — it's just a single file.

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
