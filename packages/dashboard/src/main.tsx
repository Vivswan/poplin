// The client of the dashboard: it draws the screen the address names inside the frame.

import "./index.css";

import { useMediaQuery } from "@base-ui/react/unstable-use-media-query";
import { QueryClientProvider } from "@tanstack/react-query";
import { type ReactNode, StrictMode, useEffect } from "react";
import { createRoot } from "react-dom/client";

import { ThemeProvider } from "@/components/theme-provider";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QUERIES } from "@/lib/api";
import { noteFocus } from "@/lib/focus";
import { IN_BROWSER, PHONE } from "@/lib/media";
import { leaveAtPress, leaveNewest } from "@/lib/notify";
import { Screens } from "@/screens";

/** How long a pointer rests on a control before its hint shows, in milliseconds. */
const HINT_AFTER_MS = 400;

/** How far from the screen's edges a line is said: lengths the stylesheet sets. A wide screen says it at the top, inside the header's band; a phone at the bottom, over the bar of unsaved changes while one is shown. */
const LINE_EDGES = { top: "var(--line-top)", bottom: "var(--line-bottom)" };

/** The look of a line, laid over the library's own: so little room around its words that a line with a button, which has two rows, is lower than the header. On a phone its words end after two rows. */
const LINE_LOOK = { toast: "cn-toast py-2.5! has-data-description:py-1!", title: "max-md:line-clamp-2", description: "text-xs! leading-4!" };

/** Draw the place where every result is said. */
function Lines(): ReactNode {
  const phone = useMediaQuery(PHONE, IN_BROWSER);
  useEffect(() => {
    if (phone) leaveNewest();
  }, [phone]);
  useEffect(() => {
    document.addEventListener("click", leaveAtPress);
    document.addEventListener("focusin", noteFocus);

    return () => {
      document.removeEventListener("click", leaveAtPress);
      document.removeEventListener("focusin", noteFocus);
    };
  }, []);

  return (
    <Toaster
      position={phone ? "bottom-center" : "top-center"}
      offset={LINE_EDGES}
      mobileOffset={{ ...LINE_EDGES, left: 12, right: 12 }}
      toastOptions={{ classNames: LINE_LOOK }}
    />
  );
}

/** The element of the shell page the client is drawn into. */
const root = document.getElementById("root");

if (root !== null) {
  createRoot(root).render(
    <StrictMode>
      <QueryClientProvider client={QUERIES}>
        <ThemeProvider storageKey="poplin.theme">
          <TooltipProvider delay={HINT_AFTER_MS}>
            <Screens />
            <Lines />
          </TooltipProvider>
        </ThemeProvider>
      </QueryClientProvider>
    </StrictMode>,
  );
}
