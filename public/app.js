(() => {
  "use strict";

  // ============================================================
  // Storage keys
  // ============================================================
  const CRYPTO_KEY_STORAGE = "elucidateCryptoKey";
  const SETTINGS_STORAGE = "elucidateSettings";
  const SIDEBAR_STORAGE = "elucidateSidebarCollapsed";
  const PREFS_STORAGE = "elucidatePrefs";
  const CHAT_STORAGE_PREFIX = "elucidate_chat_";

  // ============================================================
  // Crypto helpers (AES-GCM Web Crypto)
  // ============================================================
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
        // fall through
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

  // ============================================================
  // Gradients for Course Cards
  // ============================================================
  const CARD_GRADIENTS = [
    "linear-gradient(135deg, #1e40af 0%, #3b82f6 100%)",
    "linear-gradient(135deg, #065f46 0%, #10b981 100%)",
    "linear-gradient(135deg, #7c2d12 0%, #f97316 100%)",
    "linear-gradient(135deg, #581c87 0%, #a855f7 100%)",
    "linear-gradient(135deg, #831843 0%, #ec4899 100%)",
    "linear-gradient(135deg, #134e4a 0%, #14b8a6 100%)",
    "linear-gradient(135deg, #1e293b 0%, #64748b 100%)",
    "linear-gradient(135deg, #854d0e 0%, #eab308 100%)"
  ];

  function getGradientForIndex(i) {
    return CARD_GRADIENTS[i % CARD_GRADIENTS.length];
  }

  // ============================================================
  // App State
  // ============================================================
  const state = {
    canvasUrl: "",
    canvasToken: "",
    bazaarKey: "",
    model: "auto:free",
    courses: [],             // [{id, name, course_code}]
    currentCourse: null,     // {id, name}
    currentContentType: "",  // 'modules', 'assignments', 'discussions', 'pages'
    currentContext: null,    // { title, body, extra, mediaHints, htmlUrl }
    activeView: "dashboard", // 'dashboard' | 'courses' | 'course-detail' | 'tabs'
    activeTab: "content",    // 'content' | 'chat'
    messages: [],            // [{role, content}] for active course
    canvasUserName: "You",
    cryptoKey: null,
    systemInstructions: "",
    theme: "light",
    loadingAnimation: "dots",
    pendingAttachments: [],
    currentSessionId: null   // Supabase chat session UUID
  };

  // ============================================================
  // Page Elements
  // ============================================================
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

  // ============================================================
  // View Elements inside Chat Shell
  // ============================================================
  const views = {
    dashboard: document.getElementById("view-dashboard"),
    courses: document.getElementById("view-courses"),
    courseDetail: document.getElementById("view-course-detail"),
    tabs: document.getElementById("view-tabs")
  };

  const el = {
    // Shell & Sidebar
    appShell: document.getElementById("app-shell"),
    sidebar: document.getElementById("sidebar"),
    sidebarCollapseBtn: document.getElementById("sidebar-collapse-btn"),
    sidebarMainNav: document.getElementById("sidebar-main-nav"),
    sidebarNav: document.getElementById("sidebar-nav"),

    // Dashboard View
    courseGallery: document.getElementById("course-gallery"),

    // Courses View
    courseList: document.getElementById("course-list"),

    // Course Detail View
    courseDetailBack: document.getElementById("course-detail-back"),
    courseDetailTitle: document.getElementById("course-detail-title"),
    courseNavGrid: document.getElementById("course-nav-grid"),
    courseItemsSection: document.getElementById("course-items-section"),
    itemsBack: document.getElementById("items-back"),
    itemsSectionTitle: document.getElementById("items-section-title"),
    itemList: document.getElementById("item-list"),
    moduleItemList: document.getElementById("module-item-list"),

    // Tabs View
    tabBar: document.getElementById("tab-bar"),
    tabBack: document.getElementById("tab-back"),
    tabBtnContent: document.getElementById("tab-btn-content"),
    tabBtnChat: document.getElementById("tab-btn-chat"),
    tabContentLabel: document.getElementById("tab-content-label"),
    tabPanelContent: document.getElementById("tab-panel-content"),
    tabPanelChat: document.getElementById("tab-panel-chat"),

    // Content Preview
    contentPreview: document.getElementById("content-preview"),
    previewTitle: document.getElementById("preview-title"),
    previewExtra: document.getElementById("preview-extra"),
    previewText: document.getElementById("preview-text"),
    mediaWarning: document.getElementById("media-warning"),
    previewCanvasLink: document.getElementById("preview-canvas-link"),

    // Chat
    chatLog: document.getElementById("chat-log"),
    emptyState: document.getElementById("empty-state"),
    promptChips: document.getElementById("prompt-chips"),
    chatForm: document.getElementById("chat-form"),
    chatInput: document.getElementById("chat-input"),
    attachBtn: document.getElementById("attach-btn"),
    fileInput: document.getElementById("file-input"),
    attachmentChips: document.getElementById("attachment-chips"),

    // Connect Page
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

    // Settings Page
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

    // Docs Page
    docsBack: document.getElementById("docs-back"),

    // Logout Page
    logoutConfirm: document.getElementById("logout-confirm"),
    logoutCancel: document.getElementById("logout-cancel")
  };

  // ============================================================
  // Persistence & Preferences
  // ============================================================
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

  // ============================================================
  // API Helpers
  // ============================================================
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

  function renderMarkdown(text) {
    if (window.marked && window.DOMPurify) {
      const html = marked.parse(text, { breaks: true });
      return DOMPurify.sanitize(html);
    }
    return escapeHtml(text).replace(/\n/g, "<br>");
  }

  // ============================================================
  // View Management
  // ============================================================
  function showView(viewName) {
    state.activeView = viewName;
    Object.keys(views).forEach(k => {
      if (views[k]) views[k].hidden = true;
    });

    if (viewName === "dashboard") {
      views.dashboard.hidden = false;
      updateSidebarActiveLink("dashboard");
      renderDashboard();
    } else if (viewName === "courses") {
      views.courses.hidden = false;
      updateSidebarActiveLink("courses");
      renderCoursesList();
    } else if (viewName === "course-detail") {
      views.courseDetail.hidden = false;
      updateSidebarActiveLink("courses");
    } else if (viewName === "tabs") {
      views.tabs.hidden = false;
      updateSidebarActiveLink("courses");
    }
  }

  function updateSidebarActiveLink(viewKey) {
    if (!el.sidebarMainNav) return;
    el.sidebarMainNav.querySelectorAll(".sidebar-link").forEach(link => {
      link.classList.toggle("active", link.dataset.view === viewKey);
    });
  }

  // ============================================================
  // Courses Data & Rendering
  // ============================================================
  async function fetchCourses() {
    if (state.courses && state.courses.length > 0) {
      return state.courses;
    }
    try {
      const courses = await api("/api/canvas/courses", {
        canvasUrl: state.canvasUrl,
        canvasToken: state.canvasToken
      });
      state.courses = courses;
      return courses;
    } catch (err) {
      console.error("Failed to load courses:", err);
      throw err;
    }
  }

  async function renderDashboard() {
    el.courseGallery.innerHTML = `<div class="gallery-loading"><span class="btn-spinner"></span> Loading courses…</div>`;
    try {
      const courses = await fetchCourses();
      if (courses.length === 0) {
        el.courseGallery.innerHTML = `<div class="empty-gallery">No active courses found.</div>`;
        return;
      }
      el.courseGallery.innerHTML = "";
      courses.forEach((course, index) => {
        const card = document.createElement("div");
        card.className = "course-card";
        const gradient = getGradientForIndex(index);

        card.innerHTML = `
          <div class="course-card-banner" style="background: ${gradient}">
            <div class="course-card-banner-icon">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>
            </div>
          </div>
          <div class="course-card-content">
            <span class="course-card-code">Course ${escapeHtml(String(course.id))}</span>
            <h3 class="course-card-title">${escapeHtml(course.name)}</h3>
          </div>
        `;

        card.addEventListener("click", () => {
          openCourseDetail(course);
        });

        el.courseGallery.appendChild(card);
      });
    } catch (err) {
      el.courseGallery.innerHTML = `<div class="hint error">Error loading courses: ${escapeHtml(err.message)}</div>`;
    }
  }

  async function renderCoursesList() {
    el.courseList.innerHTML = `<div class="gallery-loading"><span class="btn-spinner"></span> Loading courses…</div>`;
    try {
      const courses = await fetchCourses();
      if (courses.length === 0) {
        el.courseList.innerHTML = `<div class="empty-gallery">No active courses found.</div>`;
        return;
      }
      el.courseList.innerHTML = "";
      courses.forEach(course => {
        const item = document.createElement("div");
        item.className = "course-list-item";
        item.innerHTML = `
          <div class="course-list-info">
            <div class="course-list-title">${escapeHtml(course.name)}</div>
            <div class="course-list-code">ID: ${escapeHtml(String(course.id))}</div>
          </div>
          <div class="course-list-arrow">&rarr;</div>
        `;

        item.addEventListener("click", () => {
          openCourseDetail(course);
        });

        el.courseList.appendChild(item);
      });
    } catch (err) {
      el.courseList.innerHTML = `<div class="hint error">Error loading courses: ${escapeHtml(err.message)}</div>`;
    }
  }

  // ============================================================
  // Course Detail Page
  // ============================================================
  function openCourseDetail(course) {
    state.currentCourse = course;
    el.courseDetailTitle.textContent = course.name;
    el.courseNavGrid.hidden = false;
    el.courseItemsSection.hidden = true;
    showView("course-detail");
    loadChatForCourse(course.id);
  }

  // Clicks on Course Nav Cards (Modules, Assignments, Discussions, Pages)
  if (el.courseNavGrid) {
    el.courseNavGrid.addEventListener("click", e => {
      const card = e.target.closest(".course-nav-card");
      if (!card || !state.currentCourse) return;
      const type = card.dataset.type;
      state.currentContentType = type;

      const titles = {
        modules: "Modules",
        assignments: "Assignments",
        discussions: "Discussions",
        pages: "Pages"
      };

      el.itemsSectionTitle.textContent = titles[type] || "Items";
      el.courseNavGrid.hidden = true;
      el.courseItemsSection.hidden = false;
      el.moduleItemList.hidden = true;
      el.itemList.hidden = false;
      loadItems(type);
    });
  }

  if (el.itemsBack) {
    el.itemsBack.addEventListener("click", () => {
      el.courseItemsSection.hidden = true;
      el.courseNavGrid.hidden = false;
    });
  }

  if (el.courseDetailBack) {
    el.courseDetailBack.addEventListener("click", () => {
      showView("dashboard");
    });
  }

  async function loadItems(type) {
    el.itemList.innerHTML = `<div class="gallery-loading"><span class="btn-spinner"></span> Loading ${type}…</div>`;
    try {
      const items = await api("/api/canvas/items", {
        canvasUrl: state.canvasUrl,
        canvasToken: state.canvasToken,
        courseId: state.currentCourse.id,
        type
      });
      if (items.length === 0) {
        el.itemList.innerHTML = `<p class="hint">No items found in this section.</p>`;
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
          if (type === "modules") {
            loadModuleItems(item.id, item.name);
          } else {
            const singular = type.slice(0, -1);
            openTabView(singular, item.id, item.name);
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
    el.moduleItemList.innerHTML = `<div class="gallery-loading"><span class="btn-spinner"></span> Loading items…</div>`;
    try {
      const items = await api("/api/canvas/module-items", {
        canvasUrl: state.canvasUrl,
        canvasToken: state.canvasToken,
        courseId: state.currentCourse.id,
        moduleId
      });
      el.moduleItemList.innerHTML = "";
      const back = document.createElement("button");
      back.className = "back-row";
      back.textContent = `← Back to Modules (${moduleName})`;
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
          row.title = "This item type cannot be extracted automatically.";
          row.style.opacity = "0.45";
          row.style.cursor = "default";
        } else {
          row.addEventListener("click", () => {
            const idForFetch = item.type === "Page" ? item.page_url : item.content_id;
            openTabView(item.type.toLowerCase(), idForFetch, item.name, item.html_url);
          });
        }
        el.moduleItemList.appendChild(row);
      });
    } catch (err) {
      el.moduleItemList.innerHTML = `<p class="hint error">${escapeHtml(err.message)}</p>`;
    }
  }

  // ============================================================
  // VSCode-Style Tab System (Content + AI Chat)
  // ============================================================
  function switchTab(tabName) {
    state.activeTab = tabName;
    const isContent = tabName === "content";
    el.tabBtnContent.classList.toggle("active", isContent);
    el.tabBtnChat.classList.toggle("active", !isContent);
    el.tabPanelContent.hidden = !isContent;
    el.tabPanelChat.hidden = isContent;

    if (!isContent) {
      scrollChatToBottom();
      el.chatInput.focus();
    }
  }

  if (el.tabBtnContent) {
    el.tabBtnContent.addEventListener("click", () => switchTab("content"));
  }
  if (el.tabBtnChat) {
    el.tabBtnChat.addEventListener("click", () => switchTab("chat"));
  }

  if (el.tabBack) {
    el.tabBack.addEventListener("click", () => {
      showView("course-detail");
    });
  }

  async function openTabView(type, itemId, itemName, htmlUrl) {
    showView("tabs");
    switchTab("content");

    el.tabContentLabel.textContent = itemName || "Content";
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
            courseId: state.currentCourse.id,
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
            courseId: state.currentCourse.id,
            type,
            itemId
          });
        }
      } else {
        data = await api("/api/canvas/content", {
          canvasUrl: state.canvasUrl,
          canvasToken: state.canvasToken,
          courseId: state.currentCourse.id,
          type,
          itemId
        });
      }

      state.currentContext = data;
      el.previewTitle.textContent = data.title || itemName || "Untitled";
      el.previewExtra.textContent = data.extra || "";
      el.previewText.textContent = data.body || "(No text content)";

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

      el.promptChips.hidden = false;
      setInputEnabled(true);
    } catch (err) {
      el.previewTitle.textContent = "Couldn't load this item";
      el.previewText.textContent = err.message;
    }
  }

  // ============================================================
  // Per-Subject Chat Persistence
  // ============================================================
  async function loadChatForCourse(courseId) {
    if (!courseId) return;
    state.messages = [];
    state.currentSessionId = null;
    el.chatLog.innerHTML = "";
    if (el.emptyState) el.chatLog.appendChild(el.emptyState);

    let loaded = false;

    // Try Supabase first if configured
    if (window.SupabaseClient && window.SupabaseClient.isConfigured()) {
      try {
        const { data: session } = await window.SupabaseClient.findChatSessionForCourse(courseId);
        if (session) {
          state.currentSessionId = session.id;
          const { data: dbMessages } = await window.SupabaseClient.loadChatMessages(session.id);
          if (dbMessages && dbMessages.length > 0) {
            state.messages = dbMessages.map(m => ({ role: m.role, content: m.content }));
            renderAllMessages(state.messages);
            loaded = true;
          }
        }
      } catch (e) {
        console.warn("Could not load messages from Supabase:", e);
      }
    }

    // Fallback to localStorage if not loaded from Supabase
    if (!loaded) {
      try {
        const local = localStorage.getItem(CHAT_STORAGE_PREFIX + courseId);
        if (local) {
          const parsed = JSON.parse(local);
          if (Array.isArray(parsed) && parsed.length > 0) {
            state.messages = parsed;
            renderAllMessages(state.messages);
            loaded = true;
          }
        }
      } catch (e) {
        console.warn("Could not load local chat history:", e);
      }
    }

    if (!loaded) {
      if (el.emptyState) el.emptyState.hidden = false;
    }
  }

  function saveChatLocally(courseId) {
    if (!courseId) return;
    try {
      localStorage.setItem(CHAT_STORAGE_PREFIX + courseId, JSON.stringify(state.messages));
    } catch (e) {
      console.warn("Could not save chat to localStorage:", e);
    }
  }

  function renderAllMessages(messages) {
    el.chatLog.innerHTML = "";
    messages.forEach(msg => {
      const senderLabel = msg.role === "user" ? (state.canvasUserName || "You") : formatModelName(state.model);
      const contentHtml = msg.role === "user" ? escapeHtml(msg.content).replace(/\n/g, "<br>") : renderMarkdown(msg.content);
      const { bubble } = addMessage(msg.role, senderLabel, contentHtml);
      if (msg.role === "assistant") {
        addDownloadButtons(bubble);
        const cards = parseFlashcards(msg.content);
        if (cards.length >= 2) {
          renderFlashcardDeck(cards, bubble);
        }
      }
    });
    scrollChatToBottom();
  }

  function setInputEnabled(enabled) {
    el.chatInput.disabled = !enabled;
    el.attachBtn.disabled = !enabled;
  }

  function addMessage(role, senderLabel, contentHtml) {
    if (el.emptyState && el.emptyState.parentNode === el.chatLog) {
      el.chatLog.removeChild(el.emptyState);
    }

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

  // ============================================================
  // Code block download buttons & 3D Flashcards
  // ============================================================
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
    hint.textContent = "Click card to flip";
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

  // ============================================================
  // Streaming Typewriter & Message Execution
  // ============================================================
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
    if (!text || !state.currentCourse) return;

    let displayHtml = escapeHtml(text).replace(/\n/g, "<br>");
    if (state.pendingAttachments.length > 0) {
      const attachNames = state.pendingAttachments.map(a => `📎 ${escapeHtml(a.name)}`).join("<br>");
      displayHtml += `<br><span style="font-size:12px;color:var(--text-faint)">${attachNames}</span>`;
    }

    addMessage("user", state.canvasUserName || "You", displayHtml);
    state.messages.push({ role: "user", content: text });
    saveChatLocally(state.currentCourse.id);
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
          context: state.currentContext || { title: state.currentCourse.name, body: "General discussion about " + state.currentCourse.name },
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
        saveChatLocally(state.currentCourse.id);

        if (window.SupabaseClient && window.SupabaseClient.isConfigured()) {
          // If no session exists yet, create one
          if (!state.currentSessionId) {
            try {
              const { data: session } = await window.SupabaseClient.saveChatSession({
                title: state.currentCourse.name,
                course_id: state.currentCourse.id,
                context: state.currentContext
              });
              if (session) state.currentSessionId = session.id;
            } catch (e) {}
          }
          if (state.currentSessionId) {
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
      }
    } catch (err) {
      bubble.innerHTML = `<em>Error: ${escapeHtml(err.message)}</em>`;
    } finally {
      setInputEnabled(true);
      el.chatInput.focus();
    }
  }

  // ============================================================
  // Event Listeners: Chat Input, Files, Prompts
  // ============================================================
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
      reader.readAsText(file);
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
      if (!btn) return;
      const kind = btn.dataset.prompt;

      if (kind === "mark-essay") {
        switchTab("chat");
        el.chatInput.value =
          "Please mark my essay below against the marking guide or rubric on this page, and give me feedback on how to improve it.\n\nMy essay:\n";
        el.chatInput.style.height = "auto";
        el.chatInput.style.height = Math.min(el.chatInput.scrollHeight, 160) + "px";
        el.chatInput.focus();
        el.chatInput.selectionStart = el.chatInput.selectionEnd = el.chatInput.value.length;
        return;
      }

      const prompt = QUICK_PROMPTS[kind];
      if (prompt) {
        switchTab("chat");
        sendMessage(prompt);
      }
    });
  }

  // ============================================================
  // Sidebar Navigation Listeners
  // ============================================================
  if (el.sidebarCollapseBtn) {
    el.sidebarCollapseBtn.addEventListener("click", () => {
      const collapsed = el.appShell.classList.toggle("sidebar-collapsed");
      localStorage.setItem(SIDEBAR_STORAGE, collapsed ? "1" : "0");
    });
  }

  if (localStorage.getItem(SIDEBAR_STORAGE) === "1" && el.appShell) {
    el.appShell.classList.add("sidebar-collapsed");
  }

  if (el.sidebarMainNav) {
    el.sidebarMainNav.addEventListener("click", e => {
      const link = e.target.closest(".sidebar-link");
      if (!link) return;
      const view = link.dataset.view;
      if (view) showView(view);
    });
  }

  if (el.sidebarNav) {
    el.sidebarNav.addEventListener("click", e => {
      const btn = e.target.closest(".sidebar-nav-btn");
      if (!btn) return;
      const route = btn.dataset.route;
      if (route) Router.navigate(route);
    });
  }

  // ============================================================
  // Connect Page Logic
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
        state.courses = [];
        const courses = await fetchCourses();
        if (courses.length === 0) {
          setStatus(el.settingsStatus, "No active courses found.", "error");
          return;
        }
        setStatus(el.settingsStatus, `Connected — ${courses.length} course${courses.length === 1 ? "" : "s"} found.`, "ok");

        api("/api/canvas/me", { canvasUrl: state.canvasUrl, canvasToken: state.canvasToken })
          .then(me => { if (me.name) state.canvasUserName = me.name; })
          .catch(() => {});

        Router.navigate("chat");
      } catch (err) {
        setStatus(el.settingsStatus, err.message, "error");
      } finally {
        el.saveSettings.disabled = false;
        el.saveSettings.textContent = originalLabel;
      }
    });
  }

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
  // Settings Page Logic
  // ============================================================
  if (el.settingsBack) {
    el.settingsBack.addEventListener("click", () => Router.navigate("chat"));
  }

  if (el.systemInstructions) {
    el.systemInstructions.addEventListener("input", () => {
      state.systemInstructions = el.systemInstructions.value;
      savePrefs();
    });
  }

  document.querySelectorAll(".theme-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      applyTheme(btn.dataset.theme);
      savePrefs();
    });
  });

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

  const settingsModelSelect = document.getElementById("settings-model-select");
  if (settingsModelSelect) {
    settingsModelSelect.addEventListener("change", () => {
      const isCustom = settingsModelSelect.value === "custom";
      el.settingsCustomModelField.hidden = !isCustom;
      if (isCustom) el.settingsCustomModel.focus();
    });
  }

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

  // ============================================================
  // Docs & Logout Logic
  // ============================================================
  if (el.docsBack) {
    el.docsBack.addEventListener("click", () => Router.navigate("chat"));
  }

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
      state.courses = [];
      state.currentCourse = null;
      applyTheme("light");

      Router.navigate("connect");
    });
  }

  if (el.logoutCancel) {
    el.logoutCancel.addEventListener("click", () => Router.navigate("chat"));
  }

  // ============================================================
  // Router Initialization
  // ============================================================
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
      if (state.canvasUserName === "You") {
        api("/api/canvas/me", { canvasUrl: state.canvasUrl, canvasToken: state.canvasToken })
          .then(me => { if (me.name) state.canvasUserName = me.name; })
          .catch(() => {});
      }
      showView(state.activeView || "dashboard");
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

  // Guards
  Router.addGuard("chat", () => {
    if (!state.canvasUrl || !state.canvasToken || !state.bazaarKey) return "connect";
    return true;
  });
  Router.addGuard("settings", () => {
    if (!state.canvasUrl || !state.canvasToken || !state.bazaarKey) return "connect";
    return true;
  });

  // ============================================================
  // Application Bootstrap
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
