(function () {
  const PORT = "__PORT__"; // Replaced at inject time by server.ts

  // Module-level state
  let openCommentsBySelector = {};
  let hoveredEl = null;
  let scrollTimer = null;

  // ─── Selector builder ────────────────────────────────────────────────────
  function getSelector(el) {
    if (el === document.body) return "body";
    const parts = [];
    while (el && el !== document.body) {
      let selector = el.tagName.toLowerCase();
      if (el.id) {
        selector = `#${el.id}`;
        parts.unshift(selector);
        break;
      } else {
        const siblings = Array.from(el.parentNode?.children || []);
        const index = siblings.indexOf(el) + 1;
        selector += `:nth-child(${index})`;
      }
      parts.unshift(selector);
      el = el.parentElement;
    }
    return "body > " + parts.join(" > ");
  }

  // ─── Styles ───────────────────────────────────────────────────────────────
  function injectStyles() {
    const style = document.createElement("style");
    style.textContent = `
      #__dr-sidebar__ {
        position: fixed; top: 0; right: 0; width: 320px; height: 100vh;
        background: #fff; z-index: 999995; display: flex; flex-direction: column;
        box-shadow: -4px 0 24px rgba(0,0,0,0.12); font-family: system-ui, sans-serif;
        font-size: 13px; transition: transform 0.2s ease;
      }
      #__dr-sidebar__.collapsed { transform: translateX(288px); }
      #__dr-sidebar-header__ {
        display: flex; justify-content: space-between; align-items: center;
        padding: 12px 16px; border-bottom: 1px solid #e5e7eb;
        font-weight: 600; color: #111;
      }
      #__dr-collapse__ {
        background: none; border: none; cursor: pointer; font-size: 16px; color: #6b7280;
      }
      #__dr-sidebar-body__ {
        flex: 1; overflow-y: auto; padding: 12px;
        display: flex; flex-direction: column; gap: 10px;
      }
      .__dr-thread__ {
        border: 1px solid #e5e7eb; border-radius: 8px; padding: 10px;
        background: #fafafa;
      }
      .__dr-thread-selector__ {
        font-size: 10px; color: #9ca3af; font-family: monospace;
        margin-bottom: 4px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
      }
      .__dr-thread-excerpt__ {
        font-style: italic; color: #6b7280; font-size: 11px; margin-bottom: 6px;
      }
      .__dr-thread-body__ { color: #111; margin-bottom: 8px; line-height: 1.4; }
      .__dr-thread-actions__ { display: flex; gap: 6px; }
      .__dr-scroll-btn__, .__dr-resolve-btn__ {
        font-size: 11px; padding: 3px 8px; border-radius: 4px; cursor: pointer; border: 1px solid;
      }
      .__dr-scroll-btn__ { border-color: #d1d5db; background: #f9fafb; color: #374151; }
      .__dr-resolve-btn__ { border-color: #6366f1; background: #6366f1; color: #fff; }
      .__dr-resolve-btn__:hover { background: #4f46e5; }
      #__dr-sidebar-footer__ {
        padding: 12px 16px; border-top: 1px solid #e5e7eb;
      }
      #__dr-nudge-btn__ {
        width: 100%; padding: 8px; background: #111; color: #fff; border: none;
        border-radius: 6px; font-size: 13px; font-weight: 600; cursor: pointer;
      }
      #__dr-nudge-btn__:disabled { opacity: 0.5; cursor: not-allowed; }
      #__dr-nudge-btn__:hover:not(:disabled) { background: #333; }
      .__dr-highlight__ {
        outline: 2px solid #a5b4fc !important;
        outline-offset: 2px !important;
        transition: outline 0.15s ease;
      }
      .__dr-highlight--annotated__ {
        outline: 2px solid #6366f1 !important;
        outline-offset: 2px !important;
        transition: outline 0.15s ease;
      }
      .__dr-highlight-pulse__ {
        background-color: rgba(250, 204, 21, 0.3) !important;
        transition: background-color 0.3s ease;
      }
    `;
    document.head.appendChild(style);
  }

  // ─── Sidebar DOM ──────────────────────────────────────────────────────────
  function injectSidebar() {
    const sidebar = document.createElement("div");
    sidebar.id = "__dr-sidebar__";

    const header = document.createElement("div");
    header.id = "__dr-sidebar-header__";

    const title = document.createElement("span");
    title.innerHTML = 'Comments (<span id="__dr-count__">0</span>)';

    const collapseBtn = document.createElement("button");
    collapseBtn.id = "__dr-collapse__";
    collapseBtn.textContent = "✕";
    collapseBtn.addEventListener("click", toggleSidebar);

    header.appendChild(title);
    header.appendChild(collapseBtn);

    const body = document.createElement("div");
    body.id = "__dr-sidebar-body__";

    const footer = document.createElement("div");
    footer.id = "__dr-sidebar-footer__";

    const nudgeBtn = document.createElement("button");
    nudgeBtn.id = "__dr-nudge-btn__";
    nudgeBtn.textContent = "▶ Review Comments";

    const nudgeOutput = document.createElement("div");
    nudgeOutput.id = "__dr-nudge-output__";
    nudgeOutput.style.cssText = `
      display: none;
      margin-top: 10px;
      background: #0d0d0d;
      color: #d4d4d4;
      font-family: 'Consolas', 'Courier New', monospace;
      font-size: 11px;
      line-height: 1.5;
      padding: 10px;
      border-radius: 6px;
      max-height: 200px;
      overflow-y: auto;
      white-space: pre-wrap;
      word-break: break-word;
    `;

    footer.appendChild(nudgeBtn);
    footer.appendChild(nudgeOutput);

    sidebar.appendChild(header);
    sidebar.appendChild(body);
    sidebar.appendChild(footer);

    document.body.appendChild(sidebar);

    // Restore collapsed state from session
    const isOpen = sessionStorage.getItem("__dr_sidebar_open__") !== "false";
    if (!isOpen) {
      sidebar.classList.add("collapsed");
      collapseBtn.textContent = "▶";
    }

    attachNudgeButton();
  }

  // ─── Sidebar open / collapse ──────────────────────────────────────────────
  function openSidebar() {
    const sidebar = document.getElementById("__dr-sidebar__");
    const collapseBtn = document.getElementById("__dr-collapse__");
    if (!sidebar) return;
    sidebar.classList.remove("collapsed");
    if (collapseBtn) collapseBtn.textContent = "✕";
    sessionStorage.setItem("__dr_sidebar_open__", "true");
  }

  function toggleSidebar() {
    const sidebar = document.getElementById("__dr-sidebar__");
    const collapseBtn = document.getElementById("__dr-collapse__");
    if (!sidebar) return;
    const isCollapsed = sidebar.classList.toggle("collapsed");
    if (collapseBtn) collapseBtn.textContent = isCollapsed ? "▶" : "✕";
    sessionStorage.setItem("__dr_sidebar_open__", String(!isCollapsed));
  }

  function scrollSidebarToSelector(selector) {
    const body = document.getElementById("__dr-sidebar-body__");
    if (!body) return;
    // Iterate cards and compare dataset directly — safer than attribute selectors with special chars
    const cards = body.querySelectorAll(".__dr-thread__");
    for (const card of cards) {
      if (card.dataset.selector === selector) {
        card.scrollIntoView({ behavior: "smooth", block: "nearest" });
        break;
      }
    }
  }

  // ─── Comment box (Phase 1 behavior, unchanged) ───────────────────────────
  function showCommentBox(x, y, selector, excerpt) {
    const existing = document.getElementById("__docreview__");
    if (existing) existing.remove();

    const box = document.createElement("div");
    box.id = "__docreview__";
    box.style.cssText = `
      position: fixed;
      top: ${Math.min(y, window.innerHeight - 180)}px;
      left: ${Math.min(x, window.innerWidth - 320)}px;
      width: 300px;
      background: #fff;
      border: 2px solid #6366f1;
      border-radius: 8px;
      padding: 12px;
      z-index: 999999;
      box-shadow: 0 4px 24px rgba(0,0,0,0.18);
      font-family: system-ui, sans-serif;
      font-size: 13px;
    `;

    const label = document.createElement("div");
    label.style.cssText = "margin-bottom:6px; color:#555; font-size:11px;";
    label.textContent = `On: ${excerpt.slice(0, 60)}${excerpt.length > 60 ? "…" : ""}`;

    const textarea = document.createElement("textarea");
    textarea.style.cssText =
      "width:100%; height:72px; box-sizing:border-box; border:1px solid #ccc; border-radius:4px; padding:6px; font-size:13px; resize:vertical;";
    textarea.placeholder = "Leave a comment…";

    const btnRow = document.createElement("div");
    btnRow.style.cssText =
      "display:flex; gap:8px; margin-top:8px; justify-content:flex-end;";

    const cancelBtn = document.createElement("button");
    cancelBtn.textContent = "Cancel";
    cancelBtn.style.cssText =
      "padding:4px 12px; border:1px solid #ccc; background:#f5f5f5; border-radius:4px; cursor:pointer;";
    cancelBtn.onclick = () => box.remove();

    const submitBtn = document.createElement("button");
    submitBtn.textContent = "Submit";
    submitBtn.style.cssText =
      "padding:4px 12px; background:#6366f1; color:#fff; border:none; border-radius:4px; cursor:pointer;";
    submitBtn.onclick = async () => {
      const body = textarea.value.trim();
      if (!body) return;
      submitBtn.disabled = true;
      submitBtn.textContent = "Saving…";
      try {
        await fetch(`http://localhost:${PORT}/comments`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ selector, excerpt, body }),
        });
        box.remove();
        refreshComments();
      } catch (e) {
        submitBtn.textContent = "Error — retry";
        submitBtn.disabled = false;
      }
    };

    btnRow.appendChild(cancelBtn);
    btnRow.appendChild(submitBtn);
    box.appendChild(label);
    box.appendChild(textarea);
    box.appendChild(btnRow);
    document.body.appendChild(box);
    textarea.focus();
  }

  // ─── Badges ───────────────────────────────────────────────────────────────
  function clearBadges() {
    document.querySelectorAll(".__dr-badge__").forEach((b) => b.remove());
  }

  function injectBadge(selector, count) {
    const el = document.querySelector(selector);
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const badge = document.createElement("div");
    badge.className = "__dr-badge__";
    badge.dataset.selector = selector;
    badge.textContent = count;
    badge.style.cssText = `
      position: fixed;
      top: ${rect.top}px;
      left: ${rect.right - 20}px;
      width: 18px;
      height: 18px;
      border-radius: 50%;
      background: #6366f1;
      color: #fff;
      font-size: 10px;
      font-weight: 700;
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 999990;
      pointer-events: none;
      font-family: system-ui, sans-serif;
    `;
    document.body.appendChild(badge);
  }

  function repositionBadges() {
    document.querySelectorAll(".__dr-badge__").forEach((badge) => {
      const selector = badge.dataset.selector;
      if (!selector) return;
      const el = document.querySelector(selector);
      if (!el) return;
      const rect = el.getBoundingClientRect();
      badge.style.top = `${rect.top}px`;
      badge.style.left = `${rect.right - 20}px`;
    });
  }

  // ─── Sidebar thread list ──────────────────────────────────────────────────
  function renderSidebar(comments) {
    const body = document.getElementById("__dr-sidebar-body__");
    const countEl = document.getElementById("__dr-count__");
    if (!body) return;

    const openComments = comments.filter((c) => c.status === "open");
    if (countEl) countEl.textContent = String(openComments.length);

    body.innerHTML = "";

    if (openComments.length === 0) {
      const empty = document.createElement("div");
      empty.style.cssText =
        "color: #9ca3af; font-size: 13px; padding: 12px 0; text-align: center;";
      empty.textContent = "No open comments";
      body.appendChild(empty);
      return;
    }

    openComments.forEach((comment) => {
      const card = document.createElement("div");
      card.className = "__dr-thread__";
      card.dataset.id = comment.id;
      card.dataset.selector = comment.selector;

      const selectorEl = document.createElement("div");
      selectorEl.className = "__dr-thread-selector__";
      selectorEl.textContent = comment.selector;

      const excerptEl = document.createElement("div");
      excerptEl.className = "__dr-thread-excerpt__";
      if (comment.excerpt) {
        const truncated = comment.excerpt.slice(0, 80);
        excerptEl.textContent = `"${truncated}${comment.excerpt.length > 80 ? "…" : ""}"`;
      }

      const bodyEl = document.createElement("div");
      bodyEl.className = "__dr-thread-body__";
      bodyEl.textContent = comment.body;

      const actions = document.createElement("div");
      actions.className = "__dr-thread-actions__";

      const scrollBtn = document.createElement("button");
      scrollBtn.className = "__dr-scroll-btn__";
      scrollBtn.textContent = "↳ Show in page";
      scrollBtn.addEventListener("click", () => {
        const target = document.querySelector(comment.selector);
        if (!target) return;
        target.scrollIntoView({ behavior: "smooth", block: "center" });
        target.classList.add("__dr-highlight-pulse__");
        setTimeout(() => target.classList.remove("__dr-highlight-pulse__"), 1500);
      });

      const resolveBtn = document.createElement("button");
      resolveBtn.className = "__dr-resolve-btn__";
      resolveBtn.textContent = "✓ Resolve";
      resolveBtn.addEventListener("click", async () => {
        resolveBtn.disabled = true;
        resolveBtn.textContent = "Resolving…";
        try {
          await fetch(`http://localhost:${PORT}/comments/${comment.id}/resolve`, {
            method: "PATCH",
          });
          refreshComments();
        } catch (e) {
          resolveBtn.disabled = false;
          resolveBtn.textContent = "✓ Resolve";
        }
      });

      actions.appendChild(scrollBtn);
      actions.appendChild(resolveBtn);

      card.appendChild(selectorEl);
      card.appendChild(excerptEl);
      card.appendChild(bodyEl);
      card.appendChild(actions);

      body.appendChild(card);
    });
  }

  // ─── Refresh (central update entry point) ─────────────────────────────────
  function refreshComments() {
    fetch(`http://localhost:${PORT}/comments`)
      .then((r) => r.json())
      .then((comments) => {
        // Rebuild selector index for open comments
        openCommentsBySelector = {};
        comments
          .filter((c) => c.status === "open")
          .forEach((c) => {
            if (!openCommentsBySelector[c.selector]) {
              openCommentsBySelector[c.selector] = [];
            }
            openCommentsBySelector[c.selector].push(c);
          });

        // Re-render badges
        clearBadges();
        Object.entries(openCommentsBySelector).forEach(([selector, list]) => {
          injectBadge(selector, list.length);
        });

        // Re-render sidebar
        renderSidebar(comments);
      })
      .catch(() => {});
  }

  // ─── Nudge button ─────────────────────────────────────────────────────────
  function attachNudgeButton() {
    const btn = document.getElementById("__dr-nudge-btn__");
    const output = document.getElementById("__dr-nudge-output__");
    if (!btn || !output) return;

    btn.addEventListener("click", async () => {
      btn.disabled = true;
      btn.textContent = "⏳ Reviewing…";
      output.style.display = "block";
      output.textContent = "";

      try {
        const res = await fetch(`http://localhost:${PORT}/nudge`, { method: "POST" });
        const data = await res.json();

        if (!res.ok) {
          output.textContent = `Error: ${data.error}`;
          btn.disabled = false;
          btn.textContent = "▶ Review Comments";
          return;
        }

        output.textContent = `Agent started — reviewing ${data.commentCount} comment(s)...\n`;

        const evtSource = new EventSource(`http://localhost:${PORT}/nudge/stream`);
        evtSource.onmessage = (e) => {
          const msg = JSON.parse(e.data);
          if (msg.text) {
            output.textContent += msg.text;
            output.scrollTop = output.scrollHeight;
          }
          if (msg.done) {
            evtSource.close();
            btn.disabled = false;
            btn.textContent = "▶ Review Comments";
            setTimeout(refreshComments, 500);
          }
        };
        evtSource.onerror = () => {
          evtSource.close();
          btn.disabled = false;
          btn.textContent = "▶ Review Comments";
        };
      } catch (err) {
        output.textContent = `Failed to reach docreview server: ${err.message}`;
        btn.disabled = false;
        btn.textContent = "▶ Review Comments";
      }
    });
  }

  // ─── Event handlers ───────────────────────────────────────────────────────
  document.addEventListener("click", (e) => {
    if (e.target.closest("#__docreview__")) return;
    if (e.target.closest("#__dr-sidebar__")) return;

    const selector = getSelector(e.target);
    const hasComments = openCommentsBySelector[selector]?.length > 0;

    if (hasComments) {
      openSidebar();
      scrollSidebarToSelector(selector);
    } else {
      const excerpt = (e.target.innerText || e.target.textContent || "")
        .trim()
        .slice(0, 120);
      showCommentBox(e.clientX + 8, e.clientY + 8, selector, excerpt);
    }
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      const box = document.getElementById("__docreview__");
      if (box) box.remove();
    }
  });

  // Two hover states: subtle outline for plain elements, brighter for annotated ones
  document.addEventListener("mouseover", (e) => {
    if (e.target.closest("#__dr-sidebar__") || e.target.closest("#__docreview__")) return;
    if (hoveredEl) {
      hoveredEl.classList.remove("__dr-highlight__");
      hoveredEl.classList.remove("__dr-highlight--annotated__");
    }
    hoveredEl = e.target;
    const selector = getSelector(hoveredEl);
    const isAnnotated = openCommentsBySelector[selector]?.length > 0;
    hoveredEl.classList.add(
      isAnnotated ? "__dr-highlight--annotated__" : "__dr-highlight__"
    );
  });

  document.addEventListener("mouseout", () => {
    if (hoveredEl) {
      hoveredEl.classList.remove("__dr-highlight__");
      hoveredEl.classList.remove("__dr-highlight--annotated__");
    }
    hoveredEl = null;
  });

  window.addEventListener("scroll", () => {
    clearTimeout(scrollTimer);
    scrollTimer = setTimeout(repositionBadges, 100);
  });

  // ─── Init ─────────────────────────────────────────────────────────────────
  injectStyles();
  injectSidebar();
  refreshComments();
})();
