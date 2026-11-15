// Which screen the address names: the routes of the console. A new screen is added here, and its section in the frame is then given its path.

import { ALLOW_PAGE } from "@poplin/core/src/api/routes";
import { createRootRoute, createRoute, createRouter, RouterProvider, useNavigate } from "@tanstack/react-router";
import type { ReactNode } from "react";

import { AccessScreen } from "@/access/access-screen";
import { ActivityScreen } from "@/activity/activity-screen";
import { Button } from "@/components/ui/button";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { DomainScreen } from "@/domain/domain-screen";
import { ADDRESS_RULES } from "@/lib/address";
import { SettingsScreen } from "@/settings/settings-screen";
import { SetupScreen } from "@/setup/setup-screen";
import { SETUP } from "@/setup/setup-start";
import { AppShell } from "@/shell/app-shell";
import { SitesScreen } from "@/sites/sites-screen";
import { UsageScreen } from "@/usage/usage-screen";

/** The frame of every route. An address no route names is told as not there. */
const ROOT = createRootRoute({ notFoundComponent: NoScreen });

/** The Sites screen, which stays drawn while a site's panel opens and closes beside its table. */
const SITES = createRoute({ getParentRoute: () => ROOT, id: "sites", component: SitesScreen });

/** The Access screen, which stays drawn while a login is reviewed over its lists. */
const ACCESS = createRoute({ getParentRoute: () => ROOT, id: "access", component: AccessScreen });

/** Every address of the console, each under the screen that draws it. */
const ROUTES = ROOT.addChildren([
  SITES.addChildren([createRoute({ getParentRoute: () => SITES, path: "/" }), createRoute({ getParentRoute: () => SITES, path: "/sites/$label" })]),
  ACCESS.addChildren([
    createRoute({ getParentRoute: () => ACCESS, path: "/tokens" }),
    createRoute({ getParentRoute: () => ACCESS, path: "/tokens/review/$login" }),
    createRoute({ getParentRoute: () => ACCESS, path: ALLOW_PAGE }),
  ]),
  createRoute({ getParentRoute: () => ROOT, path: "/activity", component: ActivityScreen }),
  createRoute({ getParentRoute: () => ROOT, path: "/usage", component: UsageScreen }),
  createRoute({ getParentRoute: () => ROOT, path: "/settings", component: SettingsScreen }),
  createRoute({ getParentRoute: () => ROOT, path: "/domain", component: DomainScreen }),
]);

/** The console's router, over the browser's own history. */
const ROUTER = createRouter({ routeTree: ROUTES, ...ADDRESS_RULES });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof ROUTER;
  }
}

/** What an address no screen draws shows: that nothing is there, and the way to the sites. */
function NoScreen(): ReactNode {
  const navigate = useNavigate();

  return (
    <AppShell current="sites" heading="Not found">
      <Empty className="flex-none py-16">
        <EmptyHeader>
          <EmptyTitle>Nothing is at this address</EmptyTitle>
          <EmptyDescription>It may be an old link.</EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button variant="outline" onClick={() => void navigate({ to: "/" })}>
            Go to the sites
          </Button>
        </EmptyContent>
      </Empty>
    </AppShell>
  );
}

/** Draw the screen the address names. The setup page has one screen, whatever the path. */
export function Screens(): ReactNode {
  if (SETUP !== null) return <SetupScreen start={SETUP} />;

  return <RouterProvider router={ROUTER} />;
}
