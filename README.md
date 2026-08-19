# Elucidate

Website based application for creating a bridge between
Canvas (instructure.com) and your choice of LLM to improve
QOL in schoolwork.

## How it works

- Uses [BazaarLink](https://bazaarlink.ai/) to access quality LLM's for low or no prices
  such as [Deepseek](https://www.deepseek.com/) and [Qwen](https://qwen.ai/)
- The website extracts needed information from your [Canvas](https://www.instructure.com/) acount
  and presents it to the LLM as source information, NOT training data
- The user then communicates with the model as a chatbot with full context to your canvas assignment or modules, etc

## Setup

1. Get a [Canvas](https://www.instructure.com/) access token, click [here](#Getting-your-Canvas-access-token) for instructions
2. Get a BazaarLink API key, click [here](#Getting-your-BazaarLink-API-key) for instructions
3. Get your organisations canvas url from your dashboard
4. Add all the information in Elucidate, and your good to go

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
3. In the model dropdown on Elucidate, leave it on **Auto (free)**, unless you understand how model ID's work.
   BazaarLink's `auto:free` model ID auto-routes each request to whichever free open
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
