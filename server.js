import express from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import pdf from "pdf-parse";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());
app.use(express.json({ limit: "2mb" }));
app.use(express.static(path.join(__dirname, "public")));

const PORT = process.env.PORT || 3000;

// ---------- helpers ----------

function cleanBase(url) {
  return String(url || "").trim().replace(/\/+$/, "");
}

async function canvasFetch(canvasUrl, canvasToken, endpoint) {
  const url = `${cleanBase(canvasUrl)}/api/v1${endpoint}`;
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${canvasToken}` }
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Canvas API error ${response.status}: ${body.slice(0, 300)}`);
  }
  return response.json();
}

function htmlToText(html) {
  if (!html) return "";
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<\/li>/gi, "\n")
    .replace(/<li[^>]*>/gi, "- ")
    .replace(/<\/h[1-6]>/gi, "\n\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// Pull any obviously-embedded video/media links out of raw HTML so the
// frontend can flag them (Canvas does not expose video transcripts via API).
function findMediaHints(html) {
  if (!html) return [];
  const hints = [];
  const iframeSrcs = [...html.matchAll(/<iframe[^>]+src=["']([^"']+)["']/gi)].map(m => m[1]);
  for (const src of iframeSrcs) {
    if (/youtube|vimeo|kaltura|panopto|stream\.|video/i.test(src)) hints.push(src);
  }
  return [...new Set(hints)];
}

// ---------- Canvas routes ----------

app.post("/api/canvas/courses", async (req, res) => {
  const { canvasUrl, canvasToken } = req.body;
  try {
    const courses = await canvasFetch(
      canvasUrl,
      canvasToken,
      "/courses?enrollment_state=active&per_page=100"
    );
    res.json(
      courses
        .filter(c => c && !c.access_restricted_by_date)
        .map(c => ({ id: c.id, name: c.name || c.course_code || `Course ${c.id}` }))
    );
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/canvas/items", async (req, res) => {
  const { canvasUrl, canvasToken, courseId, type } = req.body;
  try {
    let data;
    if (type === "modules") {
      data = await canvasFetch(canvasUrl, canvasToken, `/courses/${courseId}/modules?per_page=100`);
      data = data.map(m => ({ id: m.id, name: m.name }));
    } else if (type === "assignments") {
      data = await canvasFetch(canvasUrl, canvasToken, `/courses/${courseId}/assignments?per_page=100`);
      data = data.map(a => ({ id: a.id, name: a.name, meta: a.due_at ? `due ${a.due_at.slice(0, 10)}` : "" }));
    } else if (type === "discussions") {
      data = await canvasFetch(canvasUrl, canvasToken, `/courses/${courseId}/discussion_topics?per_page=100`);
      data = data.map(d => ({ id: d.id, name: d.title, meta: "" }));
    } else if (type === "pages") {
      data = await canvasFetch(canvasUrl, canvasToken, `/courses/${courseId}/pages?per_page=100`);
      data = data.map(p => ({ id: p.url, name: p.title, meta: "" }));
    } else {
      return res.status(400).json({ error: "Unknown content type" });
    }
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Second-level list: items inside a chosen module
app.post("/api/canvas/module-items", async (req, res) => {
  const { canvasUrl, canvasToken, courseId, moduleId } = req.body;
  try {
    const items = await canvasFetch(
      canvasUrl,
      canvasToken,
      `/courses/${courseId}/modules/${moduleId}/items?per_page=100`
    );
    res.json(
      items.map(i => ({
        id: i.id,
        name: i.title,
        type: i.type, // Page, Assignment, Discussion, Quiz, File, ExternalUrl, SubHeader
        content_id: i.content_id,
        page_url: i.page_url,
        html_url: i.html_url,
        external_url: i.external_url
      }))
    );
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Fetch and extract the real content of a chosen item
app.post("/api/canvas/content", async (req, res) => {
  const { canvasUrl, canvasToken, courseId, type, itemId } = req.body;
  try {
    let title = "";
    let rawHtml = "";
    let extra = "";
    let htmlUrl = "";

    const t = String(type || "").toLowerCase();

    if (t === "assignment") {
      const a = await canvasFetch(canvasUrl, canvasToken, `/courses/${courseId}/assignments/${itemId}`);
      title = a.name;
      rawHtml = a.description;
      htmlUrl = a.html_url;
      extra = [
        a.due_at ? `Due: ${a.due_at}` : "",
        a.points_possible != null ? `Points possible: ${a.points_possible}` : ""
      ]
        .filter(Boolean)
        .join("\n");
    } else if (t === "discussion") {
      const d = await canvasFetch(canvasUrl, canvasToken, `/courses/${courseId}/discussion_topics/${itemId}`);
      title = d.title;
      rawHtml = d.message;
      htmlUrl = d.html_url;
    } else if (t === "page") {
      const p = await canvasFetch(
        canvasUrl,
        canvasToken,
        `/courses/${courseId}/pages/${encodeURIComponent(itemId)}`
      );
      title = p.title;
      rawHtml = p.body;
      htmlUrl = p.html_url;
    } else if (t === "quiz") {
      const q = await canvasFetch(canvasUrl, canvasToken, `/courses/${courseId}/quizzes/${itemId}`);
      title = q.title;
      rawHtml = q.description;
      htmlUrl = q.html_url;
    } else if (t === "file") {
      const f = await canvasFetch(canvasUrl, canvasToken, `/courses/${courseId}/files/${itemId}`);
      title = f.display_name;
      extra = `File type: ${f.content_type}\nDownload link: ${f.url}`;
      rawHtml = "";
      htmlUrl = f.html_url;
    } else {
      return res.status(400).json({ error: `Unsupported content type: ${type}` });
    }

    const body = htmlToText(rawHtml) || "(No text content on this item.)";
    const mediaHints = findMediaHints(rawHtml);

    res.json({ title, body, extra, mediaHints, htmlUrl });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// New endpoint: POST /api/canvas/file-content
app.post("/api/canvas/file-content", async (req, res) => {
  const { canvasUrl, canvasToken, courseId, fileId } = req.body;
  try {
    const file = await canvasFetch(canvasUrl, canvasToken, `/courses/${courseId}/files/${fileId}`);
    const downloadResponse = await fetch(file.url, {
      headers: { Authorization: `Bearer ${canvasToken}` }
    });
    
    if (!downloadResponse.ok) {
      throw new Error(`Failed to download file: ${downloadResponse.status}`);
    }

    const contentType = file.content_type;
    
    if (contentType === 'application/pdf') {
      const arrayBuffer = await downloadResponse.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      const pdfData = await pdf(buffer);
      
      return res.json({
        title: file.display_name,
        body: pdfData.text,
        contentType: 'application/pdf'
      });
    } else if (contentType && contentType.startsWith('text/')) {
      const textContent = await downloadResponse.text();
      return res.json({
        title: file.display_name,
        body: textContent,
        contentType
      });
    } else {
      return res.json({
        title: file.display_name,
        body: '(Binary file — contents cannot be displayed as text.)',
        contentType,
        downloadUrl: file.url
      });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Current Canvas user's display name, for the "sender" label above chat bubbles
app.post("/api/canvas/me", async (req, res) => {
  const { canvasUrl, canvasToken } = req.body;
  try {
    const me = await canvasFetch(canvasUrl, canvasToken, "/users/self");
    res.json({ name: me.short_name || me.name || "" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------- AI chat route ----------

// BazaarLink is an OpenAI-compatible gateway (https://bazaarlink.ai). Its
// free tier is accessed via the model id "auto:free", which auto-routes to
// whichever free open model (Llama / Gemma / Qwen / DeepSeek family) is
// available. Change BAZAARLINK_BASE_URL below if your account's docs show a
// different host.
const BAZAARLINK_BASE_URL = "https://bazaarlink.ai/api/v1";

// Streams the reply back as Server-Sent Events, forwarded almost verbatim
// from BazaarLink's own streaming response, so the frontend can render
// tokens as they arrive instead of waiting for the full reply.
app.post("/api/chat", async (req, res) => {
  let { bazaarKey, model, context, messages, systemInstructions, attachments } = req.body;
  if (!bazaarKey) return res.status(400).json({ error: "Missing BazaarLink API key" });
  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: "No messages provided" });
  }

  if (attachments && Array.isArray(attachments) && attachments.length > 0) {
    const lastUserMsgIdx = messages.findLastIndex(m => m.role === "user");
    if (lastUserMsgIdx !== -1) {
      let appendedContent = "";
      for (const att of attachments) {
        appendedContent += `\n\n---ATTACHED FILE: ${att.name}---\n${att.content}\n---END ATTACHED FILE---`;
      }
      messages[lastUserMsgIdx].content += appendedContent;
    }
  }

  const mediaNote =
    context?.mediaHints?.length
      ? `\nEmbedded media links found on this page (titles/content not extracted, transcripts unavailable):\n${context.mediaHints.join(
          "\n"
        )}\n`
      : "";

  let systemPrompt = "";
  
  if (systemInstructions) {
    systemPrompt += `The user has provided the following custom instructions that you must follow:\n---\n${systemInstructions}\n---\n\n`;
  }

  systemPrompt += `You are a study assistant helping a student with one specific Canvas course page. Base your answers on the material below plus your general knowledge. If the student asks about a video and you only have a link (no transcript), say plainly that you can't watch it and offer to help another way instead of guessing at its content.

Style guidelines for every reply:
- Never use emoji (no colourful pictograms like 📄, ✅, 💡). If a visual marker genuinely helps, use plain typographic symbols instead (e.g. →, •, ✓, ✗), used sparingly.
- Format with clean Markdown: ## / ### headings for structure, **bold** for key terms, bullet or numbered lists for steps or sets of items, short paragraphs. Keep it modern and easy to scan, not cluttered or wall-of-text.
- When asked to run a quiz: ask one question at a time, wait for the student's answer before asking the next, and check each answer as it comes in rather than saving feedback for the end.
- When asked to mark an essay against a marking guide or rubric: work through the rubric criteria one by one, note where the essay does and doesn't meet each one, and give an overall rough grade estimate with the reasoning behind it.

--- CANVAS PAGE: ${context?.title || "(untitled)"} ---
${context?.extra ? context.extra + "\n" : ""}${mediaNote}
${context?.body || "(no content extracted)"}
--- END CANVAS PAGE ---`;

  try {
    const upstream = await fetch(`${BAZAARLINK_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${bazaarKey}`
      },
      body: JSON.stringify({
        model: model || "auto:free",
        messages: [{ role: "system", content: systemPrompt }, ...messages],
        stream: true
      })
    });

    if (!upstream.ok || !upstream.body) {
      const data = await upstream.json().catch(() => ({}));
      return res.status(upstream.status || 500).json({ error: data?.error?.message || "BazaarLink API error" });
    }

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders?.();

    const reader = upstream.body.getReader();
    const decoder = new TextDecoder();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(decoder.decode(value, { stream: true }));
    }
    res.end();
  } catch (err) {
    if (!res.headersSent) {
      res.status(500).json({ error: err.message });
    } else {
      res.end();
    }
  }
});

app.listen(PORT, () => {
  console.log(`Elucidate running at http://localhost:${PORT}`);
});
