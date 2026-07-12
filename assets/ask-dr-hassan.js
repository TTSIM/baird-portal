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

let history = [];
let isBusy = false;

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
    if (!href || unique.has(href)) continue;
    unique.set(href, { ...citation, href });
  }

  if (!unique.size) return;

  const sources = messageElement.querySelector(".sources");
  const list = messageElement.querySelector(".source-list");

  for (const citation of unique.values()) {
    const link = document.createElement("a");
    link.className = "source-link";
    link.href = citation.href;
    link.target = "_blank";
    link.rel = "noopener";

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

  input.value = "";
  resizeInput();
  setBusy(true);
  setStatus("Dr Hassan is searching the BAIRD course library.");

  let answer = "";
  let citations = [];

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
        answer += event.text || "";
        setMessageText(assistantMessage, answer);
      } else if (event.type === "done") {
        answer = event.answer || answer;
        citations = event.citations || [];
        setMessageText(assistantMessage, answer);
        renderSources(assistantMessage, citations);
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
  input.value = "";
  resizeInput();
  input.focus();
  setStatus("Chat cleared.");
});

resizeInput();
