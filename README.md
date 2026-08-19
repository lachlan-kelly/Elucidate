# Elucidate — Canvas AI Chat

A small local web app: pick a Canvas course and a specific module item,
assignment, discussion, or page, and it pulls that item's content into a chat
so you can ask questions about it, get a summary, etc. Replies stream in
token by token instead of appearing all at once.

## How it works

- A tiny Node/Express server (`server.js`) proxies requests to the Canvas API
  and to [BazaarLink](https://bazaarlink.ai), an OpenAI-compatible API
  gateway with a free tier. This is required because both APIs block direct
  browser requests (CORS), and because your Canvas token should not be
  exposed in client-side network calls to a third party.
- The frontend (`public/`) is plain HTML/CSS/JS — no build step.
- Chat replies stream: the server proxies BazaarLink's streaming response
  straight through as Server-Sent Events, and the browser reveals the text
  with a typing animation as it arrives.
- Your Canvas URL, Canvas token, and BazaarLink API key are entered in the
  browser once and saved so you don't have to retype them on reload — see
  **Where your keys are stored** below for exactly how and with what
  caveats.

## Setup

1. Install [Node.js](https://nodejs.org) version 18 or later (needed for
   built-in `fetch`).
2. Open a terminal in this folder and run:
   ```
   npm install
   npm start
   ```
3. Open `http://localhost:3000` in your browser.

## Getting your Canvas access token

1. Log into Canvas.
2. Go to **Account → Settings**.
3. Scroll to **Approved Integrations** and click **+ New Access Token**.
4. Give it a purpose (e.g. "AI chat tool"), leave the expiry blank or set one,
   and click **Generate Token**.
5. Copy the token immediately — Canvas only shows it once.

Your Canvas URL is the base address you use to log in, e.g.
`https://yourschool.instructure.com`.

## Getting your BazaarLink API key

1. Go to [bazaarlink.ai/free](https://bazaarlink.ai/free) and sign up (no
   card required).
2. Create a key under **Keys** — it looks like `sk-bl-...`.
3. In the app's model dropdown, leave it on **Auto (free)**. BazaarLink's
   `auto:free` model ID auto-routes each request to whichever free open
   model is currently available (their free tier draws from the Llama,
   Gemma, Qwen, and DeepSeek families, plus a persistent
   `deepseek/deepseek-v4-flash:free` model). If you want to force one
   specific model — for example a particular free Qwen model — check your
   BazaarLink dashboard's model catalog for its exact ID and paste it into
   **Custom model ID**; BazaarLink rejects any model ID it doesn't
   recognise, so it has to be copied exactly, not guessed.
4. The free tier is rate-limited (their docs currently state 10
   requests/minute, 150/day, doubling after any deposit). If you hit that
   limit mid-conversation, wait a bit or add credit on BazaarLink.

## Using it

1. Paste your Canvas URL, Canvas token, and BazaarLink API key into the
   **Connect** panel and click **Save & connect**.
2. Pick a course.
3. Pick a tab — **Modules**, **Assignments**, **Discussions**, or **Pages**.
   - Under Modules, click a module to see its items, then click an item.
4. The page's text loads into the preview pane at the top (click its
   header to collapse it down to just the title) and a new chat starts
   underneath. Ask anything about it — the reply types itself out live.
5. Your messages are labelled with your Canvas display name where
   available (falls back to "You"); replies are labelled with whichever
   model actually answered.
6. Use the **⟨** button above the sidebar to collapse it to a thin strip
   when you want more room for the chat.

## Where your keys are stored

Your Canvas URL, Canvas token, and BazaarLink key are encrypted (AES-GCM)
before being written to the browser's `localStorage`, and decrypted back
in-memory each time the page loads — that's what lets you skip re-entering
them.

**Be clear about what this does and doesn't protect against.** This is a
single-user local tool with no login or password, so there's no secret
outside the browser to derive an encryption key from — the decryption key
is generated on first run and stored in `localStorage` right alongside the
encrypted data. That means:

- It keeps your keys from sitting around as **plain, readable text** in
  `localStorage` or a casual look at devtools — genuinely useful against
  shoulder-surfing or a quick glance.
- It is **not** protection against someone with real access to this
  browser profile (same machine, same OS user account) — the key needed to
  decrypt is sitting right there for any script to read.

Don't use this on a shared or public machine with your real keys saved.
If you'd rather not persist them at all, clear the **Connect** panel's
fields and don't click Save, or clear `localStorage` for this site.

## Limitations

- **Video content isn't watched or transcribed.** If a page embeds a video
  (YouTube, Kaltura, Panopto, etc.), the app only sees the surrounding text
  and flags that a video link exists — it can't summarise the video itself
  unless Canvas exposes a transcript as text on the page.
- **Files** (PDFs, slides, etc.) are listed with a title and download link
  only; their contents aren't extracted.
- Only one page's content is in context at a time — the chat doesn't span
  multiple pages or the whole course at once.
- This is a single-user local tool with no login system. Don't deploy it
  publicly as-is — see the storage caveat above.

## Fonts

The design calls for "Copernicus" (Galaxie Copernicus), a commercial
typeface — see `public/fonts/README.txt` for how to add it if you own a
license. Without those files, the app falls back automatically to
**Literata**, a free Google Fonts serif that font-matching tools list as
one of the closest free equivalents.

## Project structure

```
elucidate/
├── server.js          Express server: Canvas + BazaarLink proxy routes (streaming)
├── package.json
└── public/
    ├── index.html
    ├── style.css
    ├── app.js
    └── fonts/          drop a licensed Copernicus here if you have one
```
