const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const statusElement = $("#global-status");
const state = { courses: [], users: [], actorRole: "delegate", usagePage: 1, usagePages: 1, knowledgeTimer: 0 };

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[character]);
}

function setStatus(message = "") {
  statusElement.textContent = message;
}

async function api(url, options = {}) {
  const response = await fetch(url, {
    headers: { Accept: "application/json", ...(options.headers || {}) },
    ...options
  });
  if (response.status === 401) {
    location.assign(`/?next=${encodeURIComponent(location.pathname)}`);
    throw new Error("Sign in required.");
  }
  const body = response.status === 204 ? null : await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body?.error || "The request could not be completed.");
  return body;
}

function formatDate(value) {
  return value ? new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)) : "Never";
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function courseName(id) {
  return state.courses.find((course) => course.id === id)?.title || id;
}

async function loadUsage() {
  setStatus("");
  const form = new FormData($("#usage-filters"));
  const params = new URLSearchParams({ page: String(state.usagePage) });
  for (const [key, value] of form) if (value) params.set(key, String(value));
  const data = await api(`/api/admin/usage?${params}`);
  const metrics = [
    ["Total questions", data.metrics.totalQuestions],
    ["Successful answers", data.metrics.successfulAnswers],
    ["Active delegates", data.metrics.activeDelegates],
    ["Errors", data.metrics.errors],
    ["Input tokens", data.metrics.inputTokens],
    ["Output tokens", data.metrics.outputTokens]
  ];
  $("#usage-metrics").innerHTML = metrics.map(([label, value]) =>
    `<div class="metric"><span>${escapeHtml(label)}</span><strong>${Number(value).toLocaleString()}</strong></div>`
  ).join("");
  $("#usage-rows").innerHTML = data.records.length ? data.records.map((record) => `
    <tr>
      <td>${escapeHtml(formatDate(record.createdAt))}</td>
      <td>${escapeHtml(record.user.name)}<span class="filename">${escapeHtml(record.user.email)}</span></td>
      <td class="question">${escapeHtml(record.question)}</td>
      <td>${escapeHtml([...record.matchedCourseIds, ...record.matchedModuleIds].join(", ") || "—")}</td>
      <td><span class="status status-${escapeHtml(record.status)}">${escapeHtml(record.status.replaceAll("_", " "))}</span></td>
      <td>${Number(record.usage.inputTokens).toLocaleString()} in<br>${Number(record.usage.outputTokens).toLocaleString()} out</td>
      <td>${escapeHtml(record.citations.map((citation) => citation.label).join(", ") || "—")}</td>
      <td><button class="danger" type="button" data-delete-usage="${escapeHtml(record.id)}">Delete</button></td>
    </tr>`).join("") : `<tr><td colspan="8" class="muted">No questions match these filters.</td></tr>`;
  state.usagePages = data.pagination.pageCount;
  $("#usage-page").textContent = `Page ${data.pagination.page} of ${data.pagination.pageCount} · ${data.pagination.total} rows`;
  $("#usage-prev").disabled = data.pagination.page <= 1;
  $("#usage-next").disabled = data.pagination.page >= data.pagination.pageCount;
}

function grantFields(user) {
  return state.courses.map((course) => `
    <fieldset data-course="${escapeHtml(course.id)}">
      <legend>${escapeHtml(course.title)}</legend>
      <label><input type="checkbox" class="select-course"> Select all modules</label>
      ${course.modules.map((module) => `
        <label><input type="checkbox" name="grant" value="${escapeHtml(module.id)}" ${user.grants.includes(module.id) ? "checked" : ""}> ${escapeHtml(module.title)}</label>
      `).join("")}
    </fieldset>
  `).join("");
}

function roleLabel(role) {
  if (role === "owner") return "Owner";
  if (role === "admin") return "Administrator";
  return "Delegate";
}

function roleOptions(selected) {
  const roles = state.actorRole === "owner" ? ["delegate", "admin", "owner"] : ["delegate"];
  return roles.map((role) =>
    `<option value="${role}" ${selected === role ? "selected" : ""}>${roleLabel(role)}</option>`
  ).join("");
}

function renderUsers() {
  $("#user-rows").innerHTML = state.users.map((user) => {
    const editable = state.actorRole === "owner" || user.role === "delegate";
    const fullAccess = user.role === "owner" || user.role === "admin";
    return `
      <tr>
        <td>${escapeHtml(user.name)}</td>
        <td>${escapeHtml(user.email)}</td>
        <td>${roleLabel(user.role)}</td>
        <td>${user.active ? "Active" : "Inactive"}</td>
        <td>${escapeHtml(formatDate(user.lastLoginAt))}</td>
        <td>${fullAccess ? "All modules" : `${user.grants.length} module${user.grants.length === 1 ? "" : "s"}`}</td>
        <td>${editable ? `<button type="button" data-edit-user="${escapeHtml(user.id)}">Edit</button>` : `<span class="muted">Owner only</span>`}</td>
      </tr>
      ${editable ? `
        <tr class="edit-row" data-editor="${escapeHtml(user.id)}" hidden>
          <td colspan="7">
            <form class="edit-panel" data-user-form="${escapeHtml(user.id)}">
              <div class="edit-basics">
                <label>Name <input name="name" value="${escapeHtml(user.name)}" required></label>
                <label>Role <select name="role">${roleOptions(user.role)}</select></label>
                <label><span>Account</span><span><input name="active" type="checkbox" ${user.active ? "checked" : ""}> Active</span></label>
              </div>
              <div class="course-grants">${grantFields(user)}</div>
              <div class="editor-actions"><button class="primary" type="submit">Save</button><button type="button" data-close-editor>Cancel</button></div>
            </form>
          </td>
        </tr>` : ""}
    `;
  }).join("");
}

async function loadUsers() {
  const data = await api("/api/admin/users");
  state.users = data.users;
  state.courses = data.courses;
  renderUsers();
  const select = $("#knowledge-form select[name='courseId']");
  select.innerHTML = `<option value="">Choose course</option>${state.courses.map((course) =>
    `<option value="${escapeHtml(course.id)}">${escapeHtml(course.title)}</option>`
  ).join("")}`;
}

async function loadKnowledge(schedule = true) {
  window.clearTimeout(state.knowledgeTimer);
  const data = await api("/api/admin/knowledge");
  if (!state.courses.length) state.courses = data.courses;
  $("#knowledge-rows").innerHTML = data.sources.length ? data.sources.map((source) => `
    <tr>
      <td>${escapeHtml(source.title)}<span class="filename">${escapeHtml(source.originalFilename)}</span></td>
      <td>${escapeHtml(courseName(source.courseId))}</td>
      <td>${escapeHtml(formatBytes(source.bytes))}</td>
      <td>${escapeHtml(source.uploadedBy.name)}<span class="filename">${escapeHtml(source.uploadedBy.email)}</span></td>
      <td>${escapeHtml(formatDate(source.createdAt))}</td>
      <td><span class="status status-${escapeHtml(source.status)}">${escapeHtml(source.status)}</span>${source.error ? `<span class="error-detail">${escapeHtml(source.error)}</span>` : ""}</td>
      <td>
        ${source.status === "failed" && source.failureOperation !== "delete" ? `<button type="button" data-retry-source="${escapeHtml(source.id)}">Retry</button>` : ""}
        <button class="danger" type="button" data-delete-source="${escapeHtml(source.id)}">Delete</button>
      </td>
    </tr>`).join("") : `<tr><td colspan="7" class="muted">No private knowledge sources uploaded.</td></tr>`;
  if (schedule && data.sources.some(({ status }) => status === "queued" || status === "indexing" || status === "deleting")) {
    state.knowledgeTimer = window.setTimeout(() => loadKnowledge(true).catch((error) => setStatus(error.message)), 3000);
  }
}

$$("[data-section]").forEach((button) => {
  button.addEventListener("click", () => {
    $$("[data-section]").forEach((item) => item.classList.toggle("active", item === button));
    $$(".admin-section").forEach((section) => section.classList.toggle("active", section.id === `section-${button.dataset.section}`));
    if (button.dataset.section === "knowledge") loadKnowledge().catch((error) => setStatus(error.message));
  });
});

$("#usage-filters").addEventListener("submit", (event) => {
  event.preventDefault();
  state.usagePage = 1;
  loadUsage().catch((error) => setStatus(error.message));
});
$("#usage-prev").addEventListener("click", () => { state.usagePage -= 1; loadUsage().catch((error) => setStatus(error.message)); });
$("#usage-next").addEventListener("click", () => { state.usagePage += 1; loadUsage().catch((error) => setStatus(error.message)); });
$("#usage-rows").addEventListener("click", async (event) => {
  const button = event.target.closest("[data-delete-usage]");
  if (!button || !confirm("Delete this stored question record?")) return;
  try {
    await api(`/api/admin/usage?id=${encodeURIComponent(button.dataset.deleteUsage)}`, { method: "DELETE" });
    await loadUsage();
    setStatus("Question record deleted.");
  } catch (error) {
    setStatus(error.message);
  }
});

$("#add-user-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    const form = new FormData(event.currentTarget);
    await api("/api/admin/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(Object.fromEntries(form))
    });
    event.currentTarget.reset();
    await loadUsers();
    setStatus("User added.");
  } catch (error) {
    setStatus(error.message);
  }
});

$("#user-rows").addEventListener("click", (event) => {
  const edit = event.target.closest("[data-edit-user]");
  if (edit) {
    const row = $(`[data-editor="${CSS.escape(edit.dataset.editUser)}"]`);
    row.hidden = !row.hidden;
  }
  if (event.target.closest("[data-close-editor]")) event.target.closest(".edit-row").hidden = true;
  const selectAll = event.target.closest(".select-course");
  if (selectAll) {
    $$("input[name='grant']", selectAll.closest("fieldset")).forEach((checkbox) => { checkbox.checked = selectAll.checked; });
  }
});

$("#user-rows").addEventListener("submit", async (event) => {
  const form = event.target.closest("[data-user-form]");
  if (!form) return;
  event.preventDefault();
  try {
    const data = new FormData(form);
    await api("/api/admin/users", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: form.dataset.userForm,
        name: data.get("name"),
        role: data.get("role"),
        active: data.has("active"),
        grants: data.getAll("grant")
      })
    });
    await loadUsers();
    setStatus("User access updated.");
  } catch (error) {
    setStatus(error.message);
  }
});

const fileInput = $("#knowledge-form input[name='file']");
const titleInput = $("#knowledge-form input[name='title']");
fileInput.addEventListener("change", () => {
  if (fileInput.files[0]) titleInput.value = fileInput.files[0].name;
});
$("#knowledge-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = $("button[type='submit']", event.currentTarget);
  button.disabled = true;
  try {
    await api("/api/admin/knowledge", { method: "POST", body: new FormData(event.currentTarget) });
    event.currentTarget.reset();
    await loadKnowledge();
    setStatus("Source uploaded and queued for indexing.");
  } catch (error) {
    setStatus(error.message);
  } finally {
    button.disabled = false;
  }
});

$("#knowledge-rows").addEventListener("click", async (event) => {
  const retry = event.target.closest("[data-retry-source]");
  const remove = event.target.closest("[data-delete-source]");
  try {
    if (retry) {
      await api(`/api/admin/knowledge/${encodeURIComponent(retry.dataset.retrySource)}/retry`, { method: "POST" });
      setStatus("Source queued for retry.");
    }
    if (remove) {
      if (!confirm("Delete this source from private storage and Ask Dr Hassan?")) return;
      await api(`/api/admin/knowledge?id=${encodeURIComponent(remove.dataset.deleteSource)}`, { method: "DELETE" });
      setStatus("Source deleted.");
    }
    await loadKnowledge();
  } catch (error) {
    setStatus(error.message);
  }
});
$("#refresh-knowledge").addEventListener("click", () => loadKnowledge().catch((error) => setStatus(error.message)));
$("#logout-button").addEventListener("click", async () => {
  await fetch("/api/auth/logout", { method: "POST" });
  location.assign("/");
});

try {
  const me = await api("/api/me");
  if (me.user.role !== "admin" && me.user.role !== "owner") location.assign("baird_implant_portal.html");
  state.actorRole = me.user.role;
  $("#account-name").textContent = me.user.name;
  $("#new-user-role").innerHTML = roleOptions("delegate");
  await Promise.all([loadUsers(), loadUsage()]);
} catch (error) {
  setStatus(error.message);
}
