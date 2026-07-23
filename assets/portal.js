const byId = (id) => document.getElementById(id);
const state = {
  user: null,
  portal: null,
  features: {},
  courses: new Map(),
  currentCourseId: "",
  facultyQuery: "",
  facultyCourseId: ""
};

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function initials(name) {
  const parts = String(name || "BAIRD")
    .replace(/^(Dr|Prof|Mr|Ms|Mrs)\s+/i, "")
    .trim()
    .split(/\s+/);
  return `${parts[0]?.[0] || "B"}${parts.length > 1 ? parts.at(-1)[0] : ""}`.toUpperCase();
}

function firstName(name) {
  return String(name || "delegate")
    .replace(/^(Dr|Prof|Mr|Ms|Mrs)\s+/i, "")
    .trim()
    .split(/\s+/)[0] || "delegate";
}

function courseMark(course) {
  return String(course.shortTitle || course.title)
    .split(/\s+/)
    .filter((word) => !["and", "&", "in", "the", "for"].includes(word.toLowerCase()))
    .slice(0, 2)
    .map((word) => word[0])
    .join("")
    .toUpperCase();
}

function courseItemCount(course) {
  if (!course.totalItems) return "Portal content coming soon";
  const label = course.totalItems === 1 ? course.contentLabels.singular : course.contentLabels.plural;
  return `${course.availableItems} of ${course.totalItems} ${label.toLowerCase()} available`;
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
  card.append(element("h5", "", lecture.title), element("p", "", lecture.copy));
  if (lecture.materials?.length) {
    const resources = element("div", "resource-list");
    for (const resource of lecture.materials) resources.append(resourceLink(resource));
    card.append(resources);
  }
  return card;
}

function renderDay(day) {
  const details = element("details", "day-card");
  const summary = element("summary");
  const copy = element("div");
  copy.append(element("h4", "", day.title), element("p", "", day.copy));
  summary.append(copy);
  const lectures = element("div", "lecture-list");
  for (const lecture of day.lectures || []) lectures.append(renderLecture(lecture));
  details.append(summary, lectures);
  return details;
}

function renderCurriculumItem(module, index, course) {
  if (module.locked) {
    const card = element("article", "curriculum-item curriculum-item--locked");
    const copy = element("div");
    copy.append(
      element("div", "curriculum-item__index", course.contentLabels.singular),
      element("h3", "", module.title)
    );
    if (module.topics) copy.append(element("p", "curriculum-item__topics", module.topics));
    const meta = element("div", "curriculum-item__date", module.date || "");
    meta.append(element("span", "curriculum-item__state", "Locked"));
    card.append(copy, meta);
    return card;
  }

  const details = element("details", "curriculum-item");
  const summary = element("summary");
  const copy = element("div");
  copy.append(
    element("div", "curriculum-item__index", `${course.contentLabels.singular} ${String(index + 1).padStart(2, "0")}`),
    element("h3", "", module.title)
  );
  if (module.topics) copy.append(element("p", "curriculum-item__topics", module.topics));
  const meta = element("div", "curriculum-item__date", module.date || "");
  meta.append(element("span", "curriculum-item__state", "Available"));
  summary.append(copy, meta);
  const content = element("div", "curriculum-item__content");
  const days = element("div", "day-list");
  for (const day of module.days || []) days.append(renderDay(day));
  if (days.childElementCount) content.append(days);
  else content.append(element("p", "curriculum-item__topics", "Materials for this item will appear here when they are available."));
  details.append(summary, content);
  return details;
}

function facultyAvatar(member) {
  const avatar = element("div", "faculty-avatar", initials(member.name));
  if (member.image) {
    const image = new Image();
    image.src = member.image;
    image.alt = "";
    image.addEventListener("error", () => {
      avatar.replaceChildren(document.createTextNode(initials(member.name)));
    });
    avatar.replaceChildren(image);
  }
  return avatar;
}

function facultyCard(member, compact = false) {
  const card = element("article", `faculty-card${compact ? " compact" : ""}`);
  const copy = element("div");
  copy.append(
    element("h3", "", member.name),
    element("p", "faculty-role", member.role)
  );
  if (member.bio) copy.append(element("p", "faculty-bio", member.bio));
  const courses = member.courseIds
    .map((id) => state.courses.get(id)?.shortTitle || state.courses.get(id)?.title)
    .filter(Boolean);
  if (!compact && courses.length) copy.append(element("p", "faculty-courses", courses.join(", ")));
  card.append(facultyAvatar(member), copy);
  return card;
}

function courseCard(course) {
  const card = element("button", "course-card");
  card.type = "button";
  card.addEventListener("click", () => openCourse(course.id));

  const visual = element("div", "course-card__visual");
  if (course.coverImage) {
    const image = new Image();
    image.src = course.coverImage;
    image.alt = "";
    visual.append(image);
  }
  visual.append(element("span", "course-card__mark", courseMark(course)));

  const body = element("div", "course-card__body");
  const meta = element("div", "course-card__meta");
  if (course.intake) meta.append(element("span", "", course.intake));
  meta.append(element("span", "", courseItemCount(course)));
  body.append(meta, element("h3", "", course.title));
  if (course.summary) body.append(element("p", "", course.summary));
  body.append(element("span", "course-card__open", `Open ${course.shortTitle}`));
  card.append(visual, body);
  return card;
}

function catalogueCard(course) {
  const card = element("article", "catalogue-card");
  const top = element("div");
  const meta = element("div", "catalogue-card__meta");
  meta.append(element("span", "", course.statusLabel));
  top.append(meta, element("h3", "", course.title));
  top.append(element("p", "", course.totalItems
    ? "Learning content is available to delegates enrolled on this course."
    : "Portal content coming soon."));

  const actions = element("div", "catalogue-card__actions");
  const view = element("button", "", "View course");
  view.type = "button";
  view.addEventListener("click", () => openCourse(course.id));
  const source = element("a", "", "Course information");
  source.href = course.sourceUrl;
  source.target = "_blank";
  source.rel = "noopener";
  actions.append(view, source);
  card.append(top, actions);
  return card;
}

function renderLearningHome() {
  const enrolled = state.portal.courses.filter((course) => course.enrolled);
  const catalogue = state.portal.courses.filter((course) => !course.enrolled);
  byId("welcome-name").textContent = firstName(state.user.name);

  const stats = byId("learning-stats");
  stats.replaceChildren();
  const statValues = [
    ["Courses", String(state.portal.stats.enrolledCourses)],
    ["Materials", String(state.portal.stats.materials)],
    ["Academy", `${state.portal.stats.yearsRunning} years`]
  ];
  for (const [label, value] of statValues) {
    const row = element("div");
    row.append(element("dt", "", label), element("dd", "", value));
    stats.append(row);
  }

  const library = byId("course-library");
  library.classList.remove("loading-grid");
  if (enrolled.length) {
    library.replaceChildren(...enrolled.map(courseCard));
  } else {
    const empty = element("div", "empty-learning");
    empty.append(
      element("h3", "", "Your course access is being prepared"),
      element("p", "", "When a BAIRD administrator assigns your course, it will appear here with its available learning materials.")
    );
    library.replaceChildren(empty);
  }
  byId("course-catalogue").replaceChildren(...catalogue.map(catalogueCard));
}

function renderCourseFaculty(course) {
  const members = course.facultyIds
    .map((id) => state.portal.faculty.find((member) => member.id === id))
    .filter(Boolean);
  const section = element("section", "course-faculty-section");
  section.append(element("h2", "", "Course faculty"));
  if (!members.length) {
    section.append(element("p", "curriculum-item__topics", "Faculty details will appear here when they are confirmed."));
    return section;
  }
  const grid = element("div", "course-faculty-grid");
  grid.append(...members.map((member) => facultyCard(member, true)));
  section.append(grid);
  return section;
}

function renderCourseDetail(course) {
  const root = byId("course-detail");
  root.replaceChildren();

  const hero = element("section", "course-hero");
  const copy = element("div", "course-hero__copy");
  const meta = element("div", "course-hero__meta");
  meta.append(element("span", "", course.statusLabel));
  if (course.intake) meta.append(element("span", "", course.intake));
  copy.append(meta, element("h1", "", course.title));
  if (course.summary) copy.append(element("p", "", course.summary));

  const visual = element("div", "course-hero__visual");
  if (course.coverImage) {
    const image = new Image();
    image.src = course.coverImage;
    image.alt = "";
    visual.append(image);
  }
  visual.append(element("span", "course-hero__visual-mark", courseMark(course)));
  hero.append(copy, visual);
  root.append(hero);

  if (course.details?.length) {
    const facts = element("dl", "course-facts");
    for (const [label, value] of course.details) {
      const fact = element("div");
      fact.append(element("dt", "", label), element("dd", "", value));
      facts.append(fact);
    }
    root.append(facts);
  }

  if (!course.enrolled) {
    const empty = element("section", "course-empty-state");
    empty.append(
      element("h2", "", course.totalItems ? "Course access is not assigned" : "Portal content coming soon"),
      element("p", "", course.totalItems
        ? "This course has learning content, but it is not currently included in your BAIRD account."
        : "This course is part of the BAIRD catalogue. Learning materials will appear here when they are ready.")
    );
    const source = element("a", "", "View course information");
    source.href = course.sourceUrl;
    source.target = "_blank";
    source.rel = "noopener";
    empty.append(source);
    root.append(empty);
    if (course.facultyIds.length) root.append(renderCourseFaculty(course));
    return;
  }

  const curriculum = element("section", "curriculum-section");
  const heading = element("div", "curriculum-heading");
  heading.append(
    element("h2", "", course.contentLabels.plural),
    element("p", "", `Your ${course.contentLabels.plural.toLowerCase()} and available learning materials.`)
  );
  const list = element("div", "curriculum-list");
  const modules = state.portal.modules.filter((module) => module.courseId === course.id);
  list.append(...modules.map((module, index) => renderCurriculumItem(module, index, course)));
  curriculum.append(heading, list);
  root.append(curriculum, renderCourseFaculty(course));
}

function openCourse(courseId, historyMode = "push") {
  const course = state.courses.get(courseId);
  if (!course) return;
  state.currentCourseId = courseId;
  renderCourseDetail(course);
  setVisibleView("course");
  const url = new URL(location.href);
  url.searchParams.set("course", courseId);
  url.searchParams.delete("view");
  url.searchParams.delete("tab");
  history[`${historyMode}State`]({}, "", url);
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function setVisibleView(view) {
  document.querySelectorAll("[data-portal-view]").forEach((panel) => {
    const active = panel.dataset.portalView === view;
    panel.hidden = !active;
    panel.classList.toggle("active", active);
  });
  document.querySelectorAll("[data-portal-view-target]").forEach((button) => {
    const active = button.dataset.portalViewTarget === view || (view === "course" && button.dataset.portalViewTarget === "courses");
    button.classList.toggle("active", active);
    if (active) button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
  });
}

function showPortalView(view, historyMode = "push") {
  const allowed = ["courses", "faculty", "community"];
  const requested = allowed.includes(view) ? view : "courses";
  if (requested === "community" && !state.features.community) return;
  state.currentCourseId = "";
  setVisibleView(requested);
  const url = new URL(location.href);
  url.searchParams.delete("course");
  url.searchParams.delete("tab");
  if (requested === "courses") url.searchParams.delete("view");
  else url.searchParams.set("view", requested);
  if (requested !== "community") url.searchParams.delete("thread");
  history[`${historyMode}State`]({}, "", url);
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function renderFacultyDirectory() {
  const query = state.facultyQuery.trim().toLowerCase();
  const members = state.portal.faculty.filter((member) => {
    if (state.facultyCourseId && !member.courseIds.includes(state.facultyCourseId)) return false;
    if (!query) return true;
    return [member.name, member.role, member.bio].some((value) => value.toLowerCase().includes(query));
  });
  byId("faculty-result-count").textContent = `${members.length} faculty member${members.length === 1 ? "" : "s"}`;
  byId("faculty-directory").replaceChildren(...members.map((member) => facultyCard(member)));
}

function renderFacultyFilters() {
  const select = byId("faculty-course-filter");
  const options = state.portal.courses
    .filter((course) => course.facultyIds.length)
    .map((course) => {
      const option = element("option", "", course.shortTitle || course.title);
      option.value = course.id;
      return option;
    });
  select.append(...options);
  renderFacultyDirectory();
}

function applyInitialRoute() {
  const params = new URLSearchParams(location.search);
  const courseId = params.get("course");
  if (courseId && state.courses.has(courseId)) {
    openCourse(courseId, "replace");
    return;
  }
  const legacy = { modules: "courses", faculty: "faculty", community: "community" }[params.get("tab")];
  showPortalView(params.get("view") || legacy || "courses", "replace");
}

function renderPortal({ user, portal, features = {} }) {
  state.user = user;
  state.portal = portal;
  state.features = features;
  state.courses = new Map(portal.courses.map((course) => [course.id, course]));
  byId("account-name").textContent = user.name;
  const staff = user.role === "admin" || user.role === "owner";
  byId("admin-link").hidden = !staff;
  byId("tab-button-community").hidden = !features.community;
  byId("community-notification-button").hidden = !features.community;
  const canAsk = staff || portal.courses.some((course) => course.enrolled);
  byId("ask-dr-hassan-link").setAttribute("aria-disabled", String(!canAsk));
  if (!canAsk) byId("ask-dr-hassan-link").title = "A course must be unlocked first";
  renderLearningHome();
  renderFacultyFilters();
  applyInitialRoute();
  document.dispatchEvent(new CustomEvent("baird:portal-ready", {
    detail: { user, portal, features }
  }));
}

document.querySelectorAll("[data-portal-view-target]").forEach((button) => {
  button.addEventListener("click", () => showPortalView(button.dataset.portalViewTarget));
});

byId("course-back").addEventListener("click", () => showPortalView("courses"));
byId("faculty-search").addEventListener("input", (event) => {
  state.facultyQuery = event.target.value;
  renderFacultyDirectory();
});
byId("faculty-course-filter").addEventListener("change", (event) => {
  state.facultyCourseId = event.target.value;
  renderFacultyDirectory();
});
byId("logout-button").addEventListener("click", async () => {
  await fetch("/api/auth/logout", { method: "POST" });
  location.assign("/");
});

window.addEventListener("popstate", () => {
  if (!state.portal) return;
  const params = new URLSearchParams(location.search);
  const courseId = params.get("course");
  if (courseId && state.courses.has(courseId)) {
    state.currentCourseId = courseId;
    renderCourseDetail(state.courses.get(courseId));
    setVisibleView("course");
    return;
  }
  const legacy = { modules: "courses", faculty: "faculty", community: "community" }[params.get("tab")];
  setVisibleView(params.get("view") || legacy || "courses");
});

try {
  const response = await fetch("/api/me", { headers: { Accept: "application/json" } });
  if (response.status === 401) {
    location.assign(`/?next=${encodeURIComponent(location.pathname + location.search)}`);
  } else if (!response.ok) {
    throw new Error("The portal could not be loaded.");
  } else {
    renderPortal(await response.json());
  }
} catch (error) {
  const library = byId("course-library");
  const empty = element("div", "empty-learning");
  empty.append(
    element("h3", "", "The portal could not be loaded"),
    element("p", "", error instanceof Error ? error.message : "Please refresh the page and try again.")
  );
  library.replaceChildren(empty);
}
