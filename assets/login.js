const status = document.getElementById("login-status");
const button = document.getElementById("google-button");

function safeNext() {
  const next = new URLSearchParams(location.search).get("next");
  return next?.startsWith("/") && !next.startsWith("//") ? next : "/baird_implant_portal.html";
}

async function waitForGoogle() {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (window.google?.accounts?.id) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("Google sign-in could not be loaded.");
}

try {
  const currentUser = await fetch("/api/me", { headers: { Accept: "application/json" } });
  if (currentUser.ok) {
    const body = await currentUser.json();
    location.replace(body.user?.profileComplete !== false
      ? safeNext()
      : `profile-setup.html?next=${encodeURIComponent(safeNext())}`);
    await new Promise(() => {});
  }

  const response = await fetch("/api/auth/config", { headers: { Accept: "application/json" } });
  const config = await response.json();
  if (!response.ok) throw new Error(config.error || "Sign-in is not configured.");
  await waitForGoogle();
  window.google.accounts.id.initialize({
    client_id: config.googleClientId,
    callback: async ({ credential }) => {
      status.textContent = "Signing in…";
      const signIn = await fetch("/api/auth/google", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": config.csrfToken },
        body: JSON.stringify({ credential, csrfToken: config.csrfToken })
      });
      const body = await signIn.json();
      if (!signIn.ok) {
        status.textContent = body.error || "Sign-in was not accepted.";
        return;
      }
      location.assign(body.user?.profileComplete !== false
        ? safeNext()
        : `profile-setup.html?next=${encodeURIComponent(safeNext())}`);
    }
  });
  window.google.accounts.id.renderButton(button, {
    type: "standard",
    theme: "outline",
    size: "large",
    width: Math.min(326, button.clientWidth || 326)
  });
} catch (error) {
  if (!status.textContent) {
    status.textContent = error instanceof Error ? error.message : "Sign-in is unavailable.";
  }
}
