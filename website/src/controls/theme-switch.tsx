import { MonitorIcon, MoonIcon, SunIcon } from "lucide-react";
import { useSyncExternalStore } from "react";
import { Button } from "../ui/button.tsx";

// The switch goes system, light, dark, and back to system.
const NEXT = { system: "light", light: "dark", dark: "system" } as const;

type Theme = keyof typeof NEXT;

/** The pinned theme, which the page's root carries; none pinned is the system's. */
function pinned(): Theme {
  const theme = document.documentElement.dataset.theme;

  return theme === "light" || theme === "dark" ? theme : "system";
}

/** Tells a listener whenever the root's theme changes, whoever changed it. */
function watch(listener: () => void): () => void {
  const observer = new MutationObserver(listener);
  observer.observe(document.documentElement, { attributeFilter: ["data-theme"] });

  return () => observer.disconnect();
}

/** Pins a theme on the root and remembers it; the stylesheet does the rest. */
function pin(theme: Theme): void {
  const root = document.documentElement;
  if (theme === "system") delete root.dataset.theme;
  else root.dataset.theme = theme;
  try {
    if (theme === "system") localStorage.removeItem("theme");
    else localStorage.setItem("theme", theme);
  } catch {
    // The choice still holds for this page; it is only not remembered.
  }
}

/** The header's theme switch. The theme follows the system until one is chosen; the stylesheet shows the mark of the one in force. */
export function ThemeSwitch(): React.ReactElement {
  const theme = useSyncExternalStore(watch, pinned, () => "system" as const);

  return (
    <Button variant="ghost" size="icon" className="-m-[6px]" data-theme-switch="" aria-label={`Theme: ${theme}`} onClick={() => pin(NEXT[theme])}>
      <MonitorIcon className="system" />
      <SunIcon className="light" />
      <MoonIcon className="dark" />
    </Button>
  );
}
