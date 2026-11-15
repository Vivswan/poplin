// A router for the component tests: one piece drawn at an address of the console, over the page's own history, so Back and the browser's unload question act as they do in a browser.

import { type AnyRouter, createBrowserHistory, createRootRoute, createRoute, createRouter, RouterProvider } from "@tanstack/react-router";
import { act, render } from "@testing-library/react";
import { type ReactNode, useEffect } from "react";

import { ADDRESS_RULES } from "@/lib/address";
import { BOOT } from "@/lib/boot";

/** The router's frame, which gives the page's history back when the test's cleanup takes the piece down. */
function Routed({ router }: { readonly router: AnyRouter }): ReactNode {
  useEffect(() => () => router.history.destroy(), [router]);

  return <RouterProvider router={router} />;
}

/**
 * Draw a piece inside a router at an address, with the console's own rules for the base and the query.
 *
 * The piece is drawn at every address, so a move leaves it on the page and it can say where the router is.
 *
 * @param address - the path under the base, with its query, such as `/settings?kind=sites`
 * @returns the router, for the moves a test makes
 */
export async function drawAt(address: string, piece: ReactNode): Promise<AnyRouter> {
  window.history.replaceState(null, "", `${BOOT.base}${address}`);

  const root = createRootRoute({ component: () => piece });
  const routes = root.addChildren([createRoute({ getParentRoute: () => root, path: "/" }), createRoute({ getParentRoute: () => root, path: "$" })]);
  const router = createRouter({ routeTree: routes, history: createBrowserHistory(), ...ADDRESS_RULES });

  await act(async () => {
    render(<Routed router={router} />);
    await router.load();
  });

  return router;
}
