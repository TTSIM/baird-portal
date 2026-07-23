(() => {
  const storageKey = "baird-theme";
  const root = document.documentElement;

  function storedTheme() {
    try {
      const value = localStorage.getItem(storageKey);
      return value === "dark" ? "dark" : "light";
    } catch {
      return "light";
    }
  }

  function updateButtons(theme) {
    document.querySelectorAll("[data-theme-toggle]").forEach((button) => {
      const dark = theme === "dark";
      button.setAttribute("aria-pressed", String(dark));
      button.setAttribute("aria-label", dark ? "Use light theme" : "Use dark theme");
      const label = button.querySelector("[data-theme-label]");
      if (label) label.textContent = dark ? "Light mode" : "Dark mode";
    });
  }

  function applyTheme(theme, persist = false) {
    root.dataset.theme = theme;
    if (persist) {
      try {
        localStorage.setItem(storageKey, theme);
      } catch {
        // The selected theme still applies for this page when storage is unavailable.
      }
    }
    updateButtons(theme);
  }

  applyTheme(storedTheme());

  document.addEventListener("DOMContentLoaded", () => {
    updateButtons(root.dataset.theme || "light");
    document.querySelectorAll("[data-theme-toggle]").forEach((button) => {
      button.addEventListener("click", () => {
        applyTheme(root.dataset.theme === "dark" ? "light" : "dark", true);
      });
    });
  });

  window.addEventListener("storage", (event) => {
    if (event.key === storageKey) applyTheme(event.newValue === "dark" ? "dark" : "light");
  });
})();
