// The choice of the look at the top of every screen: one button that moves from the system's look to the light one, to the dark one, and back. The choice is kept in this browser, and the system's look follows the device while it is chosen.

import { MonitorIcon, MoonIcon, SunIcon } from "lucide-react";
import type { ReactNode } from "react";

import { useTheme } from "@/components/theme-provider";
import { IconButton } from "@/shared/icon-button";

/** The looks, each with its word, its mark, and the look a press moves on to. */
const LOOKS = {
  system: { label: "System", icon: MonitorIcon, next: "light" },
  light: { label: "Light", icon: SunIcon, next: "dark" },
  dark: { label: "Dark", icon: MoonIcon, next: "system" },
} as const;

/** Draw the button that shows the chosen look's mark and names it, also in its hint: a press chooses the next look. */
export function ThemeButton(): ReactNode {
  const { theme, setTheme } = useTheme();
  const { label, icon: Icon, next } = LOOKS[theme];

  return (
    <IconButton label={`Theme: ${label}`} onClick={() => setTheme(next)} className="max-md:size-10">
      <Icon />
    </IconButton>
  );
}
