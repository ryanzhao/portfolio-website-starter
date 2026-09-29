"use client";
import { useState } from "react";

export function ThemeToggle() {
  const [theme, setTheme] = useState<"system" | "light" | "dark">("system");
  function toggle() {
    const next = theme === "system" ? "light" : theme === "light" ? "dark" : "system";
    setTheme(next);
    document.documentElement.dataset.theme = next;
  }
  return <button className="theme-toggle" onClick={toggle} aria-label={`Color theme: ${theme}. Change theme.`}>Theme: {theme}</button>;
}
