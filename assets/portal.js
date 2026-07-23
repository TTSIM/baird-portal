const byId = (id) => document.getElementById(id);
const moduleList = byId("module-list");
let coursesById = new Map();

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function resourceLink(resource) {
  const link = element("a", "resource-link");
  link.href = resource.file;
  link.target = "_blank";
  link.rel = "noopener";
  const type = element("span", "resource-type", resource.type);
  const text = element("span", "resource-text");
  text.append(element("span", "resource-label", resource.label));
  if (resource.summary) text.append(element("span", "resource-summary", resource.summary));
  link.append(type, text);
  return link;
}

function renderLecture(lecture) {
  const card = element("article", "lecture-card");
  card.append(
    element("div", "lecture-title", lecture.title),
    element("p", "lecture-copy", lecture.copy)
  );
  const resources = element("div", "resource-list");
  for (const resource of lecture.materials || []) resources.append(resourceLink(resource));
  card.append(resources);
  return card;
}

function renderDay(day) {
  const card = element("article", "day-card");
  const toggle = element("button", "day-toggle");
  toggle.type = "button";
  toggle.setAttribute("aria-expanded", "false");
  const heading = element("span");
  heading.append(element("span", "day-title", day.title), element("span", "day-copy", day.copy));
  toggle.append(heading, element("span", "day-icon", "+"));
  const content = element("div", "day-content");
  const lectures = element("div", "lecture-list");
  for (const lecture of day.lectures || []) lectures.append(renderLecture(lecture));
  content.append(lectures);
  toggle.addEventListener("click", () => {
    const open = card.classList.toggle("open");
    toggle.setAttribute("aria-expanded", String(open));
  });
  card.append(toggle, content);
  return card;
}

function renderModule(module, index) {
  const card = element("article", `module-card${module.locked ? " locked" : ""}`);
  const header = element(module.locked ? "div" : "button", "module-header");
  if (!module.locked) {
    header.type = "button";
    header.setAttribute("aria-expanded", "false");
  }
  const copy = element("div");
  copy.append(
    element("div", "module-index", coursesById.get(module.courseId)?.title || module.typeLabel || `Module ${index + 1}`),
    element("h3", "", module.title)
  );
  if (!module.locked && module.topics) copy.append(element("p", "module-topics", module.topics));
  const meta = element("div");
  meta.append(module.locked
    ? element("span", "lock-label", "Locked")
    : element("span", "module-date", module.date || ""));
  if (!module.locked) meta.append(element("span", "module-icon", "+"));
  header.append(copy, meta);
  card.append(header);

  if (!module.locked) {
    const content = element("div", "module-content");
    const days = element("div", "day-list");
    for (const day of module.days || []) days.append(renderDay(day));
    content.append(days);
    card.append(content);
    header.addEventListener("click", () => {
      const open = card.classList.toggle("open");
      header.setAttribute("aria-expanded", String(open));
    });
  }
  return card;
}

function renderPortal({ user, portal, features = {} }) {
  coursesById = new Map(portal.courses.map((course) => [course.id, course]));
  byId("course-title").textContent = portal.program.title;
  byId("course-subtitle").textContent = portal.program.subtitle;
  byId("hero-meta").replaceChildren(...portal.program.details.flat().map((text) => element("span", "pill", text)));
  byId("stat-modules").textContent = portal.stats.modules;
  byId("stat-faculty").textContent = portal.stats.faculty;
  byId("stat-materials").textContent = portal.stats.materials;
  byId("stat-running").textContent = portal.stats.yearsRunning;
  byId("faculty-list").replaceChildren(...portal.program.faculty.map((name) => element("li", "", name)));
  moduleList.replaceChildren(...portal.modules.map(renderModule));
  byId("account-name").textContent = user.name;
  const staff = user.role === "admin" || user.role === "owner";
  byId("admin-link").hidden = !staff;
  byId("tab-button-community").hidden = !features.community;
  byId("community-notification-button").hidden = !features.community;
  const canAsk = staff || user.grants.length > 0;
  byId("ask-dr-hassan-link").setAttribute("aria-disabled", String(!canAsk));
  if (!canAsk) byId("ask-dr-hassan-link").title = "A module must be unlocked first";
  document.dispatchEvent(new CustomEvent("baird:portal-ready", {
    detail: { user, portal, features }
  }));
  const requestedTab = new URLSearchParams(location.search).get("tab");
  const requestedButton = requestedTab ? document.querySelector(`[data-tab="${CSS.escape(requestedTab)}"]`) : null;
  if (requestedButton && !requestedButton.hidden) requestedButton.click();
}

document.querySelectorAll("[data-tab]").forEach((button) => {
  button.addEventListener("click", () => {
    document.querySelectorAll("[data-tab]").forEach((item) => {
      const selected = item === button;
      item.classList.toggle("active", selected);
      item.setAttribute("aria-selected", String(selected));
    });
    document.querySelectorAll(".tab-panel").forEach((panel) => {
      panel.classList.toggle("active", panel.id === `tab-${button.dataset.tab}`);
    });
    const url = new URL(location.href);
    if (button.dataset.tab === "modules") url.searchParams.delete("tab");
    else url.searchParams.set("tab", button.dataset.tab);
    if (button.dataset.tab !== "community") url.searchParams.delete("thread");
    history.replaceState({}, "", url);
  });
});

byId("logout-button").addEventListener("click", async () => {
  await fetch("/api/auth/logout", { method: "POST" });
  location.assign("/");
});

try {
  const response = await fetch("/api/me", { headers: { Accept: "application/json" } });
  if (response.status === 401) {
    location.assign(`/?next=${encodeURIComponent(location.pathname)}`);
  } else if (!response.ok) {
    throw new Error("The portal could not be loaded.");
  } else {
    renderPortal(await response.json());
  }
} catch (error) {
  moduleList.replaceChildren(element("p", "section-note", error instanceof Error ? error.message : "The portal could not be loaded."));
}
