// The client of the dashboard: it draws the screen the address names inside the frame.

import "./index.css";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { ThemeProvider } from "@/components/theme-provider";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Screens } from "@/screens";

/** How long a pointer rests on a control before its hint shows, in milliseconds. */
const HINT_AFTER_MS = 400;

/** How far under the top of the screen a line is said, in pixels, on every screen: a line of one row then lies inside the header's band, over no control of a list or a panel. */
const LINE_TOP = 6;

/** The look of a line, laid over the library's own: less room above and below its words, so one row is lower than the header. */
const LINE_LOOK = "cn-toast py-2.5!";

/** Where every screen's data is kept. A refused read is not asked again by itself: the refusal is shown. */
const QUERIES = new QueryClient({ defaultOptions: { queries: { retry: false } } });

/** The element of the shell page the client is drawn into. */
const root = document.getElementById("root");

if (root !== null) {
  createRoot(root).render(
    <StrictMode>
      <QueryClientProvider client={QUERIES}>
        <ThemeProvider storageKey="poplin.theme">
          <TooltipProvider delay={HINT_AFTER_MS}>
            <Screens />
            <Toaster
              position="top-center"
              offset={{ top: LINE_TOP }}
              mobileOffset={{ top: LINE_TOP, left: 12, right: 12 }}
              toastOptions={{ classNames: { toast: LINE_LOOK } }}
            />
          </TooltipProvider>
        </ThemeProvider>
      </QueryClientProvider>
    </StrictMode>,
  );
}
