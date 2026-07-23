const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const state = { profile: null, portal: null, avatarAssetId: null, customPreview: null };
const form = document.getElementById("profile-form");
const status = document.getElementById("profile-status");
const avatarPreview = document.getElementById("avatar-preview");
const avatarFile = document.getElementById("avatar-file");

function initials(name) {
  return String(name || "BA").split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
}

function safeNext() {
  const next = new URLSearchParams(location.search).get("next");
  return next?.startsWith("/") && !next.startsWith("//") ? next : "/baird_implant_portal.html";
}

async function api(url, options = {}) {
  const response = await fetch(url, { headers: { Accept: "application/json", ...(options.headers || {}) }, ...options });
  const body = response.status === 204 ? null : await response.json().catch(() => ({}));
  if (response.status === 401) location.assign(`/?next=${encodeURIComponent(location.pathname + location.search)}`);
  if (!response.ok) throw new Error(body?.error || "The request could not be completed.");
  return body;
}

function renderAvatar() {
  const choice = form.elements.avatarChoice.value;
  const source = choice === "upload" && state.customPreview
    ? state.customPreview
    : choice === "google"
      ? state.profile.googlePictureUrl
      : state.profile.avatar?.kind === "upload" && state.profile.avatar.assetId
        ? `/api/community/images/${encodeURIComponent(state.profile.avatar.assetId)}?variant=thumbnail`
        : null;
  avatarPreview.replaceChildren();
  if (source) {
    const image = new Image();
    image.src = source;
    image.alt = "";
    image.addEventListener("error", () => {
      avatarPreview.textContent = initials(form.elements.name.value);
    });
    avatarPreview.append(image);
  } else {
    avatarPreview.textContent = initials(form.elements.name.value);
  }
}

function renderCourses() {
  const courses = new Map((state.portal?.courses || []).map((course) => [course.id, course]));
  const labels = (state.profile.completedCourseIds || []).map((id) => courses.get(id)?.title || id);
  document.getElementById("course-badges").replaceChildren(
    ...(labels.length ? labels : ["None assigned yet"]).map((label) => {
      const badge = document.createElement("span");
      badge.textContent = label;
      return badge;
    })
  );
}

async function uploadImage(file) {
  if (!file || file.size <= 0 || file.size > MAX_IMAGE_BYTES) throw new Error("Choose an image no larger than 10 MB.");
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) throw new Error("Choose a JPEG, PNG or WebP image.");
  const created = await api("/api/community/uploads", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ filename: file.name, mimeType: file.type, size: file.size, purpose: "avatar" })
  });
  const { id, chunkBytes, expectedChunks } = created.upload;
  for (let index = 0; index < expectedChunks; index += 1) {
    await api(`/api/community/uploads/${encodeURIComponent(id)}/chunks/${index}`, {
      method: "PUT",
      headers: { "Content-Type": "application/octet-stream" },
      body: file.slice(index * chunkBytes, Math.min(file.size, (index + 1) * chunkBytes))
    });
  }
  return await api(`/api/community/uploads/${encodeURIComponent(id)}/finalize`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}"
  });
}

document.getElementById("choose-avatar").addEventListener("click", () => avatarFile.click());
avatarFile.addEventListener("change", async () => {
  const file = avatarFile.files?.[0];
  if (!file) return;
  status.textContent = "Uploading profile picture…";
  try {
    if (state.customPreview) URL.revokeObjectURL(state.customPreview);
    state.customPreview = URL.createObjectURL(file);
    form.elements.avatarChoice.value = "upload";
    renderAvatar();
    const result = await uploadImage(file);
    state.avatarAssetId = result.attachment.id;
    status.textContent = "Profile picture ready.";
  } catch (error) {
    state.avatarAssetId = null;
    status.textContent = error.message;
  }
});

form.addEventListener("change", (event) => {
  if (event.target.name === "avatarChoice") renderAvatar();
});
form.elements.name.addEventListener("input", renderAvatar);

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = form.querySelector("button[type='submit']");
  button.disabled = true;
  status.textContent = "Saving profile…";
  try {
    const data = new FormData(form);
    const avatarChoice = data.get("avatarChoice");
    if (avatarChoice === "upload" && !state.avatarAssetId && state.profile.avatar?.kind !== "upload") {
      throw new Error("Choose and upload a profile picture first.");
    }
    await api("/api/profile", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: data.get("name"),
        location: data.get("location"),
        avatarChoice,
        avatarAssetId: state.avatarAssetId || state.profile.avatar?.assetId,
        notificationPreferences: {
          emailReplies: data.has("emailReplies"),
          emailMentions: data.has("emailMentions"),
          emailAcceptedAnswers: data.has("emailAcceptedAnswers")
        }
      })
    });
    location.assign(safeNext());
  } catch (error) {
    status.textContent = error.message;
    button.disabled = false;
  }
});

try {
  const [profileData, me] = await Promise.all([api("/api/profile"), api("/api/me")]);
  state.profile = profileData.profile;
  state.portal = me.portal;
  form.elements.name.value = state.profile.name || "";
  form.elements.location.value = state.profile.location || "";
  form.elements.emailReplies.checked = state.profile.notificationPreferences?.emailReplies !== false;
  form.elements.emailMentions.checked = state.profile.notificationPreferences?.emailMentions !== false;
  form.elements.emailAcceptedAnswers.checked = state.profile.notificationPreferences?.emailAcceptedAnswers !== false;
  const choice = state.profile.avatar?.kind || (state.profile.googlePictureUrl ? "google" : "none");
  form.elements.avatarChoice.value = choice;
  if (!state.profile.googlePictureUrl) form.querySelector('input[value="google"]').closest("label").hidden = true;
  renderAvatar();
  renderCourses();
} catch (error) {
  status.textContent = error.message;
}
