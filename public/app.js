(() => {
  "use strict";

  // ============================================================
  // Storage: settings are encrypted at rest with a locally-held
  // AES-GCM key. NOTE — this is obfuscation, not real security:
  // since there's no password/login for this single-user tool,
  // the decryption key has to live in the browser too (so the
  // page can load without asking you to re-enter anything). It
  // keeps your keys out of plain sight in localStorage/devtools,
  // but anyone with access to this browser profile could still
  // recover the key programmatically. Don't use a shared machine.
  // ============================================================

  const CRYPTO_KEY_STORAGE = "elucidateCryptoKey";
  const SETTINGS_STORAGE = "elucidateSettings";
  const SIDEBAR_STORAGE = "elucidateSidebarCollapsed";

  function bytesToBase64(bytes) {
    let binary = "";
    bytes.forEach(b => (binary += String.fromCharCode(b)));
    return btoa(binary);
  }
  function base64ToBytes(b64) {
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }

  async function getOrCreateCryptoKey() {
    const stored = localStorage.getItem(CRYPTO_KEY_STORAGE);
    if (stored) {
      try {
        return await crypto.subtle.importKey("raw", base64ToBytes(stored), { name: "AES-GCM" }, true, [
          "encrypt",
          "decrypt"
        ]);
      } catch {
        // fall through to regenerate a fresh key below
      }
    }
    const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]);
    const raw = await crypto.subtle.exportKey("raw", key);
    localStorage.setItem(CRYPTO_KEY_STORAGE, bytesToBase64(new Uint8Array(raw)));
    return key;
  }

  async function encryptToStorage(key, obj) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encoded = new TextEncoder().encode(JSON.stringify(obj));
    const cipherBuf = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, encoded);
    const combined = new Uint8Array(iv.length + cipherBuf.byteLength);
    combined.set(iv, 0);
    combined.set(new Uint8Array(cipherBuf), iv.length);
    return bytesToBase64(combined);
  }

  async function decryptFromStorage(key, b64) {
    const combined = base64ToBytes(b64);
    const iv = combined.slice(0, 12);
    const data = combined.slice(12);
    const plainBuf = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, data);
    return JSON.parse(new TextDecoder().decode(plainBuf));
  }

  // ---------- state ----------
  const state = {
    canvasUrl: "",
    canvasToken: "",
    bazaarKey: "",
    model: "auto:free",
    courseId: "",
    activeTab: "modules",
    currentContext: null, // { title, body, extra, mediaHints }
    messages: [], // [{role, content}]
    canvasUserName: "You",
    cryptoKey: null
  };

  // ---------- element refs ----------
  const el = {
    appShell: document.getElementById("app-shell"),
    sidebar: document.getElementById("sidebar"),
    sidebarCollapseBtn: document.getElementById("sidebar-collapse-btn"),

    canvasUrl: document.getElementById("canvas-url"),
    canvasToken: document.getElementById("canvas-token"),
    bazaarKey: document.getElementById("bazaar-key"),
    modelSelect: document.getElementById("model-select"),
    customModelField: document.getElementById("custom-model-field"),
    customModel: document.getElementById("custom-model"),
    saveSettings: document.getElementById("save-settings"),
    settingsStatus: document.getElementById("settings-status"),
    settingsToggle: document.getElementById("settings-toggle"),
    settingsBody: document.getElementById("settings-body"),

    coursePanel: document.getElementById("course-panel"),
    courseSelect: document.getElementById("course-select"),

    tabsPanel: document.getElementById("tabs-panel"),
    tabStrip: document.getElementById("tab-strip"),
    itemList: document.getElementById("item-list"),
    moduleItemList: document.getElementById("module-item-list"),

    contentPreview: document.getElementById("content-preview"),
    previewToggle: document.getElementById("preview-toggle"),
    previewChevron: document.getElementById("preview-chevron"),
    previewBody: document.getElementById("preview-body"),
    previewTitle: document.getElementById("preview-title"),
    previewExtra: document.getElementById("preview-extra"),
    previewText: document.getElementById("preview-text"),
    mediaWarning: document.getElementById("media-warning"),

    chatLog: document.getElementById("chat-log"),
    emptyState: document.getElementById("empty-state"),
    promptChips: document.getElementById("prompt-chips"),
    chatForm: document.getElementById("chat-form"),
    chatInput: document.getElementById("chat-input"),
    chatSend: document.getElementById("chat-send")
  };

  // ---------- persistence ----------
  async function loadSaved() {
    if (localStorage.getItem(SIDEBAR_STORAGE) === "1") {
      el.appShell.classList.add("sidebar-collapsed");
    }

    const cipher = localStorage.getItem(SETTINGS_STORAGE);
    if (!cipher) return;

    try {
      state.cryptoKey = state.cryptoKey || (await getOrCreateCryptoKey());
      const saved = await decryptFromStorage(state.cryptoKey, cipher);
      if (saved.canvasUrl) el.canvasUrl.value = saved.canvasUrl;
      if (saved.canvasToken) el.canvasToken.value = saved.canvasToken;
      if (saved.bazaarKey) el.bazaarKey.value = saved.bazaarKey;
      if (saved.model) {
        const known = [...el.modelSelect.options].some(o => o.value === saved.model);
        if (known) {
          el.modelSelect.value = saved.model;
        } else {
          el.modelSelect.value = "custom";
          el.customModelField.hidden = false;
          el.customModel.value = saved.model;
        }
      }
    } catch {
      // Corrupted or unreadable — drop it rather than fail to load the app.
      localStorage.removeItem(SETTINGS_STORAGE);
    }
  }

  async function persistSettings() {
    state.cryptoKey = state.cryptoKey || (await getOrCreateCryptoKey());
    const cipher = await encryptToStorage(state.cryptoKey, {
      canvasUrl: state.canvasUrl,
      canvasToken: state.canvasToken,
      bazaarKey: state.bazaarKey,
      model: state.model
    });
    localStorage.setItem(SETTINGS_STORAGE, cipher);
  }

  el.modelSelect.addEventListener("change", () => {
    el.customModelField.hidden = el.modelSelect.value !== "custom";
    if (el.modelSelect.value === "custom") el.customModel.focus();
  });

  // ---------- sidebar collapse ----------
  el.sidebarCollapseBtn.addEventListener("click", () => {
    const collapsed = el.appShell.classList.toggle("sidebar-collapsed");
    localStorage.setItem(SIDEBAR_STORAGE, collapsed ? "1" : "0");
  });

  // ---------- helpers ----------
  async function api(path, body) {
    const res = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
    return data;
  }

  function setStatus(msg, kind) {
    el.settingsStatus.textContent = msg;
    el.settingsStatus.className = "hint" + (kind ? ` ${kind}` : "");
  }

  function togglePanel(toggleBtn, bodyEl) {
    const expanded = toggleBtn.getAttribute("aria-expanded") !== "false";
    toggleBtn.setAttribute("aria-expanded", String(!expanded));
    bodyEl.hidden = expanded;
  }

  // Turn a raw model id like "qwen/qwen3-235b-a22b:free" into "Qwen3 235B A22B"
  function formatModelName(raw) {
    if (!raw) return "Assistant";
    let name = raw.split("/").pop().replace(/:free$/i, "");
    name = name.replace(/[-_]/g, " ").trim();
    name = name.replace(/\b([a-z])/g, c => c.toUpperCase());
    name = name.replace(/\b(\d+)b\b/gi, "$1B");
    return name || "Assistant";
  }

  // ---------- settings ----------
  el.settingsToggle.addEventListener("click", () => togglePanel(el.settingsToggle, el.settingsBody));

  el.saveSettings.addEventListener("click", async () => {
    state.canvasUrl = el.canvasUrl.value.trim();
    state.canvasToken = el.canvasToken.value.trim();
    state.bazaarKey = el.bazaarKey.value.trim();
    state.model = el.modelSelect.value === "custom" ? el.customModel.value.trim() : el.modelSelect.value;

    if (!state.canvasUrl || !state.canvasToken) {
      setStatus("Enter your Canvas URL and access token.", "error");
      return;
    }
    if (!state.bazaarKey) {
      setStatus("Enter your BazaarLink API key.", "error");
      return;
    }
    if (el.modelSelect.value === "custom" && !state.model) {
      setStatus("Enter a custom model ID, or switch back to Auto (free).", "error");
      return;
    }

    await persistSettings();
    setStatus("Connecting…");
    el.saveSettings.disabled = true;
    const originalLabel = el.saveSettings.textContent;
    el.saveSettings.innerHTML = `<span class="btn-spinner"></span>Connecting…`;

    try {
      const courses = await api("/api/canvas/courses", {
        canvasUrl: state.canvasUrl,
        canvasToken: state.canvasToken
      });
      populateCourses(courses);
      setStatus(`Connected — ${courses.length} course${courses.length === 1 ? "" : "s"} found.`, "ok");
      el.coursePanel.hidden = false;
      togglePanel(el.settingsToggle, el.settingsBody);

      // Best-effort — falls back to "You" in the chat if this fails.
      api("/api/canvas/me", { canvasUrl: state.canvasUrl, canvasToken: state.canvasToken })
        .then(me => {
          if (me.name) state.canvasUserName = me.name;
        })
        .catch(() => {});
    } catch (err) {
      setStatus(err.message, "error");
    } finally {
      el.saveSettings.disabled = false;
      el.saveSettings.textContent = originalLabel;
    }
  });

  function populateCourses(courses) {
    el.courseSelect.innerHTML =
      `<option value="">Select a course…</option>` +
      courses.map(c => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join("");
  }

  el.courseSelect.addEventListener("change", () => {
    state.courseId = el.courseSelect.value;
    resetContentArea();
    if (state.courseId) {
      el.tabsPanel.hidden = false;
      loadItems(state.activeTab);
    } else {
      el.tabsPanel.hidden = true;
    }
  });

  // ---------- tabs / item browsing ----------
  el.tabStrip.addEventListener("click", e => {
    const btn = e.target.closest(".tab");
    if (!btn) return;
    state.activeTab = btn.dataset.type;
    [...el.tabStrip.children].forEach(t => t.classList.toggle("active", t === btn));
    el.moduleItemList.hidden = true;
    el.itemList.hidden = false;
    loadItems(state.activeTab);
  });
  el.tabStrip.firstElementChild.classList.add("active");

  async function loadItems(type) {
    el.itemList.innerHTML = `<p class="hint">Loading…</p>`;
    try {
      const items = await api("/api/canvas/items", {
        canvasUrl: state.canvasUrl,
        canvasToken: state.canvasToken,
        courseId: state.courseId,
        type
      });
      if (items.length === 0) {
        el.itemList.innerHTML = `<p class="hint">Nothing here.</p>`;
        return;
      }
      el.itemList.innerHTML = "";
      items.forEach(item => {
        const row = document.createElement("button");
        row.className = "item-row";
        row.innerHTML = `<span>${escapeHtml(item.name || "Untitled")}</span>${
          item.meta ? `<span class="meta">${escapeHtml(item.meta)}</span>` : ""
        }`;
        row.addEventListener("click", () => {
          [...el.itemList.children].forEach(r => r.classList.remove("active"));
          row.classList.add("active");
          if (type === "modules") {
            loadModuleItems(item.id, item.name);
          } else {
            const singular = type.slice(0, -1); // assignments -> assignment, pages -> page, discussions -> discussion
            loadContent(singular, item.id);
          }
        });
        el.itemList.appendChild(row);
      });
    } catch (err) {
      el.itemList.innerHTML = `<p class="hint error">${escapeHtml(err.message)}</p>`;
    }
  }

  async function loadModuleItems(moduleId, moduleName) {
    el.itemList.hidden = true;
    el.moduleItemList.hidden = false;
    el.moduleItemList.innerHTML = `<p class="hint">Loading…</p>`;
    try {
      const items = await api("/api/canvas/module-items", {
        canvasUrl: state.canvasUrl,
        canvasToken: state.canvasToken,
        courseId: state.courseId,
        moduleId
      });
      el.moduleItemList.innerHTML = "";
      const back = document.createElement("button");
      back.className = "back-row";
      back.textContent = `← ${moduleName}`;
      back.addEventListener("click", () => {
        el.moduleItemList.hidden = true;
        el.itemList.hidden = false;
      });
      el.moduleItemList.appendChild(back);

      const supported = ["Page", "Assignment", "Discussion", "Quiz", "File"];
      items.forEach(item => {
        const row = document.createElement("button");
        row.className = "item-row";
        const disabled = !supported.includes(item.type);
        row.innerHTML = `<span>${escapeHtml(item.name || "Untitled")}</span><span class="meta">${escapeHtml(
          item.type || ""
        )}</span>`;
        if (disabled) {
          row.title = "This item type can't be extracted automatically.";
          row.style.opacity = "0.45";
          row.style.cursor = "default";
        } else {
          row.addEventListener("click", () => {
            [...el.moduleItemList.children].forEach(r => r.classList.remove("active"));
            row.classList.add("active");
            const idForFetch = item.type === "Page" ? item.page_url : item.content_id;
            loadContent(item.type.toLowerCase(), idForFetch);
          });
        }
        el.moduleItemList.appendChild(row);
      });
    } catch (err) {
      el.moduleItemList.innerHTML = `<p class="hint error">${escapeHtml(err.message)}</p>`;
    }
  }

  // ---------- content loading ----------
  async function loadContent(type, itemId) {
    el.contentPreview.hidden = false;
    el.previewTitle.textContent = "Loading…";
    el.previewText.textContent = "";
    el.previewExtra.textContent = "";
    el.mediaWarning.hidden = true;

    try {
      const data = await api("/api/canvas/content", {
        canvasUrl: state.canvasUrl,
        canvasToken: state.canvasToken,
        courseId: state.courseId,
        type,
        itemId
      });
      state.currentContext = data;
      el.previewTitle.textContent = data.title || "Untitled";
      el.previewExtra.textContent = data.extra || "";
      el.previewText.textContent = data.body || "";

      if (data.mediaHints && data.mediaHints.length) {
        el.mediaWarning.hidden = false;
        el.mediaWarning.textContent = `This page embeds ${data.mediaHints.length} media item${
          data.mediaHints.length === 1 ? "" : "s"
        } (e.g. video). The AI can't watch or transcribe it — only the surrounding text is available.`;
      }

      startNewConversation(data.title);
    } catch (err) {
      el.previewTitle.textContent = "Couldn't load this item";
      el.previewText.textContent = err.message;
    }
  }

  el.previewToggle.addEventListener("click", () => {
    const collapsed = el.previewBody.classList.toggle("collapsed");
    el.previewChevron.style.transform = collapsed ? "rotate(-90deg)" : "rotate(0deg)";
  });

  // ---------- markdown rendering ----------
  function renderMarkdown(text) {
    if (window.marked && window.DOMPurify) {
      const html = marked.parse(text, { breaks: true });
      return DOMPurify.sanitize(html);
    }
    // Fallback if the CDN scripts didn't load (e.g. offline): show as plain text.
    return escapeHtml(text).replace(/\n/g, "<br>");
  }

  // ---------- chat ----------
  function resetContentArea() {
    el.contentPreview.hidden = true;
    state.currentContext = null;
    state.messages = [];
    el.chatLog.innerHTML = "";
    el.emptyState && el.chatLog.appendChild(el.emptyState);
    el.promptChips.hidden = true;
    setInputEnabled(false);
  }

  function startNewConversation(title) {
    state.messages = [];
    el.chatLog.innerHTML = "";
    addSystemNote(`Now discussing: ${title || "this page"}`);
    el.promptChips.hidden = false;
    setInputEnabled(true);
    el.chatInput.focus();
  }

  function setInputEnabled(enabled) {
    el.chatInput.disabled = !enabled;
    el.chatSend.disabled = !enabled;
  }

  function addSystemNote(text) {
    const div = document.createElement("div");
    div.className = "msg system-note";
    div.textContent = text;
    el.chatLog.appendChild(div);
    scrollChatToBottom();
  }

  // role: "user" | "assistant". Returns {block, sender, bubble}.
  function addMessage(role, senderLabel, contentHtml) {
    const block = document.createElement("div");
    block.className = `msg-block ${role}`;

    const sender = document.createElement("div");
    sender.className = "msg-sender";
    sender.textContent = senderLabel;
    block.appendChild(sender);

    const bubble = document.createElement("div");
    bubble.className = `msg ${role}`;
    bubble.innerHTML = contentHtml;
    block.appendChild(bubble);

    el.chatLog.appendChild(block);
    scrollChatToBottom();
    return { block, sender, bubble };
  }

  function scrollChatToBottom() {
    el.chatLog.scrollTop = el.chatLog.scrollHeight;
  }

  // ---------- streaming typewriter ----------
  // Reveals text at a smooth, fast, fixed pace independent of how bursty
  // the network chunks are — and re-renders Markdown on every tick, so
  // headings/bold/lists format live as the reply comes in instead of only
  // once the whole thing has arrived.
  function createTypewriter(bubbleEl) {
    let queue = "";
    let displayed = "";
    let timer = null;
    const CHARS_PER_TICK = 4;
    const TICK_MS = 8; // ~500 chars/sec

    function render() {
      bubbleEl.innerHTML = renderMarkdown(displayed) + `<span class="typing-cursor"></span>`;
      scrollChatToBottom();
    }

    function tick() {
      if (queue.length === 0) {
        timer = null;
        return;
      }
      const take = queue.slice(0, CHARS_PER_TICK);
      queue = queue.slice(CHARS_PER_TICK);
      displayed += take;
      render();
      timer = setTimeout(tick, TICK_MS);
    }

    return {
      push(chunk) {
        queue += chunk;
        if (!timer) tick();
      },
      // Resolves once every queued character has been visually revealed.
      waitForDrain() {
        return new Promise(resolve => {
          const check = () => {
            if (queue.length === 0 && !timer) resolve();
            else setTimeout(check, 20);
          };
          check();
        });
      },
      getDisplayed: () => displayed
    };
  }

  // Streams the reply and invokes onDelta the moment each chunk is
  // decoded (not after the whole response finishes), so the caller can
  // start the typewriter animating in real time.
  async function streamChat(payload, { onDelta, onModel } = {}) {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    if (!res.ok || !res.body) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || `Request failed (${res.status})`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let fullText = "";
    let modelName = null;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split("\n");
      buffer = lines.pop(); // keep any partial line for the next chunk

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;
        const dataStr = trimmed.slice(5).trim();
        if (!dataStr || dataStr === "[DONE]") continue;

        let json;
        try {
          json = JSON.parse(dataStr);
        } catch {
          continue; // malformed/partial JSON — skip
        }

        if (json.model && !modelName) {
          modelName = json.model;
          onModel && onModel(modelName);
        }
        const delta = json.choices?.[0]?.delta?.content;
        if (delta) {
          fullText += delta;
          onDelta && onDelta(delta);
        }
      }
    }

    return { text: fullText, model: modelName };
  }

  async function sendMessage(text) {
    if (!text || !state.currentContext) return;

    addMessage("user", state.canvasUserName || "You", escapeHtml(text).replace(/\n/g, "<br>"));
    state.messages.push({ role: "user", content: text });
    setInputEnabled(false);

    const pendingLabel = formatModelName(state.model);
    const { bubble, sender } = addMessage(
      "assistant",
      pendingLabel,
      `<span class="typing-dots"><span></span><span></span><span></span></span>`
    );

    let typewriter = null;

    try {
      const result = await streamChat(
        {
          bazaarKey: state.bazaarKey,
          model: state.model,
          context: state.currentContext,
          messages: state.messages
        },
        {
          onModel: modelId => {
            sender.textContent = formatModelName(modelId);
          },
          onDelta: chunk => {
            if (!typewriter) typewriter = createTypewriter(bubble);
            typewriter.push(chunk);
          }
        }
      );

      if (!typewriter) {
        bubble.innerHTML = `<em>No response received.</em>`;
      } else {
        await typewriter.waitForDrain();
        bubble.innerHTML = renderMarkdown(result.text); // final clean render, cursor removed
      }

      if (result.text) {
        state.messages.push({ role: "assistant", content: result.text });
      }
    } catch (err) {
      bubble.innerHTML = `<em>Error: ${escapeHtml(err.message)}</em>`;
    } finally {
      setInputEnabled(true);
      el.chatInput.focus();
    }
  }

  el.chatInput.addEventListener("input", () => {
    el.chatInput.style.height = "auto";
    el.chatInput.style.height = Math.min(el.chatInput.scrollHeight, 160) + "px";
  });

  el.chatForm.addEventListener("submit", e => {
    e.preventDefault();
    const text = el.chatInput.value.trim();
    if (!text) return;
    el.chatInput.value = "";
    el.chatInput.style.height = "auto";
    sendMessage(text);
  });

  // ---------- quick-prompt chips ----------
  const QUICK_PROMPTS = {
    quiz:
      "Please quiz me on this material. Ask me one question at a time covering the key points, wait for my answer before asking the next question, and check each answer as I give it, explaining anything I get wrong.",
    summarise: "Please summarise this for me, covering the key points I should know."
  };

  el.promptChips.addEventListener("click", e => {
    const btn = e.target.closest(".chip");
    if (!btn || !state.currentContext) return;
    const kind = btn.dataset.prompt;

    if (kind === "mark-essay") {
      // Needs the student to paste their essay in — populate the input
      // rather than sending immediately.
      el.chatInput.value =
        "Please mark my essay below against the marking guide or rubric on this page, and give me feedback on how to improve it.\n\nMy essay:\n";
      el.chatInput.style.height = "auto";
      el.chatInput.style.height = Math.min(el.chatInput.scrollHeight, 160) + "px";
      el.chatInput.focus();
      el.chatInput.selectionStart = el.chatInput.selectionEnd = el.chatInput.value.length;
      return;
    }

    const prompt = QUICK_PROMPTS[kind];
    if (prompt) sendMessage(prompt);
  });

  function escapeHtml(str) {
    return String(str).replace(
      /[&<>"']/g,
      m => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m])
    );
  }

  // ---------- init ----------
  loadSaved();
})();
