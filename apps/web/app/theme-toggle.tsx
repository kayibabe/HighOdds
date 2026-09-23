"use client";

import { useEffect, useState } from "react";

type Theme = "system" | "light" | "dark";

export default function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>("system");

  useEffect(() => {
    const stored = window.localStorage.getItem("theme") as Theme | null;
    if (stored === "light" || stored === "dark") {
      setTheme(stored);
      document.documentElement.setAttribute("data-theme", stored);
    }
  }, []);

  function cycle() {
    setTheme((current) => {
      const next: Theme = current === "system" ? "dark" : current === "dark" ? "light" : "system";
      if (next === "system") {
        document.documentElement.removeAttribute("data-theme");
        window.localStorage.removeItem("theme");
      } else {
        document.documentElement.setAttribute("data-theme", next);
        window.localStorage.setItem("theme", next);
      }
      return next;
    });
  }

  return (
    <button type="button" className="theme-btn" onClick={cycle} title={`Theme: ${theme}`} aria-label={`Theme: ${theme}. Change theme`}>
      {theme === "system" ? "Auto" : theme}
    </button>
  );
}
