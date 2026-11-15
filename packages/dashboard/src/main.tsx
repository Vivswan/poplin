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

/** How far under the top of the screen a line is said, as the stylesheet sets it: under the header on a phone, so it covers neither a screen's title nor a panel's Close. */
const LINE_TOP = "var(--toast-top)";

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
            <Toaster position="top-center" offset={{ top: LINE_TOP }} mobileOffset={{ top: LINE_TOP, left: 12, right: 12 }} />
          </TooltipProvider>
        </ThemeProvider>
      </QueryClientProvider>
    </StrictMode>,
  );
}
