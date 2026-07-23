const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const state = {
  user: null,
  portal: null,
  courses: new Map(),
  cursor: null,
  status: "latest",
  category: "all",
  courseId: "",
  thread: null,
  replyTarget: null,
  reportTarget: null
};

const feed = document.getElementById("community-feed");
const thread = document.getElementById("community-thread");
const globalStatus = document.getElementById("community-status");
const composeDialog = document.getElementById("community-compose-dialog");
const composeForm = document.getElementById("community-compose-form");
const composeStatus = document.getElementById("community-compose-status");
const reportDialog = document.getElementById("community-report-dialog");
const reportForm = document.getElementById("community-report-form");

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function initials(name) {
  return String(name || "BA").split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
}

function avatar(author, small = false) {
  const node = el("span", `community-avatar${small ? " small" : ""}`);
  if (author?.avatarUrl) {
    const image = new Image();
    image.src = author.avatarUrl;
    image.alt = "";
    image.addEventListener("error", () => {
      node.replaceChildren(document.createTextNode(initials(author.name)));
    });
    node.append(image);
  } else {
    node.textContent = initials(author?.name);
  }
  return node;
}

function formatDate(value) {
  return new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

function categoryLabel(value) {
  return { general: "General", "case-support": "Case support", "course-question": "Course question" }[value] || value;
}

async function api(url, options = {}) {
  const response = await fetch(url, { headers: { Accept: "application/json", ...(options.headers || {}) }, ...options });
  const body = response.status === 204 ? null : await response.json().catch(() => ({}));
  if (response.status === 401) location.assign(`/?next=${encodeURIComponent(location.pathname + location.search)}`);
  if (response.status === 428) location.assign(`profile-setup.html?next=${encodeURIComponent(location.pathname + location.search)}`);
  if (!response.ok) throw new Error(body?.error || "The request could not be completed.");
  return body;
}

function courseName(id) {
  return state.courses.get(id)?.title || id;
}

function authorLine(author, date, editedAt) {
  const row = el("div", "community-author-row");
  row.append(avatar(author, true));
  const name = el("strong", "", author?.name || "Former delegate");
  row.append(name, el("span", "", formatDate(date)));
  if (editedAt) row.append(el("span", "", "Edited"));
  if (author?.location) row.append(el("span", "", author.location));
  return row;
}

function reactionButtons(targetType, targetId, reactions) {
  const row = el("div", "community-reactions");
  const labels = { helpful: "Helpful", thanks: "Thanks", insightful: "Insightful" };
  for (const [kind, label] of Object.entries(labels)) {
    const value = reactions?.[kind] || { count: 0, reacted: false };
    const button = el("button", `community-reaction${value.reacted ? " active" : ""}`, `${label} ${value.count || ""}`.trim());
    button.type = "button";
    button.setAttribute("aria-pressed", String(Boolean(value.reacted)));
    button.addEventListener("click", async () => {
      button.disabled = true;
      try {
        const result = await api(`/api/community/reactions/${targetType}/${encodeURIComponent(targetId)}/${kind}`, {
          method: value.reacted ? "DELETE" : "PUT"
        });
        row.replaceWith(reactionButtons(targetType, targetId, result.reactions));
      } catch (error) {
        globalStatus.textContent = error.message;
        button.disabled = false;
      }
    });
    row.append(button);
  }
  return row;
}

function renderProfile() {
  const author = state.user.profile;
  const wrapper = document.getElementById("community-profile");
  const line = el("div", "community-profile-line");
  line.append(avatar(author));
  const copy = el("div", "community-profile-copy");
  copy.append(el("strong", "", author.name), el("span", "", author.location || "BAIRD delegate"));
  line.append(copy);
  wrapper.replaceChildren(line);
  if (author.completedCourseIds?.length) {
    const badges = el("div", "community-course-badges");
    for (const id of author.completedCourseIds) badges.append(el("span", "", courseName(id)));
    wrapper.append(badges);
  }
}

function renderFeedCard(post) {
  const card = el("article", "community-feed-card");
  card.tabIndex = 0;
  const content = el("div");
  content.append(authorLine(post.author, post.createdAt, post.editedAt));
  content.append(el("h3", "community-feed-title", post.title));
  const excerpt = post.body.length > 220 ? `${post.body.slice(0, 217)}...` : post.body;
  content.append(el("p", "community-feed-excerpt", excerpt));
  const meta = el("div", "community-feed-meta");
  meta.append(el("span", "community-tag", categoryLabel(post.category)));
  if (post.courseId) meta.append(el("span", "community-tag", courseName(post.courseId)));
  if (post.resolvedAt) meta.append(el("span", "community-resolved", "Resolved"));
  content.append(meta);
  const stats = el("div", "community-feed-stats");
  stats.append(el("span", "", `${post.replyCount} ${post.replyCount === 1 ? "reply" : "replies"}`));
  const totalReactions = Object.values(post.reactions || {}).reduce((sum, value) => sum + value.count, 0);
  stats.append(el("span", "", `${totalReactions} reactions`));
  card.append(content, stats);
  const open = () => openThread(post.id);
  card.addEventListener("click", open);
  card.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      open();
    }
  });
  return card;
}

async function loadFeed(append = false) {
  globalStatus.textContent = "Loading discussions…";
  const params = new URLSearchParams({ status: state.status });
  if (state.category !== "all") params.set("category", state.category);
  if (state.courseId) params.set("courseId", state.courseId);
  if (append && state.cursor) params.set("cursor", state.cursor);
  try {
    const data = await api(`/api/community/posts?${params}`);
    if (!append) feed.replaceChildren();
    for (const post of data.posts) feed.append(renderFeedCard(post));
    if (!feed.children.length) {
      const empty = el("div", "community-empty");
      empty.append(el("strong", "", "No discussions here yet"), el("span", "", "Start a question and invite the community in."));
      feed.append(empty);
    }
    state.cursor = data.nextCursor;
    document.getElementById("community-load-more").hidden = !state.cursor;
    globalStatus.textContent = "";
  } catch (error) {
    globalStatus.textContent = error.message;
  }
}

function threadTags(post) {
  const meta = el("div", "community-thread-meta");
  meta.append(el("span", "community-tag", categoryLabel(post.category)));
  if (post.courseId) meta.append(el("span", "community-tag", courseName(post.courseId)));
  if (post.resolvedAt) meta.append(el("span", "community-resolved", "Resolved"));
  if (post.lockedAt) meta.append(el("span", "community-tag", "Locked"));
  return meta;
}

function reportButton(targetType, targetId) {
  const button = el("button", "community-text-action", "Report");
  button.type = "button";
  button.addEventListener("click", () => {
    state.reportTarget = { targetType, targetId };
    reportForm.reset();
    document.getElementById("community-report-status").textContent = "";
    reportDialog.showModal();
  });
  return button;
}

function textAction(label, handler) {
  const button = el("button", "community-text-action", label);
  button.type = "button";
  button.addEventListener("click", handler);
  return button;
}

async function editPost(post) {
  const title = prompt("Edit discussion title", post.title);
  if (title === null) return;
  const body = prompt("Edit discussion details", post.body);
  if (body === null) return;
  try {
    const result = await api(`/api/community/posts/${encodeURIComponent(post.id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, body })
    });
    state.thread = result.post;
    renderThread();
  } catch (error) {
    globalStatus.textContent = error.message;
  }
}

async function deletePost(post) {
  if (!confirm("Delete this discussion? It will be hidden immediately and retained for 30 days.")) return;
  try {
    await api(`/api/community/posts/${encodeURIComponent(post.id)}`, { method: "DELETE" });
    closeThread();
    await loadFeed();
  } catch (error) {
    globalStatus.textContent = error.message;
  }
}

function gallery(attachments) {
  const node = el("div", "community-gallery");
  for (const attachment of attachments) {
    const link = document.createElement("a");
    link.href = attachment.imageUrl;
    link.target = "_blank";
    link.rel = "noopener";
    const image = new Image();
    image.src = attachment.thumbnailUrl;
    image.alt = attachment.altText;
    link.append(image);
    node.append(link);
  }
  return node;
}

async function acceptReply(replyId) {
  try {
    const result = await api(`/api/community/posts/${encodeURIComponent(state.thread.id)}/accepted-reply`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ replyId })
    });
    state.thread = result.post;
    renderThread();
  } catch (error) {
    globalStatus.textContent = error.message;
  }
}

async function editReply(reply) {
  const body = prompt("Edit reply", reply.body);
  if (body === null) return;
  try {
    const result = await api(`/api/community/replies/${encodeURIComponent(reply.id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body })
    });
    state.thread.replies = state.thread.replies.map((item) => item.id === reply.id ? result.reply : item);
    renderThread();
  } catch (error) {
    globalStatus.textContent = error.message;
  }
}

async function deleteReply(reply) {
  if (!confirm("Delete this reply? Its place in the thread will remain visible.")) return;
  try {
    await api(`/api/community/replies/${encodeURIComponent(reply.id)}`, { method: "DELETE" });
    await openThread(state.thread.id, false);
  } catch (error) {
    globalStatus.textContent = error.message;
  }
}

function renderReply(reply) {
  const node = el("article", `community-reply${state.thread.acceptedReplyId === reply.id ? " accepted" : ""}`);
  node.dataset.depth = String(reply.depth);
  const author = authorLine(reply.author, reply.createdAt, reply.editedAt);
  if (state.thread.acceptedReplyId === reply.id) author.append(el("span", "community-accepted-label", "Accepted answer"));
  node.append(author);
  node.append(reply.status === "active"
    ? el("p", "community-reply-body", reply.body)
    : el("p", "community-reply-body community-deleted-copy", "This reply has been removed."));
  if (reply.status === "active") {
    node.append(reactionButtons("reply", reply.id, reply.reactions));
    const actions = el("div", "community-reply-actions");
    if (!state.thread.lockedAt && reply.depth < 3) actions.append(textAction("Reply", () => {
      state.replyTarget = reply;
      renderThread();
      thread.querySelector("textarea")?.focus();
    }));
    const canAccept = state.thread.author?.id === state.user.id || state.user.role !== "delegate";
    if (canAccept && state.thread.acceptedReplyId !== reply.id) actions.append(textAction("Accept answer", () => acceptReply(reply.id)));
    if (reply.canEdit) actions.append(textAction("Edit", () => editReply(reply)), textAction("Delete", () => deleteReply(reply)));
    if (reply.author?.id !== state.user.id) actions.append(reportButton("reply", reply.id));
    node.append(actions);
  }
  return node;
}

function renderThread() {
  const post = state.thread;
  thread.replaceChildren();
  const header = el("header", "community-thread-header");
  header.append(authorLine(post.author, post.createdAt, post.editedAt), el("h2", "", post.title), threadTags(post));
  header.append(el("p", "community-thread-body", post.body));
  if (post.attachments?.length) header.append(gallery(post.attachments));
  header.append(reactionButtons("post", post.id, post.reactions));
  const actions = el("div", "community-thread-actions");
  if (post.canEdit) actions.append(textAction("Edit", () => editPost(post)), textAction("Delete", () => deletePost(post)));
  if (post.author?.id !== state.user.id) actions.append(reportButton("post", post.id));
  const canManageAnswer = post.author?.id === state.user.id || state.user.role !== "delegate";
  if (canManageAnswer && post.acceptedReplyId) actions.append(textAction("Reopen discussion", () => acceptReply(null)));
  header.append(actions);
  thread.append(header);

  const replies = el("section", "community-replies");
  replies.append(el("h3", "", `${post.replyCount} ${post.replyCount === 1 ? "reply" : "replies"}`));
  for (const reply of post.replies || []) replies.append(renderReply(reply));
  thread.append(replies);

  if (!post.lockedAt && post.status === "active") {
    const composer = el("form", "community-reply-composer");
    const target = el("p", "community-reply-target", state.replyTarget ? `Replying to ${state.replyTarget.author?.name || "this delegate"}` : "");
    const textarea = document.createElement("textarea");
    textarea.name = "body";
    textarea.maxLength = 3000;
    textarea.required = true;
    textarea.placeholder = "Add a clear, constructive reply";
    const actionRow = el("div", "community-dialog-actions");
    if (state.replyTarget) actionRow.append(textAction("Cancel nested reply", () => {
      state.replyTarget = null;
      renderThread();
    }));
    const submit = el("button", "community-primary", "Publish reply");
    submit.type = "submit";
    actionRow.append(submit);
    composer.append(target, textarea, actionRow);
    composer.addEventListener("submit", async (event) => {
      event.preventDefault();
      submit.disabled = true;
      try {
        const result = await api(`/api/community/posts/${encodeURIComponent(post.id)}/replies`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ body: textarea.value, parentReplyId: state.replyTarget?.id })
        });
        state.thread = result.post;
        state.replyTarget = null;
        renderThread();
      } catch (error) {
        globalStatus.textContent = error.message;
        submit.disabled = false;
      }
    });
    thread.append(composer);
  }
}

async function openThread(id, pushUrl = true) {
  globalStatus.textContent = "Loading discussion…";
  try {
    const data = await api(`/api/community/posts/${encodeURIComponent(id)}`);
    state.thread = data.post;
    state.replyTarget = null;
    feed.hidden = true;
    document.getElementById("community-load-more").hidden = true;
    thread.hidden = false;
    document.getElementById("community-back").hidden = false;
    renderThread();
    if (pushUrl) {
      const url = new URL(location.href);
      url.searchParams.set("tab", "community");
      url.searchParams.set("thread", id);
      history.pushState({}, "", url);
    }
    globalStatus.textContent = "";
  } catch (error) {
    globalStatus.textContent = error.message;
  }
}

function closeThread(pushUrl = true) {
  state.thread = null;
  state.replyTarget = null;
  thread.hidden = true;
  feed.hidden = false;
  document.getElementById("community-back").hidden = true;
  document.getElementById("community-load-more").hidden = !state.cursor;
  if (pushUrl) {
    const url = new URL(location.href);
    url.searchParams.delete("thread");
    history.pushState({}, "", url);
  }
}

function reviewImages() {
  const review = document.getElementById("community-image-review");
  review.replaceChildren();
  const files = [...(composeForm.elements.images.files || [])].slice(0, 4);
  for (const [index, file] of files.entries()) {
    const card = el("article");
    const image = new Image();
    image.src = URL.createObjectURL(file);
    image.alt = "";
    image.addEventListener("load", () => URL.revokeObjectURL(image.src), { once: true });
    const label = el("label", "", `Image ${index + 1} description`);
    const input = document.createElement("input");
    input.name = `altText-${index}`;
    input.maxLength = 300;
    input.required = true;
    input.placeholder = "Describe what the image shows";
    label.append(input);
    card.append(image, label);
    review.append(card);
  }
}

async function uploadImage(file) {
  if (file.size > MAX_IMAGE_BYTES) throw new Error(`${file.name} is larger than 10 MB.`);
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) throw new Error(`${file.name} is not a supported image.`);
  const created = await api("/api/community/uploads", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ filename: file.name, mimeType: file.type, size: file.size, purpose: "post" })
  });
  for (let index = 0; index < created.upload.expectedChunks; index += 1) {
    const start = index * created.upload.chunkBytes;
    await api(`/api/community/uploads/${encodeURIComponent(created.upload.id)}/chunks/${index}`, {
      method: "PUT",
      headers: { "Content-Type": "application/octet-stream" },
      body: file.slice(start, Math.min(file.size, start + created.upload.chunkBytes))
    });
  }
  return await api(`/api/community/uploads/${encodeURIComponent(created.upload.id)}/finalize`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}"
  });
}

async function publishPost() {
  const submit = composeForm.querySelector("[data-submit-post]");
  submit.disabled = true;
  composeStatus.textContent = "Preparing discussion…";
  try {
    const data = new FormData(composeForm);
    const files = [...(composeForm.elements.images.files || [])];
    if (files.length > 4) throw new Error("Attach no more than four images.");
    const uploaded = [];
    for (const [index, file] of files.entries()) {
      composeStatus.textContent = `Uploading image ${index + 1} of ${files.length}…`;
      const result = await uploadImage(file);
      uploaded.push({ id: result.attachment.id, altText: data.get(`altText-${index}`) });
    }
    composeStatus.textContent = "Publishing discussion…";
    const result = await api("/api/community/posts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: data.get("title"),
        body: data.get("body"),
        category: data.get("category"),
        courseId: data.get("courseId"),
        caseAttestation: data.has("caseAttestation"),
        attachments: uploaded
      })
    });
    composeDialog.close();
    composeForm.reset();
    document.getElementById("community-image-review").replaceChildren();
    await loadFeed();
    await openThread(result.post.id);
  } catch (error) {
    composeStatus.textContent = error.message;
  } finally {
    submit.disabled = false;
  }
}

function notificationMessage(notification) {
  const actor = notification.actor?.name || "A community member";
  if (notification.kind === "reply") return `${actor} replied to a discussion you follow.`;
  if (notification.kind === "mention") return `${actor} mentioned you in a discussion.`;
  if (notification.kind === "reaction") return `${actor} reacted to your contribution.`;
  if (notification.kind === "accepted-answer") return `${actor} accepted your reply as the answer.`;
  return "A BAIRD administrator updated community content connected to your account.";
}

async function loadNotifications(show = false) {
  try {
    const data = await api("/api/community/notifications");
    const badge = document.getElementById("community-unread-count");
    badge.textContent = data.unreadCount;
    badge.hidden = !data.unreadCount;
    if (!show) return;
    const list = document.getElementById("community-notifications");
    list.replaceChildren();
    for (const notification of data.notifications) {
      const button = el("button", `community-notification${notification.readAt ? "" : " unread"}`);
      button.type = "button";
      button.append(avatar(notification.actor, true));
      const copy = el("span");
      copy.append(document.createTextNode(notificationMessage(notification)), el("span", "", formatDate(notification.createdAt)));
      button.append(copy);
      button.addEventListener("click", async () => {
        await api("/api/community/notifications", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ids: [notification.id] })
        });
        document.getElementById("community-activity-dialog").close();
        document.getElementById("tab-button-community").click();
        if (notification.postId) await openThread(notification.postId);
        await loadNotifications();
      });
      list.append(button);
    }
    if (!data.notifications.length) list.append(el("div", "community-empty", "No activity yet."));
    document.getElementById("community-activity-dialog").showModal();
  } catch (error) {
    globalStatus.textContent = error.message;
  }
}

composeForm.elements.category.addEventListener("change", () => {
  const isCase = composeForm.elements.category.value === "case-support";
  document.getElementById("community-case-check").hidden = !isCase;
  composeForm.elements.caseAttestation.required = isCase;
});
composeForm.elements.images.addEventListener("change", reviewImages);
composeForm.addEventListener("submit", (event) => {
  if (event.submitter?.value === "cancel") return;
  event.preventDefault();
  publishPost();
});

reportForm.addEventListener("submit", async (event) => {
  if (event.submitter?.value === "cancel") return;
  event.preventDefault();
  const status = document.getElementById("community-report-status");
  const data = new FormData(reportForm);
  try {
    await api("/api/community/reports", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...state.reportTarget, reason: data.get("reason"), details: data.get("details") })
    });
    status.textContent = "Report sent to BAIRD administrators.";
    setTimeout(() => reportDialog.close(), 650);
  } catch (error) {
    status.textContent = error.message;
  }
});

document.getElementById("community-new-post").addEventListener("click", () => {
  composeForm.reset();
  composeStatus.textContent = "";
  document.getElementById("community-image-review").replaceChildren();
  document.getElementById("community-case-check").hidden = true;
  composeDialog.showModal();
});
document.getElementById("community-back").addEventListener("click", closeThread);
document.getElementById("community-load-more").addEventListener("click", () => loadFeed(true));
document.getElementById("community-notification-button").addEventListener("click", () => loadNotifications(true));
document.getElementById("community-activity-close").addEventListener("click", () => {
  document.getElementById("community-activity-dialog").close();
});

document.querySelectorAll("[data-community-status]").forEach((button) => {
  button.addEventListener("click", () => {
    document.querySelectorAll("[data-community-status]").forEach((item) => item.classList.toggle("active", item === button));
    state.status = button.dataset.communityStatus;
    state.cursor = null;
    closeThread();
    loadFeed();
  });
});
document.getElementById("community-category-filter").addEventListener("change", (event) => {
  state.category = event.target.value;
  state.cursor = null;
  loadFeed();
});
document.getElementById("community-course-filter").addEventListener("change", (event) => {
  state.courseId = event.target.value;
  state.cursor = null;
  loadFeed();
});
window.addEventListener("popstate", () => {
  const id = new URLSearchParams(location.search).get("thread");
  if (id) openThread(id, false);
  else if (state.thread) closeThread(false);
});

document.addEventListener("baird:portal-ready", async ({ detail }) => {
  if (!detail.features.community) return;
  state.user = detail.user;
  state.portal = detail.portal;
  state.courses = new Map(detail.portal.courses.map((course) => [course.id, course]));
  const courseOptions = detail.portal.courses.map((course) => {
    const option = document.createElement("option");
    option.value = course.id;
    option.textContent = course.title;
    return option;
  });
  document.getElementById("community-course-filter").append(...courseOptions.map((option) => option.cloneNode(true)));
  composeForm.elements.courseId.append(...courseOptions);
  renderProfile();
  await Promise.all([loadFeed(), loadNotifications()]);
  const threadId = new URLSearchParams(location.search).get("thread");
  if (threadId) await openThread(threadId, false);
});
