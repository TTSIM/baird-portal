const status = document.getElementById("login-status");
const button = document.getElementById("google-button");
const buttonShell = document.getElementById("google-button-shell");
const brandScene = document.querySelector(".brand-scene");
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

function setStatus(message = "", state = "") {
  status.textContent = message;
  if (state) {
    status.dataset.state = state;
  } else {
    delete status.dataset.state;
  }
}

function setButtonReady() {
  buttonShell.dataset.ready = "true";
  buttonShell.setAttribute("aria-busy", "false");
}

function safeNext() {
  const next = new URLSearchParams(location.search).get("next");
  return next?.startsWith("/") && !next.startsWith("//") ? next : "/baird_implant_portal.html";
}

function destinationFor(user) {
  return user?.profileComplete !== false
    ? safeNext()
    : `profile-setup.html?next=${encodeURIComponent(safeNext())}`;
}

async function waitForGoogle() {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (window.google?.accounts?.id) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("Google sign-in could not be loaded. Check your connection and try again.");
}

if (brandScene && !reducedMotion.matches) {
  brandScene.addEventListener("pointermove", (event) => {
    const bounds = brandScene.getBoundingClientRect();
    const x = ((event.clientX - bounds.left) / bounds.width - 0.5) * -10;
    const y = ((event.clientY - bounds.top) / bounds.height - 0.5) * -10;
    brandScene.style.setProperty("--scene-x", `${x}px`);
    brandScene.style.setProperty("--scene-y", `${y}px`);
  });

  brandScene.addEventListener("pointerleave", () => {
    brandScene.style.setProperty("--scene-x", "0px");
    brandScene.style.setProperty("--scene-y", "0px");
  });
}

try {
  const currentUser = await fetch("/api/me", { headers: { Accept: "application/json" } });
  if (currentUser.ok) {
    const body = await currentUser.json();
    setStatus("Taking you to your learning space…", "progress");
    location.replace(destinationFor(body.user));
    await new Promise(() => {});
  }

  const response = await fetch("/api/auth/config", { headers: { Accept: "application/json" } });
  const config = await response.json();
  if (!response.ok) throw new Error(config.error || "Sign-in is not configured.");

  await waitForGoogle();
  window.google.accounts.id.initialize({
    client_id: config.googleClientId,
    callback: async ({ credential }) => {
      buttonShell.setAttribute("aria-busy", "true");
      button.style.pointerEvents = "none";
      setStatus("Checking your BAIRD access…", "progress");

      try {
        const signIn = await fetch("/api/auth/google", {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-CSRF-Token": config.csrfToken },
          body: JSON.stringify({ credential, csrfToken: config.csrfToken })
        });
        const body = await signIn.json();

        if (!signIn.ok) {
          buttonShell.setAttribute("aria-busy", "false");
          button.style.pointerEvents = "";
          setStatus(body.error || "This account has not been approved for BAIRD access.", "error");
          return;
        }

        setStatus("Access confirmed. Opening your portal…", "progress");
        location.assign(destinationFor(body.user));
      } catch {
        buttonShell.setAttribute("aria-busy", "false");
        button.style.pointerEvents = "";
        setStatus("We could not complete sign-in. Check your connection and try again.", "error");
      }
    }
  });

  window.google.accounts.id.renderButton(button, {
    type: "standard",
    theme: "outline",
    size: "large",
    shape: "rectangular",
    text: "continue_with",
    width: Math.min(326, buttonShell.clientWidth || 326)
  });
  setButtonReady();
} catch (error) {
  setButtonReady();
  setStatus(
    error instanceof Error ? error.message : "Sign-in is unavailable. Please try again shortly.",
    "error"
  );
}
