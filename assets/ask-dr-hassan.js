const MAX_MESSAGE_LENGTH = 2000;
const MAX_HISTORY_TURNS = 12;

const form = document.getElementById("ask-form");
const input = document.getElementById("question-input");
const sendButton = document.getElementById("send-button");
const conversation = document.getElementById("conversation");
const messagesElement = document.getElementById("messages");
const clearButton = document.getElementById("clear-button");
const suggestions = document.getElementById("suggestions");
const liveStatus = document.getElementById("live-status");
const messageTemplate = document.getElementById("message-template");
const companionMount = document.getElementById("companion-mount");
const companionHomeSlot = document.getElementById("companion-home-slot");
const chatCompanionSlot = document.getElementById("chat-companion-slot");
const companion = document.getElementById("dr-hassan-companion");
const companionCharacter = document.getElementById("companion-character");
const companionToggle = document.getElementById("companion-toggle");
const companionReveal = document.getElementById("companion-reveal");
const companionBubble = document.getElementById("companion-bubble");
const accountName = document.getElementById("account-name");
const adminLink = document.getElementById("admin-link");
const logoutButton = document.getElementById("logout-button");

const COMPANION_HIDDEN_KEY = "baird-dr-hassan-companion-hidden";
const GREETING_QUIPS = [
  "Ask away — the notes are open and the coffee is imaginary.",
  "I brought the beard; you bring the question.",
  "Revision first, dramatic sigh later.",
  "No judgement here. The quiz has already claimed that job."
];

let history = [];
let isBusy = false;
let companionStateTimer;
let companionBubbleTimer;

function storedCompanionHidden() {
  try {
    return window.localStorage.getItem(COMPANION_HIDDEN_KEY) === "true";
  } catch {
    return false;
  }
}

function persistCompanionHidden(hidden) {
  try {
    window.localStorage.setItem(COMPANION_HIDDEN_KEY, String(hidden));
  } catch {
    // The companion still works when browser storage is unavailable.
  }
}

function showCompanionBubble(message, duration = 0) {
  window.clearTimeout(companionBubbleTimer);
  companionBubble.textContent = message || "";
  companionBubble.hidden = !message;

  if (message && duration) {
    companionBubbleTimer = window.setTimeout(() => {
      companionBubble.hidden = true;
    }, duration);
  }
}

function setCompanionState(state, message = "", returnToIdleAfter = 0) {
  window.clearTimeout(companionStateTimer);
  companion.dataset.state = state;
  showCompanionBubble(message);

  if (returnToIdleAfter) {
    companionStateTimer = window.setTimeout(() => {
      companion.dataset.state = "idle";
      showCompanionBubble("");
    }, returnToIdleAfter);
  }
}

function setCompanionVisible(visible, persist = true) {
  companion.hidden = !visible;
  companionReveal.hidden = visible;
  if (!visible) showCompanionBubble("");
  if (persist) persistCompanionHidden(!visible);
}

function moveCompanion(destination) {
  if (companionMount.parentElement !== destination) destination.append(companionMount);
}

function setStatus(message) {
  liveStatus.textContent = "";
  window.setTimeout(() => {
    liveStatus.textContent = message;
  }, 20);
}

function setBusy(busy) {
  isBusy = busy;
  sendButton.disabled = busy;
  input.disabled = busy;
  form.setAttribute("aria-busy", busy ? "true" : "false");
}

function resizeInput() {
  input.style.height = "auto";
  input.style.height = `${Math.min(input.scrollHeight, 152)}px`;
}

function beginConversation() {
  document.body.classList.add("chat-active");
  conversation.hidden = false;
  moveCompanion(chatCompanionSlot);
}

function createMessage(role, text = "") {
  const fragment = messageTemplate.content.cloneNode(true);
  const article = fragment.querySelector(".message");
  const label = fragment.querySelector(".message-label");
  const copy = fragment.querySelector(".message-copy");

  article.classList.add(role);
  label.textContent = role === "assistant" ? "Dr Hassan" : "You";
  copy.textContent = text;
  messagesElement.append(fragment);

  return messagesElement.lastElementChild;
}

function setMessageText(messageElement, text) {
  messageElement.querySelector(".message-copy").textContent = text;
}

function safeSourceHref(value) {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//")) {
    return null;
  }
  return value;
}

function renderSources(messageElement, citations) {
  const unique = new Map();
  for (const citation of Array.isArray(citations) ? citations : []) {
    const href = safeSourceHref(citation.href);
    const key = href || (citation.private ? `private:${citation.label}` : "");
    if (!key || unique.has(key)) continue;
    unique.set(key, { ...citation, href });
  }

  if (!unique.size) return;

  const sources = messageElement.querySelector(".sources");
  const list = messageElement.querySelector(".source-list");

  for (const citation of unique.values()) {
    const link = document.createElement(citation.href ? "a" : "div");
    link.className = `source-link${citation.href ? "" : " private-source"}`;
    if (citation.href) {
      link.href = citation.href;
      link.target = "_blank";
      link.rel = "noopener";
    }

    const type = document.createElement("span");
    type.className = "source-type";
    type.textContent = citation.type || "Course material";

    const name = document.createElement("span");
    name.className = "source-name";
    name.textContent = citation.label || "BAIRD source";

    link.append(type, name);

    if (citation.excerpt) {
      const excerpt = document.createElement("span");
      excerpt.className = "source-excerpt";
      excerpt.textContent = citation.excerpt;
      link.append(excerpt);
    }

    list.append(link);
  }

  sources.hidden = false;
}

function parseSseBlock(block) {
  const dataLines = block
    .split("\n")
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trimStart());

  if (!dataLines.length) return null;
  return JSON.parse(dataLines.join("\n"));
}

async function readEventStream(response, onEvent) {
  if (!response.body) throw new Error("The response stream was unavailable.");

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value || new Uint8Array(), { stream: !done }).replace(/\r\n/g, "\n");

    let boundary = buffer.indexOf("\n\n");
    while (boundary !== -1) {
      const block = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      if (block.trim()) onEvent(parseSseBlock(block));
      boundary = buffer.indexOf("\n\n");
    }

    if (done) break;
  }

  if (buffer.trim()) onEvent(parseSseBlock(buffer));
}

async function getErrorMessage(response) {
  const fallback = response.status === 429
    ? "Dr Hassan has received a lot of questions. Please wait a moment and try again."
    : "Dr Hassan could not answer just now. Please try again.";

  try {
    const body = await response.json();
    return body.error || fallback;
  } catch {
    return fallback;
  }
}

async function loadAccount() {
  const response = await fetch("/api/me", { headers: { Accept: "application/json" } });
  if (response.status === 401) {
    location.assign(`/?next=${encodeURIComponent(location.pathname)}`);
    return;
  }
  if (!response.ok) throw new Error("Your account could not be loaded.");
  const { user } = await response.json();
  accountName.textContent = user.name;
  adminLink.hidden = user.role !== "admin" && user.role !== "owner";
}

async function ask(question) {
  if (isBusy) return;

  const cleanQuestion = question.trim();
  if (!cleanQuestion) {
    input.focus();
    setStatus("Enter a question before sending.");
    return;
  }

  beginConversation();
  createMessage("user", cleanQuestion);
  history.push({ role: "user", content: cleanQuestion.slice(0, MAX_MESSAGE_LENGTH) });

  const assistantMessage = createMessage("assistant");
  assistantMessage.classList.add("loading");
  setMessageText(assistantMessage, "Looking through your course materials");
  setCompanionState("searching", "Let me interrogate the lecture notes. Politely.");

  input.value = "";
  resizeInput();
  setBusy(true);
  setStatus("Dr Hassan is searching the BAIRD course library.");

  let answer = "";
  let citations = [];
  let hasStartedStreaming = false;

  try {
    const response = await fetch("/api/ask-dr-hassan", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Accept": "text/event-stream" },
      body: JSON.stringify({ messages: history.slice(-MAX_HISTORY_TURNS) })
    });

    if (!response.ok) throw new Error(await getErrorMessage(response));

    assistantMessage.classList.remove("loading");
    setMessageText(assistantMessage, "");

    await readEventStream(response, (event) => {
      if (!event) return;

      if (event.type === "delta") {
        if (!hasStartedStreaming) {
          hasStartedStreaming = true;
          setCompanionState("answering", "Found it. Educational goodness incoming.");
        }
        answer += event.text || "";
        setMessageText(assistantMessage, answer);
      } else if (event.type === "done") {
        answer = event.answer || answer;
        citations = event.citations || [];
        setMessageText(assistantMessage, answer);
        renderSources(assistantMessage, citations);
        setCompanionState("success", "Lovely. Sources attached — even my jokes need evidence.", 2800);
      } else if (event.type === "error") {
        throw new Error(event.error || "Dr Hassan could not complete the answer.");
      }
    });

    if (!answer.trim()) throw new Error("Dr Hassan could not find a supported answer in the course materials.");

    history.push({ role: "assistant", content: answer.slice(0, MAX_MESSAGE_LENGTH) });
    history = history.slice(-MAX_HISTORY_TURNS);
    setStatus(`Dr Hassan answered with ${citations.length} source${citations.length === 1 ? "" : "s"}.`);
  } catch (error) {
    assistantMessage.classList.remove("loading");
    assistantMessage.classList.add("error");
    setMessageText(assistantMessage, error instanceof Error ? error.message : "Dr Hassan could not answer just now.");
    history = history.filter((item, index) => index !== history.length - 1 || item.role !== "user");
    setCompanionState("error", "I couldn’t complete that answer. Please try again.", 3200);
    setStatus("Dr Hassan could not complete the answer.");
  } finally {
    setBusy(false);
    input.focus();
    assistantMessage.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }
}

form.addEventListener("submit", (event) => {
  event.preventDefault();
  ask(input.value);
});

input.addEventListener("input", resizeInput);
input.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    form.requestSubmit();
  }
});

suggestions.addEventListener("click", (event) => {
  const button = event.target.closest("[data-prompt]");
  if (!button) return;
  input.value = button.dataset.prompt;
  resizeInput();
  form.requestSubmit();
});

clearButton.addEventListener("click", () => {
  history = [];
  messagesElement.replaceChildren();
  conversation.hidden = true;
  document.body.classList.remove("chat-active");
  moveCompanion(companionHomeSlot);
  setCompanionState("idle");
  input.value = "";
  resizeInput();
  input.focus();
  setStatus("Chat cleared.");
});

companionCharacter.addEventListener("click", () => {
  if (isBusy) {
    showCompanionBubble("I’m on it — the notes are putting up a fight.", 2400);
    return;
  }

  const quip = GREETING_QUIPS[Math.floor(Math.random() * GREETING_QUIPS.length)];
  setCompanionState("greeting", quip, 2800);
});

companionToggle.addEventListener("click", () => {
  setCompanionVisible(false);
  companionReveal.focus();
  setStatus("Dr Hassan companion hidden.");
});

companionReveal.addEventListener("click", () => {
  setCompanionVisible(true);
  setCompanionState("greeting", "I’m back. The notes missed me.", 2400);
  companionCharacter.focus();
  setStatus("Dr Hassan companion shown.");
});

logoutButton.addEventListener("click", async () => {
  await fetch("/api/auth/logout", { method: "POST" });
  location.assign("/");
});

loadAccount().catch((error) => setStatus(error instanceof Error ? error.message : "Your account could not be loaded."));
setCompanionVisible(!storedCompanionHidden(), false);
resizeInput();
