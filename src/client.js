(function () {
  const PORT = "__PORT__"; // Replaced at inject time by server.ts

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

  fetch(`http://localhost:${PORT}/comments`)
    .then((r) => r.json())
    .then((comments) => {
      console.log("[docreview] loaded", comments.length, "comment(s)");
    })
    .catch(() => {});

  document.addEventListener("click", (e) => {
    if (e.target.closest("#__docreview__")) return;
    const selector = getSelector(e.target);
    const excerpt = (e.target.innerText || e.target.textContent || "")
      .trim()
      .slice(0, 120);
    showCommentBox(e.clientX + 8, e.clientY + 8, selector, excerpt);
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      const box = document.getElementById("__docreview__");
      if (box) box.remove();
    }
  });
})();
