(() => {
  "use strict";

  // ============================================================
  // Storage: settings are encrypted at rest with a locally-held
  // AES-GCM key (obfuscation, not real security — see README).
  // ============================================================

  const CRYPTO_KEY_STORAGE = "elucidateCryptoKey";
  const SETTINGS_STORAGE = "elucidateSettings";
  const SIDEBAR_STORAGE = "elucidateSidebarCollapsed";
  const PREFS_STORAGE = "elucidatePrefs"; // system instructions, theme, animation

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
        // fall through to regenerate
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
    currentContext: null,    // { title, body, extra, mediaHints, htmlUrl }
    messages: [],            // [{role, content}]
    canvasUserName: "You",
    cryptoKey: null,
    // Settings/prefs
    systemInstructions: "",
    theme: "light",
    loadingAnimation: "dots", // 'dots', 'orbit', 'cubes', 'pulse'
    // File attachments for current message
    pendingAttachments: [],
    // Current chat session ID (supabase)
    currentSessionId: null
  };

  // ---------- pages ----------
  const pages = {
    connect: document.getElementById("page-connect"),
    chat: document.getElementById("page-chat"),
    settings: document.getElementById("page-settings"),
    docs: document.getElementById("page-docs"),
    logout: document.getElementById("page-logout")
  };

  function showPage(name) {
    Object.values(pages).forEach(p => {
      if (p) { p.hidden = true; p.classList.remove("active"); }
    });
    if (pages[name]) {
      pages[name].hidden = false;
      pages[name].classList.add("active");
    }
  }

  // ---------- element refs ----------
  const el = {
    // Chat page
    appShell: document.getElementById("app-shell"),
    sidebar: document.getElementById("sidebar"),
    sidebarCollapseBtn: document.getElementById("sidebar-collapse-btn"),

    coursePanel: document.getElementById("course-panel"),
    courseToggle: document.getElementById("course-toggle"),
    courseBody: document.getElementById("course-body"),
    courseSelect: document.getElementById("course-select"),

    tabsPanel: document.getElementById("tabs-panel"),
    tabsToggle: document.getElementById("tabs-toggle"),
    tabsBody: document.getElementById("tabs-body"),
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
    previewCanvasLink: document.getElementById("preview-canvas-link"),

    chatLog: document.getElementById("chat-log"),
    emptyState: document.getElementById("empty-state"),
    promptChips: document.getElementById("prompt-chips"),
    chatForm: document.getElementById("chat-form"),
    chatInput: document.getElementById("chat-input"),

    attachBtn: document.getElementById("attach-btn"),
    fileInput: document.getElementById("file-input"),
    attachmentChips: document.getElementById("attachment-chips"),

    sidebarNav: document.getElementById("sidebar-nav"),

    // Connect page
    canvasUrl: document.getElementById("canvas-url"),
    canvasToken: document.getElementById("canvas-token"),
    bazaarKey: document.getElementById("bazaar-key"),
    rememberMe: document.getElementById("remember-me"),
    saveSettings: document.getElementById("save-settings"),
    settingsStatus: document.getElementById("settings-status"),

    connectTabs: document.getElementById("connect-tabs"),
    connectKeysTab: document.getElementById("connect-keys-tab"),
    connectLoginTab: document.getElementById("connect-login-tab"),
    authEmail: document.getElementById("auth-email"),
    authPassword: document.getElementById("auth-password"),
    authSignin: document.getElementById("auth-signin"),
    authSignup: document.getElementById("auth-signup"),
    authStatus: document.getElementById("auth-status"),

    // Settings page
    settingsBack: document.getElementById("settings-back"),
    systemInstructions: document.getElementById("system-instructions"),
    animationGrid: document.getElementById("animation-grid"),
    settingsCanvasUrl: document.getElementById("settings-canvas-url"),
    settingsCanvasToken: document.getElementById("settings-canvas-token"),
    settingsBazaarKey: document.getElementById("settings-bazaar-key"),
    settingsModelSelect: document.getElementById("settings-model-select"),
    settingsCustomModelField: document.getElementById("settings-custom-model-field"),
    settingsCustomModel: document.getElementById("settings-custom-model"),
    settingsSaveKeys: document.getElementById("settings-save-keys"),
    settingsSaveStatus: document.getElementById("settings-save-status"),

    // Docs page
    docsBack: document.getElementById("docs-back"),

    // Logout page
    logoutConfirm: document.getElementById("logout-confirm"),
    logoutCancel: document.getElementById("logout-cancel")
  };

  // ---------- persistence ----------
  async function loadSavedKeys() {
    const cipher = localStorage.getItem(SETTINGS_STORAGE);
    if (!cipher) return false;

    try {
      state.cryptoKey = state.cryptoKey || (await getOrCreateCryptoKey());
      const saved = await decryptFromStorage(state.cryptoKey, cipher);
      if (saved.canvasUrl) { state.canvasUrl = saved.canvasUrl; el.canvasUrl.value = saved.canvasUrl; }
      if (saved.canvasToken) { state.canvasToken = saved.canvasToken; el.canvasToken.value = saved.canvasToken; }
      if (saved.bazaarKey) { state.bazaarKey = saved.bazaarKey; el.bazaarKey.value = saved.bazaarKey; }
      if (saved.model) state.model = saved.model;
      return !!(saved.canvasUrl && saved.canvasToken && saved.bazaarKey);
    } catch {
      localStorage.removeItem(SETTINGS_STORAGE);
      return false;
    }
  }

  async function persistKeys() {
    state.cryptoKey = state.cryptoKey || (await getOrCreateCryptoKey());
    const cipher = await encryptToStorage(state.cryptoKey, {
      canvasUrl: state.canvasUrl,
      canvasToken: state.canvasToken,
      bazaarKey: state.bazaarKey,
      model: state.model || "auto:free"
    });
    localStorage.setItem(SETTINGS_STORAGE, cipher);
  }

  function loadPrefs() {
    try {
      const raw = localStorage.getItem(PREFS_STORAGE);
      if (raw) {
        const prefs = JSON.parse(raw);
        if (prefs.systemInstructions != null) state.systemInstructions = prefs.systemInstructions;
        if (prefs.theme) state.theme = prefs.theme;
        if (prefs.loadingAnimation) state.loadingAnimation = prefs.loadingAnimation;
      }
    } catch { /* ignore */ }
    applyTheme(state.theme);
  }

  function savePrefs() {
    localStorage.setItem(PREFS_STORAGE, JSON.stringify({
      systemInstructions: state.systemInstructions,
      theme: state.theme,
      loadingAnimation: state.loadingAnimation
    }));
    // Also save to Supabase if configured
    if (window.SupabaseClient && window.SupabaseClient.isConfigured()) {
      window.SupabaseClient.saveSettings({
        system_instructions: state.systemInstructions,
        theme: state.theme,
        loading_animation: state.loadingAnimation
      }).catch(() => {});
    }
  }

  function applyTheme(theme) {
    state.theme = theme;
    document.documentElement.setAttribute("data-theme", theme);
    document.querySelectorAll(".theme-btn").forEach(btn => {
      btn.classList.toggle("active", btn.dataset.theme === theme);
    });
  }

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

  function setStatus(elRef, msg, kind) {
    if (!elRef) return;
    elRef.textContent = msg;
    elRef.className = "hint" + (kind ? ` ${kind}` : "");
  }

  function togglePanel(toggleBtn, bodyEl) {
    const expanded = toggleBtn.getAttribute("aria-expanded") !== "false";
    toggleBtn.setAttribute("aria-expanded", String(!expanded));
    bodyEl.hidden = expanded;
  }

  function formatModelName(raw) {
    if (!raw) return "Assistant";
    let name = raw.split("/").pop().replace(/:free$/i, "");
    name = name.replace(/[-_]/g, " ").trim();
    name = name.replace(/\b([a-z])/g, c => c.toUpperCase());
    name = name.replace(/\b(\d+)b\b/gi, "$1B");
    return name || "Assistant";
  }

  function escapeHtml(str) {
    return String(str).replace(
      /[&<>"']/g,
      m => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m])
    );
  }

  // ---------- 4 custom typing animations ----------
  function getTypingAnimationHtml() {
    switch (state.loadingAnimation) {
      case "orbit":
        return `<span class="typing-orbit"><span class="orbit-outer"></span><span class="orbit-inner"></span></span>`;
      case "cubes":
        return `<span class="typing-cubes"><span></span><span></span><span></span><span></span></span>`;
      case "pulse":
        return `<span class="typing-pulse"><span></span><span></span><span></span></span>`;
      case "dots":
      default:
        return `<span class="typing-dots"><span></span><span></span><span></span></span>`;
    }
  }

  // ============================================================
  // CONNECT PAGE
  // ============================================================

  if (el.connectTabs) {
    el.connectTabs.addEventListener("click", e => {
      const tab = e.target.closest(".connect-tab");
      if (!tab) return;
      const target = tab.dataset.tab;
      el.connectTabs.querySelectorAll(".connect-tab").forEach(t => t.classList.toggle("active", t === tab));
      el.connectKeysTab.hidden = target !== "keys";
      el.connectLoginTab.hidden = target !== "login";
    });
  }

  // Save & connect
  if (el.saveSettings) {
    el.saveSettings.addEventListener("click", async () => {
      state.canvasUrl = el.canvasUrl.value.trim();
      state.canvasToken = el.canvasToken.value.trim();
      state.bazaarKey = el.bazaarKey.value.trim();
      state.model = state.model || "auto:free";

      if (!state.canvasUrl || !state.canvasToken) {
        setStatus(el.settingsStatus, "Enter your Canvas URL and access token.", "error");
        return;
      }
      if (!state.bazaarKey) {
        setStatus(el.settingsStatus, "Enter your BazaarLink API key.", "error");
        return;
      }

      if (el.rememberMe.checked) {
        await persistKeys();
      }

      setStatus(el.settingsStatus, "Connecting…");
      el.saveSettings.disabled = true;
      const originalLabel = el.saveSettings.textContent;
      el.saveSettings.innerHTML = `<span class="btn-spinner"></span>Connecting…`;

      try {
        const courses = await api("/api/canvas/courses", {
          canvasUrl: state.canvasUrl,
          canvasToken: state.canvasToken
        });
        if (courses.length === 0) {
          setStatus(el.settingsStatus, "No active courses found.", "error");
          return;
        }
        setStatus(el.settingsStatus, `Connected — ${courses.length} course${courses.length === 1 ? "" : "s"} found.`, "ok");

        // Get user name (best effort)
        api("/api/canvas/me", { canvasUrl: state.canvasUrl, canvasToken: state.canvasToken })
          .then(me => { if (me.name) state.canvasUserName = me.name; })
          .catch(() => {});

        // Directly navigate to chat
        Router.navigate("chat");
      } catch (err) {
        setStatus(el.settingsStatus, err.message, "error");
      } finally {
        el.saveSettings.disabled = false;
        el.saveSettings.textContent = originalLabel;
      }
    });
  }

  // Supabase auth
  if (el.authSignin) {
    el.authSignin.addEventListener("click", async () => {
      const email = el.authEmail.value.trim();
      const password = el.authPassword.value.trim();
      if (!email || !password) {
        setStatus(el.authStatus, "Enter email and password.", "error");
        return;
      }
      setStatus(el.authStatus, "Signing in…");
      const { user, error } = await window.SupabaseClient.signIn(email, password);
      if (error) {
        setStatus(el.authStatus, error.message || "Sign in failed.", "error");
        return;
      }
      setStatus(el.authStatus, "Signed in!", "ok");
      // Load settings from Supabase
      const { data: settings } = await window.SupabaseClient.loadSettings();
      if (settings) {
        state.canvasUrl = settings.canvas_url || "";
        state.canvasToken = settings.canvas_token || "";
        state.bazaarKey = settings.bazaar_key || "";
        state.model = settings.model || "auto:free";
        state.systemInstructions = settings.system_instructions || "";
        state.theme = settings.theme || "light";
        state.loadingAnimation = settings.loading_animation || "dots";
        applyTheme(state.theme);
        await persistKeys();
        savePrefs();
      }
      if (state.canvasUrl && state.canvasToken && state.bazaarKey) {
        Router.navigate("chat");
      } else {
        el.connectTabs.querySelector('[data-tab="keys"]').click();
        el.canvasUrl.value = state.canvasUrl;
        el.canvasToken.value = state.canvasToken;
        el.bazaarKey.value = state.bazaarKey;
        setStatus(el.settingsStatus, "Signed in. Enter your API keys to continue.", "ok");
      }
    });
  }

  if (el.authSignup) {
    el.authSignup.addEventListener("click", async () => {
      const email = el.authEmail.value.trim();
      const password = el.authPassword.value.trim();
      if (!email || !password) {
        setStatus(el.authStatus, "Enter email and password.", "error");
        return;
      }
      if (password.length < 6) {
        setStatus(el.authStatus, "Password must be at least 6 characters.", "error");
        return;
      }
      setStatus(el.authStatus, "Creating account…");
      const { user, error } = await window.SupabaseClient.signUp(email, password);
      if (error) {
        setStatus(el.authStatus, error.message || "Sign up failed.", "error");
        return;
      }
      setStatus(el.authStatus, "Account created! Check your email to confirm, then sign in.", "ok");
    });
  }

  // ============================================================
  // CHAT PAGE
  // ============================================================

  // Sidebar collapse
  if (el.sidebarCollapseBtn) {
    el.sidebarCollapseBtn.addEventListener("click", () => {
      const collapsed = el.appShell.classList.toggle("sidebar-collapsed");
      localStorage.setItem(SIDEBAR_STORAGE, collapsed ? "1" : "0");
    });
  }

  // Restore sidebar state
  if (localStorage.getItem(SIDEBAR_STORAGE) === "1" && el.appShell) {
    el.appShell.classList.add("sidebar-collapsed");
  }

  // Panel toggles
  if (el.courseToggle) {
    el.courseToggle.addEventListener("click", () => togglePanel(el.courseToggle, el.courseBody));
  }
  if (el.tabsToggle) {
    el.tabsToggle.addEventListener("click", () => togglePanel(el.tabsToggle, el.tabsBody));
  }

  // Sidebar nav links
  if (el.sidebarNav) {
    el.sidebarNav.addEventListener("click", e => {
      const btn = e.target.closest(".sidebar-nav-btn");
      if (!btn) return;
      const route = btn.dataset.route;
      if (route) Router.navigate(route);
    });
  }

  // Course select
  if (el.courseSelect) {
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
  }

  // Tabs
  if (el.tabStrip) {
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
  }

  async function loadCourses() {
    try {
      const courses = await api("/api/canvas/courses", {
        canvasUrl: state.canvasUrl,
        canvasToken: state.canvasToken
      });
      populateCourses(courses);
    } catch (err) {
      el.courseSelect.innerHTML = `<option value="">Error loading courses</option>`;
    }
  }

  function populateCourses(courses) {
    el.courseSelect.innerHTML =
      `<option value="">Select a course…</option>` +
      courses.map(c => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join("");
  }

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
            const singular = type.slice(0, -1);
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
            loadContent(item.type.toLowerCase(), idForFetch, item.html_url);
          });
        }
        el.moduleItemList.appendChild(row);
      });
    } catch (err) {
      el.moduleItemList.innerHTML = `<p class="hint error">${escapeHtml(err.message)}</p>`;
    }
  }

  // ---------- content loading ----------
  async function loadContent(type, itemId, htmlUrl) {
    el.contentPreview.hidden = false;
    el.previewTitle.textContent = "Loading…";
    el.previewText.textContent = "";
    el.previewExtra.textContent = "";
    el.mediaWarning.hidden = true;
    el.previewCanvasLink.hidden = true;

    try {
      let data;

      if (type === "file") {
        try {
          data = await api("/api/canvas/file-content", {
            canvasUrl: state.canvasUrl,
            canvasToken: state.canvasToken,
            courseId: state.courseId,
            fileId: itemId
          });
          data = {
            title: data.title,
            body: data.body,
            extra: data.contentType ? `File type: ${data.contentType}` : "",
            mediaHints: [],
            htmlUrl: htmlUrl || data.downloadUrl || ""
          };
        } catch {
          data = await api("/api/canvas/content", {
            canvasUrl: state.canvasUrl,
            canvasToken: state.canvasToken,
            courseId: state.courseId,
            type,
            itemId
          });
        }
      } else {
        data = await api("/api/canvas/content", {
          canvasUrl: state.canvasUrl,
          canvasToken: state.canvasToken,
          courseId: state.courseId,
          type,
          itemId
        });
      }

      state.currentContext = data;
      el.previewTitle.textContent = data.title || "Untitled";
      el.previewExtra.textContent = data.extra || "";
      el.previewText.textContent = data.body || "";

      // Canvas external link
      const canvasLink = data.htmlUrl || htmlUrl;
      if (canvasLink) {
        el.previewCanvasLink.href = canvasLink;
        el.previewCanvasLink.hidden = false;
      }

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

  if (el.previewToggle) {
    el.previewToggle.addEventListener("click", () => {
      const collapsed = el.previewBody.classList.toggle("collapsed");
      el.previewChevron.style.transform = collapsed ? "rotate(-90deg)" : "rotate(0deg)";
    });
  }

  // ---------- markdown rendering ----------
  function renderMarkdown(text) {
    if (window.marked && window.DOMPurify) {
      const html = marked.parse(text, { breaks: true });
      return DOMPurify.sanitize(html);
    }
    return escapeHtml(text).replace(/\n/g, "<br>");
  }

  // ---------- chat ----------
  function resetContentArea() {
    el.contentPreview.hidden = true;
    el.previewCanvasLink.hidden = true;
    state.currentContext = null;
    state.messages = [];
    el.chatLog.innerHTML = "";
    if (el.emptyState) el.chatLog.appendChild(el.emptyState);
    el.promptChips.hidden = true;
    setInputEnabled(false);
  }

  function startNewConversation(title) {
    state.messages = [];
    state.currentSessionId = null;
    el.chatLog.innerHTML = "";
    addSystemNote(`Now discussing: ${title || "this page"}`);
    el.promptChips.hidden = false;
    setInputEnabled(true);
    el.chatInput.focus();

    // Create a Supabase chat session (fire and forget)
    if (window.SupabaseClient && window.SupabaseClient.isConfigured()) {
      window.SupabaseClient.saveChatSession({
        title: title || "Untitled",
        course_id: state.courseId,
        canvas_item_type: state.activeTab,
        canvas_item_id: String(state.currentContext?.title || ""),
        context: state.currentContext
      }).then(({ data }) => {
        if (data) state.currentSessionId = data.id;
      }).catch(() => {});
    }
  }

  function setInputEnabled(enabled) {
    el.chatInput.disabled = !enabled;
    el.attachBtn.disabled = !enabled;
  }

  function addSystemNote(text) {
    const div = document.createElement("div");
    div.className = "msg system-note";
    div.textContent = text;
    el.chatLog.appendChild(div);
    scrollChatToBottom();
  }

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

  // ---------- download buttons on code blocks ----------
  function addDownloadButtons(containerEl) {
    containerEl.querySelectorAll("pre").forEach(pre => {
      if (pre.querySelector(".code-download-btn")) return;
      const btn = document.createElement("button");
      btn.className = "code-download-btn";
      btn.textContent = "Download";
      btn.addEventListener("click", e => {
        e.stopPropagation();
        const code = pre.querySelector("code");
        const text = code ? code.textContent : pre.textContent;
        const blob = new Blob([text], { type: "text/plain" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = "code.txt";
        a.click();
        URL.revokeObjectURL(url);
      });
      pre.appendChild(btn);
    });
  }

  // ---------- flashcard parsing & rendering ----------
  function parseFlashcards(text) {
    const cards = [];
    const patterns = [
      /(?:FRONT|Q|Question)\s*:\s*([\s\S]*?)(?:\||(?:BACK|A|Answer)\s*:\s*)([\s\S]*?)(?=\n(?:FRONT|Q|Question)\s*:|$)/gi,
      /\*\*(?:Front|Q|Question)\*\*\s*:\s*([\s\S]*?)\*\*(?:Back|A|Answer)\*\*\s*:\s*([\s\S]*?)(?=\n\*\*(?:Front|Q|Question)\*\*|$)/gi
    ];

    for (const pattern of patterns) {
      let match;
      while ((match = pattern.exec(text)) !== null) {
        const front = match[1].trim();
        const back = match[2].trim();
        if (front && back) cards.push({ front, back });
      }
      if (cards.length > 0) break;
    }

    if (cards.length === 0) {
      const lines = text.split("\n");
      let currentQ = null;
      for (const line of lines) {
        const qMatch = line.match(/^\d+\.\s*\*?\*?(?:Q|Question|Front)\*?\*?\s*[:.]?\s*(.*)/i);
        const aMatch = line.match(/^\s*\*?\*?(?:A|Answer|Back)\*?\*?\s*[:.]?\s*(.*)/i);
        if (qMatch) {
          currentQ = qMatch[1].trim();
        } else if (aMatch && currentQ) {
          cards.push({ front: currentQ, back: aMatch[1].trim() });
          currentQ = null;
        }
      }
    }

    return cards;
  }

  function renderFlashcardDeck(cards, containerEl) {
    let currentIndex = 0;

    const deck = document.createElement("div");
    deck.className = "flashcard-deck";

    const cardContainer = document.createElement("div");
    cardContainer.className = "flashcard-container";

    const card = document.createElement("div");
    card.className = "flashcard";

    const front = document.createElement("div");
    front.className = "flashcard-front";

    const back = document.createElement("div");
    back.className = "flashcard-back";

    card.appendChild(front);
    card.appendChild(back);
    cardContainer.appendChild(card);
    deck.appendChild(cardContainer);

    const nav = document.createElement("div");
    nav.className = "flashcard-nav";

    const prevBtn = document.createElement("button");
    prevBtn.className = "flashcard-nav-btn";
    prevBtn.textContent = "← Prev";

    const counter = document.createElement("span");
    counter.className = "flashcard-counter";

    const nextBtn = document.createElement("button");
    nextBtn.className = "flashcard-nav-btn";
    nextBtn.textContent = "Next →";

    nav.appendChild(prevBtn);
    nav.appendChild(counter);
    nav.appendChild(nextBtn);
    deck.appendChild(nav);

    const hint = document.createElement("div");
    hint.className = "flashcard-hint";
    hint.textContent = "Click the card to flip it";
    deck.appendChild(hint);

    function render() {
      front.textContent = cards[currentIndex].front;
      back.textContent = cards[currentIndex].back;
      counter.textContent = `${currentIndex + 1} / ${cards.length}`;
      prevBtn.disabled = currentIndex === 0;
      nextBtn.disabled = currentIndex === cards.length - 1;
      card.classList.remove("flipped");
    }

    cardContainer.addEventListener("click", () => card.classList.toggle("flipped"));
    prevBtn.addEventListener("click", () => { if (currentIndex > 0) { currentIndex--; render(); } });
    nextBtn.addEventListener("click", () => { if (currentIndex < cards.length - 1) { currentIndex++; render(); } });

    deck.tabIndex = 0;
    deck.addEventListener("keydown", e => {
      if (e.key === "ArrowLeft" && currentIndex > 0) { currentIndex--; render(); }
      if (e.key === "ArrowRight" && currentIndex < cards.length - 1) { currentIndex++; render(); }
      if (e.key === " " || e.key === "Enter") { e.preventDefault(); card.classList.toggle("flipped"); }
    });

    render();
    containerEl.appendChild(deck);
  }

  // ---------- streaming typewriter ----------
  function createTypewriter(bubbleEl) {
    let queue = "";
    let displayed = "";
    let timer = null;
    const CHARS_PER_TICK = 4;
    const TICK_MS = 8;

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
      buffer = lines.pop();

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;
        const dataStr = trimmed.slice(5).trim();
        if (!dataStr || dataStr === "[DONE]") continue;

        let json;
        try { json = JSON.parse(dataStr); } catch { continue; }

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

    let displayHtml = escapeHtml(text).replace(/\n/g, "<br>");
    if (state.pendingAttachments.length > 0) {
      const attachNames = state.pendingAttachments.map(a => `📎 ${escapeHtml(a.name)}`).join("<br>");
      displayHtml += `<br><span style="font-size:12px;color:var(--text-faint)">${attachNames}</span>`;
    }

    addMessage("user", state.canvasUserName || "You", displayHtml);
    state.messages.push({ role: "user", content: text });
    setInputEnabled(false);

    const attachments = state.pendingAttachments.map(a => ({
      name: a.name,
      type: a.type,
      content: a.content
    }));
    state.pendingAttachments = [];
    el.attachmentChips.innerHTML = "";
    el.attachmentChips.hidden = true;

    const pendingLabel = formatModelName(state.model);
    const { bubble, sender } = addMessage("assistant", pendingLabel, getTypingAnimationHtml());

    let typewriter = null;

    try {
      const result = await streamChat(
        {
          bazaarKey: state.bazaarKey,
          model: state.model || "auto:free",
          context: state.currentContext,
          messages: state.messages,
          systemInstructions: state.systemInstructions || undefined,
          attachments: attachments.length > 0 ? attachments : undefined
        },
        {
          onModel: modelId => { sender.textContent = formatModelName(modelId); },
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
        bubble.innerHTML = renderMarkdown(result.text);
        addDownloadButtons(bubble);

        const cards = parseFlashcards(result.text);
        if (cards.length >= 2) {
          renderFlashcardDeck(cards, bubble);
        }
      }

      if (result.text) {
        state.messages.push({ role: "assistant", content: result.text });
        if (window.SupabaseClient && window.SupabaseClient.isConfigured() && state.currentSessionId) {
          window.SupabaseClient.saveChatMessage({
            session_id: state.currentSessionId,
            role: "user",
            content: text
          }).catch(() => {});
          window.SupabaseClient.saveChatMessage({
            session_id: state.currentSessionId,
            role: "assistant",
            content: result.text
          }).catch(() => {});
        }
      }
    } catch (err) {
      bubble.innerHTML = `<em>Error: ${escapeHtml(err.message)}</em>`;
    } finally {
      setInputEnabled(true);
      el.chatInput.focus();
    }
  }

  // --- Chat input auto-resize & key handling ---
  if (el.chatInput) {
    el.chatInput.addEventListener("input", () => {
      el.chatInput.style.height = "auto";
      el.chatInput.style.height = Math.min(el.chatInput.scrollHeight, 160) + "px";
    });

    el.chatInput.addEventListener("keydown", e => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        el.chatForm.dispatchEvent(new Event("submit"));
      }
    });
  }

  if (el.chatForm) {
    el.chatForm.addEventListener("submit", e => {
      e.preventDefault();
      const text = el.chatInput.value.trim();
      if (!text) return;
      el.chatInput.value = "";
      el.chatInput.style.height = "auto";
      sendMessage(text);
    });
  }

  // --- File attachments ---
  if (el.attachBtn) {
    el.attachBtn.addEventListener("click", () => el.fileInput.click());
  }

  if (el.fileInput) {
    el.fileInput.addEventListener("change", async () => {
      const files = el.fileInput.files;
      if (!files || files.length === 0) return;

      for (const file of files) {
        try {
          const content = await readFileAsText(file);
          state.pendingAttachments.push({
            name: file.name,
            type: file.type,
            content: content
          });
        } catch {
          state.pendingAttachments.push({
            name: file.name,
            type: file.type,
            content: `(Could not read file: ${file.name})`
          });
        }
      }
      renderAttachmentChips();
      el.fileInput.value = "";
    });
  }

  function readFileAsText(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      if (file.type.startsWith("text/") || file.type === "application/json" ||
          file.name.endsWith(".md") || file.name.endsWith(".csv")) {
        reader.readAsText(file);
      } else {
        reader.readAsText(file);
      }
    });
  }

  function renderAttachmentChips() {
    el.attachmentChips.innerHTML = "";
    if (state.pendingAttachments.length === 0) {
      el.attachmentChips.hidden = true;
      return;
    }
    el.attachmentChips.hidden = false;
    state.pendingAttachments.forEach((att, i) => {
      const chip = document.createElement("span");
      chip.className = "attachment-chip";
      chip.innerHTML = `📎 ${escapeHtml(att.name)} <button class="attachment-chip-remove" data-index="${i}">×</button>`;
      el.attachmentChips.appendChild(chip);
    });
    el.attachmentChips.addEventListener("click", e => {
      const removeBtn = e.target.closest(".attachment-chip-remove");
      if (removeBtn) {
        const idx = parseInt(removeBtn.dataset.index, 10);
        state.pendingAttachments.splice(idx, 1);
        renderAttachmentChips();
      }
    });
  }

  // --- Quick-prompt chips ---
  const QUICK_PROMPTS = {
    quiz: "Please quiz me on this material. Ask me one question at a time covering the key points, wait for my answer before asking the next question, and check each answer as I give it, explaining anything I get wrong.",
    summarise: "Please summarise this for me, covering the key points I should know.",
    flashcards: `Please create flashcards from this material covering the key concepts. Format each flashcard exactly like this, with one per line:

FRONT: [question or term] | BACK: [answer or definition]

Create at least 8 flashcards covering the most important points.`
  };

  if (el.promptChips) {
    el.promptChips.addEventListener("click", e => {
      const btn = e.target.closest(".chip");
      if (!btn || !state.currentContext) return;
      const kind = btn.dataset.prompt;

      if (kind === "mark-essay") {
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
  }

  // ============================================================
  // SETTINGS PAGE
  // ============================================================

  if (el.settingsBack) {
    el.settingsBack.addEventListener("click", () => Router.navigate("chat"));
  }

  // System instructions
  if (el.systemInstructions) {
    el.systemInstructions.addEventListener("input", () => {
      state.systemInstructions = el.systemInstructions.value;
      savePrefs();
    });
  }

  // Theme toggle
  document.querySelectorAll(".theme-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      applyTheme(btn.dataset.theme);
      savePrefs();
    });
  });

  // Animation picker
  if (el.animationGrid) {
    el.animationGrid.addEventListener("click", e => {
      const option = e.target.closest(".animation-option");
      if (!option) return;
      el.animationGrid.querySelectorAll(".animation-option").forEach(o => o.classList.remove("active"));
      option.classList.add("active");
      state.loadingAnimation = option.dataset.animation;
      savePrefs();
    });
  }

  // Model select in settings
  const settingsModelSelect = document.getElementById("settings-model-select");
  if (settingsModelSelect) {
    settingsModelSelect.addEventListener("change", () => {
      const isCustom = settingsModelSelect.value === "custom";
      el.settingsCustomModelField.hidden = !isCustom;
      if (isCustom) el.settingsCustomModel.focus();
    });
  }

  // Save keys from settings
  if (el.settingsSaveKeys) {
    el.settingsSaveKeys.addEventListener("click", async () => {
      const url = el.settingsCanvasUrl.value.trim();
      const token = el.settingsCanvasToken.value.trim();
      const key = el.settingsBazaarKey.value.trim();
      const modelVal = settingsModelSelect.value;
      const model = modelVal === "custom" ? el.settingsCustomModel.value.trim() : modelVal;

      if (url) state.canvasUrl = url;
      if (token) state.canvasToken = token;
      if (key) state.bazaarKey = key;
      if (model) state.model = model;

      await persistKeys();

      // Also save to Supabase
      if (window.SupabaseClient && window.SupabaseClient.isConfigured()) {
        await window.SupabaseClient.saveSettings({
          canvas_url: state.canvasUrl,
          canvas_token: state.canvasToken,
          bazaar_key: state.bazaarKey,
          model: state.model
        }).catch(() => {});
      }

      setStatus(el.settingsSaveStatus, "Settings saved.", "ok");
      setTimeout(() => setStatus(el.settingsSaveStatus, "", ""), 3000);
    });
  }

  // ============================================================
  // DOCS PAGE
  // ============================================================

  if (el.docsBack) {
    el.docsBack.addEventListener("click", () => Router.navigate("chat"));
  }

  // ============================================================
  // LOGOUT PAGE
  // ============================================================

  if (el.logoutConfirm) {
    el.logoutConfirm.addEventListener("click", async () => {
      localStorage.removeItem(SETTINGS_STORAGE);
      localStorage.removeItem(CRYPTO_KEY_STORAGE);
      localStorage.removeItem(PREFS_STORAGE);
      localStorage.removeItem(SIDEBAR_STORAGE);

      if (window.SupabaseClient && window.SupabaseClient.isConfigured()) {
        await window.SupabaseClient.signOut().catch(() => {});
      }

      state.canvasUrl = "";
      state.canvasToken = "";
      state.bazaarKey = "";
      state.model = "auto:free";
      state.systemInstructions = "";
      state.theme = "light";
      state.loadingAnimation = "dots";
      applyTheme("light");

      Router.navigate("connect");
    });
  }

  if (el.logoutCancel) {
    el.logoutCancel.addEventListener("click", () => Router.navigate("chat"));
  }

  // ============================================================
  // ROUTER SETUP
  // ============================================================

  function populateSettingsPage() {
    el.systemInstructions.value = state.systemInstructions || "";
    el.settingsCanvasUrl.value = state.canvasUrl || "";
    el.settingsCanvasToken.value = state.canvasToken || "";
    el.settingsBazaarKey.value = state.bazaarKey || "";

    const known = [...settingsModelSelect.options].some(o => o.value === state.model);
    if (known) {
      settingsModelSelect.value = state.model;
      el.settingsCustomModelField.hidden = true;
    } else {
      settingsModelSelect.value = "custom";
      el.settingsCustomModelField.hidden = false;
      el.settingsCustomModel.value = state.model || "";
    }

    el.animationGrid.querySelectorAll(".animation-option").forEach(o => {
      o.classList.toggle("active", o.dataset.animation === (state.loadingAnimation || "dots"));
    });
  }

  Router.init({
    connect: () => {
      showPage("connect");
      if (!window.SupabaseClient || !window.SupabaseClient.isConfigured()) {
        el.connectLoginTab.hidden = true;
        const loginTab = el.connectTabs ? el.connectTabs.querySelector('[data-tab="login"]') : null;
        if (loginTab) loginTab.style.display = "none";
      }
    },
    chat: () => {
      showPage("chat");
      if (el.courseSelect.options.length <= 1 || el.courseSelect.options[0].textContent === "Loading courses…") {
        loadCourses();
      }
      if (state.canvasUserName === "You") {
        api("/api/canvas/me", { canvasUrl: state.canvasUrl, canvasToken: state.canvasToken })
          .then(me => { if (me.name) state.canvasUserName = me.name; })
          .catch(() => {});
      }
    },
    settings: () => {
      showPage("settings");
      populateSettingsPage();
    },
    docs: () => {
      showPage("docs");
    },
    logout: () => {
      showPage("logout");
    }
  });

  // Route guards
  Router.addGuard("chat", () => {
    if (!state.canvasUrl || !state.canvasToken || !state.bazaarKey) return "connect";
    return true;
  });
  Router.addGuard("settings", () => {
    if (!state.canvasUrl || !state.canvasToken || !state.bazaarKey) return "connect";
    return true;
  });

  // ============================================================
  // INIT
  // ============================================================

  (async function init() {
    loadPrefs();

    const hasSavedKeys = await loadSavedKeys();

    if (hasSavedKeys) {
      const current = Router.current();
      if (!current || current === "connect") {
        Router.navigate("chat");
      }
    }
  })();
})();
