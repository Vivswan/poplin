// The client of the dashboard: it draws the screen the address names inside the frame.

import "./index.css";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { type ReactNode, StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { ThemeProvider } from "@/components/theme-provider";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useMedia } from "@/lib/media";
import { Screens } from "@/screens";

/** How long a pointer rests on a control before its hint shows, in milliseconds. */
const HINT_AFTER_MS = 400;

/** The widths of a phone, where a screen's own controls begin right under the header. */
const PHONE = "(max-width: 767.98px)";

/** How far from the screen's edges a line is said: lengths the stylesheet sets. A wide screen says it at the top, inside the header's band; a phone at the bottom, over the bar of unsaved changes while one is shown. */
const LINE_EDGES = { top: "var(--line-top)", bottom: "var(--line-bottom)" };

/** The look of a line, laid over the library's own: less room above and below its words, so one row is lower than the header. */
const LINE_LOOK = "cn-toast py-2.5!";

/** Where every screen's data is kept. A refused read is not asked again by itself: the refusal is shown. */
const QUERIES = new QueryClient({ defaultOptions: { queries: { retry: false } } });

/** Draw the place where every result is said. */
function Lines(): ReactNode {
  const phone = useMedia(PHONE);

  return (
    <Toaster
      position={phone ? "bottom-center" : "top-center"}
      offset={LINE_EDGES}
      mobileOffset={{ ...LINE_EDGES, left: 12, right: 12 }}
      toastOptions={{ classNames: { toast: LINE_LOOK } }}
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
