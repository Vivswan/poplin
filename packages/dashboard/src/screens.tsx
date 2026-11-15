// Which screen the address names: the routes of the console. A new screen is added here, and its section in the frame is then given its path.

import { ALLOW_PAGE } from "@poplin/core/src/api/routes";
import { CatchBoundary, createLazyRoute, createRootRoute, createRoute, createRouter, RouterProvider, useNavigate } from "@tanstack/react-router";
import { lazy, type ReactNode, Suspense } from "react";

import { Button } from "@/components/ui/button";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { ADDRESS_RULES } from "@/lib/address";
import { SETUP } from "@/setup/setup-start";
import { Unread } from "@/shared/unread";
import { WaitingRows } from "@/shared/waiting-rows";
import { AppShell, type Section } from "@/shell/app-shell";
import { SitesScreen } from "@/sites/sites-screen";

/** The setup screen, whose code only the setup page loads. */
const SetupScreen = lazy(async () => ({ default: (await import("@/setup/setup-screen")).SetupScreen }));

/** The frame of every route. An address no route names is told as not there. */
const ROOT = createRootRoute({ notFoundComponent: NoScreen });

/** The Sites screen, which stays drawn while a site's panel opens and closes beside its table. */
const SITES = createRoute({ getParentRoute: () => ROOT, id: "sites", component: SitesScreen });

/** The Access screen, which stays drawn while a login is reviewed over its lists. Its code is loaded when it is first opened, as is the code of every screen but Sites. */
const ACCESS = createRoute({ getParentRoute: () => ROOT, id: "access", ...meanwhile("access", "Access") }).lazy(async () => {
  const { AccessScreen } = await import("@/access/access-screen");

  return createLazyRoute("/access")({ component: AccessScreen });
});

/** The Activity screen. */
const ACTIVITY = createRoute({ getParentRoute: () => ROOT, path: "/activity", ...meanwhile("activity", "Activity") }).lazy(async () => {
  const { ActivityScreen } = await import("@/activity/activity-screen");

  return createLazyRoute("/activity")({ component: ActivityScreen });
});

/** The Usage screen, whose code holds the graph. */
const USAGE = createRoute({ getParentRoute: () => ROOT, path: "/usage", ...meanwhile("usage", "Usage") }).lazy(async () => {
  const { UsageScreen } = await import("@/usage/usage-screen");

  return createLazyRoute("/usage")({ component: UsageScreen });
});

/** The Settings screen. */
const SETTINGS = createRoute({ getParentRoute: () => ROOT, path: "/settings", ...meanwhile("settings", "Settings") }).lazy(async () => {
  const { SettingsScreen } = await import("@/settings/settings-screen");

  return createLazyRoute("/settings")({ component: SettingsScreen });
});

/** The Domain screen. */
const DOMAIN = createRoute({ getParentRoute: () => ROOT, path: "/domain", ...meanwhile("domain", "Domain") }).lazy(async () => {
  const { DomainScreen } = await import("@/domain/domain-screen");

  return createLazyRoute("/domain")({ component: DomainScreen });
});

/** Every address of the console, each under the screen that draws it. */
const ROUTES = ROOT.addChildren([
  SITES.addChildren([createRoute({ getParentRoute: () => SITES, path: "/" }), createRoute({ getParentRoute: () => SITES, path: "/sites/$label" })]),
  ACCESS.addChildren([
    createRoute({ getParentRoute: () => ACCESS, path: "/tokens" }),
    createRoute({ getParentRoute: () => ACCESS, path: "/tokens/list" }),
    createRoute({ getParentRoute: () => ACCESS, path: "/tokens/review/$login" }),
    createRoute({ getParentRoute: () => ACCESS, path: ALLOW_PAGE }),
  ]),
  ACTIVITY,
  USAGE,
  SETTINGS,
  DOMAIN,
]);

/** The console's router, over the browser's own history. A screen's code is asked for once a pointer rests on its link, and the rows that stand in for it show at once. */
const ROUTER = createRouter({ routeTree: ROUTES, ...ADDRESS_RULES, defaultPreload: "intent", defaultPendingMs: 0, defaultPendingMinMs: 0 });

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

/** What stands in for a screen whose code did not load: that it did not, and the way to load the page again, which also brings the code of a newer version. */
function NotLoaded(): ReactNode {
  return <Unread title="This screen did not load" failure="Check the connection, then try again." onRetry={() => window.location.reload()} />;
}

/**
 * What a route draws inside the frame until its screen's code is there, and when the code does not come.
 *
 * @param section - the section the frame marks meanwhile
 * @param heading - the screen's title
 */
function meanwhile(section: Section, heading: string): { readonly pendingComponent: () => ReactNode; readonly errorComponent: () => ReactNode } {
  return {
    pendingComponent: () => (
      <AppShell current={section} heading={heading}>
        <WaitingRows />
      </AppShell>
    ),
    errorComponent: () => (
      <AppShell current={section} heading={heading}>
        <NotLoaded />
      </AppShell>
    ),
  };
}

/** Draw the screen the address names. The setup page has one screen, whatever the path. */
export function Screens(): ReactNode {
  if (SETUP === null) return <RouterProvider router={ROUTER} />;

  return (
    <CatchBoundary getResetKey={() => "setup"} errorComponent={NotLoaded}>
      <Suspense fallback={<WaitingRows />}>
        <SetupScreen start={SETUP} />
      </Suspense>
    </CatchBoundary>
  );
}
