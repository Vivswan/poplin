// The frame every screen sits in: the sections at the side, what the domain needs and the account at its foot, and the working area. On a phone the sections are behind a button at the top.

import { useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "@tanstack/react-router";
import { cn } from "cn";
import {
  ActivityIcon,
  ArrowUpCircleIcon,
  ChevronsUpDownIcon,
  GaugeIcon,
  GlobeIcon,
  KeyRoundIcon,
  LayoutListIcon,
  MenuIcon,
  MonitorIcon,
  MoonIcon,
  RotateCcwIcon,
  SettingsIcon,
  SunIcon,
  TriangleAlertIcon,
} from "lucide-react";
import { type ReactNode, useState } from "react";

import { useTheme } from "@/components/theme-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent, SheetDescription, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { api } from "@/lib/api";
import { BOOT } from "@/lib/boot";
import { useFrame, useStarted } from "@/lib/frame";
import { useMedia } from "@/lib/media";
import { sayDone, sayRefused, send } from "@/lib/notify";
import { useChosenTimeZone } from "@/lib/timezone";
import { Confirm, type Question } from "@/shared/confirm";
import { IconButton } from "@/shared/icon-button";
import { siteKey } from "@/sites/site-queries";

/** The sections, in the order shown, each with the path of its screen: first what a person looks at, then, set apart by a gap, what a person sets up. */
const SECTIONS = [
  { key: "sites", label: "Sites", icon: LayoutListIcon, inside: "/", apart: false },
  { key: "activity", label: "Activity", icon: ActivityIcon, inside: "/activity", apart: false },
  { key: "usage", label: "Usage", icon: GaugeIcon, inside: "/usage", apart: false },
  { key: "access", label: "Access", icon: KeyRoundIcon, inside: "/tokens", apart: true },
  // The Domain screen is there only in a dashboard built with the provider's side of the install.
  ...(BOOT.domain ? ([{ key: "domain", label: "Domain", icon: GlobeIcon, inside: "/domain", apart: false }] as const) : []),
  { key: "settings", label: "Settings", icon: SettingsIcon, inside: "/settings", apart: false },
] as const;

/** The name at the top of the side, the same on every install. */
const NAME = "poplin";

/** What the browser matches while the system asks for the dark look. */
const SYSTEM_DARK = "(prefers-color-scheme: dark)";

/** What keeps the router from marking a link of the frame as the place the address is at for every address under it, and from adding a class of its own. */
const NO_OWN_MARK = { activeOptions: { exact: true }, activeProps: {} } as const;

/** The start of an update, where one can be started: the release it leads to, and what asks before it starts. */
interface Offer {
  readonly newest: string;
  readonly ask: () => void;
}

/** A section's key. */
type Section = (typeof SECTIONS)[number]["key"];

/** The product's mark. */
export function BrandMark(): ReactNode {
  return (
    <svg viewBox="0 0 64 64" aria-hidden="true" className="size-5 shrink-0">
      <rect x="28" y="4" width="32" height="32" rx="8" fill="#3b66d6" opacity=".45" />
      <rect x="16" y="16" width="32" height="32" rx="8" fill="#d23c56" />
      <rect x="4" y="28" width="32" height="32" rx="8" fill="#3b66d6" />
    </svg>
  );
}

function SectionLink({ section, current }: { readonly section: (typeof SECTIONS)[number]; readonly current: Section }): ReactNode {
  const Icon = section.icon;
  const here = section.key === current;
  const look = cn(
    "flex h-8 items-center gap-2.5 rounded-md px-2.5 text-muted-foreground outline-none hover:bg-sidebar-accent/60 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring max-md:h-10",
    here && "bg-sidebar-accent font-bold text-foreground",
    section.apart && "mt-3",
  );

  // The section's mark comes from the screen drawn. The router adds its own only at the link's exact address, where the two agree.
  return (
    <Link to={section.inside} {...NO_OWN_MARK} aria-current={here ? "page" : undefined} className={look}>
      <Icon className="size-4 shrink-0" />
      {section.label}
    </Link>
  );
}

/**
 * The switch between the light look and the dark one, kept in this browser. Until it is pressed the dashboard follows the system.
 */
function ThemeToggle(): ReactNode {
  const { theme, setTheme } = useTheme();
  const systemDark = useMedia(SYSTEM_DARK);
  const dark = theme === "dark" || (theme === "system" && systemDark);

  return (
    <IconButton label={dark ? "Switch to light" : "Switch to dark"} onClick={() => setTheme(dark ? "light" : "dark")} className="max-md:size-10">
      {dark ? <SunIcon /> : <MoonIcon />}
    </IconButton>
  );
}

/** The email of who is logged in, whole: where one line is too short for it, it goes on at the "@" on a second line. What follows the "@" is quieter either way. */
function Email({ className }: { readonly className?: string }): ReactNode {
  const at = Math.max(BOOT.email.lastIndexOf("@"), 0);

  return (
    <span title={BOOT.email} className={cn("flex min-w-0 flex-wrap text-xs leading-4 font-normal", className)}>
      <span className="max-w-full break-all text-foreground">{BOOT.email.slice(0, at)}</span>
      <span className="max-w-full break-all text-muted-foreground">{BOOT.email.slice(at)}</span>
    </span>
  );
}

/** The account menu: who is logged in, and the way back to the system's look. */
function AccountMenu({ compact, offer }: { readonly compact?: boolean; readonly offer: Offer | undefined }): ReactNode {
  const { theme, setTheme } = useTheme();
  const initial = BOOT.email.slice(0, 1).toUpperCase();
  const avatar = (
    <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">{initial}</span>
  );

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={`Account: ${BOOT.email}`}
        className={cn(
          "flex items-center gap-2 rounded-md text-left outline-none hover:bg-sidebar-accent/60 focus-visible:ring-2 focus-visible:ring-ring aria-expanded:bg-sidebar-accent/60",
          compact ? "p-1" : "min-h-10 w-full px-2 py-1.5",
        )}
      >
        {avatar}
        {compact ? null : (
          <>
            <Email className="flex-1" />
            <ChevronsUpDownIcon className="size-3.5 shrink-0 text-faint" />
          </>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent side={compact ? "bottom" : "top"} align={compact ? "end" : "start"} className="w-(--anchor-width) min-w-52">
        <DropdownMenuGroup>
          <DropdownMenuLabel>
            <Email />
          </DropdownMenuLabel>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuItem disabled={theme === "system"} onClick={() => setTheme("system")}>
            <MonitorIcon />
            Use system theme
          </DropdownMenuItem>
        </DropdownMenuGroup>
        {compact && offer !== undefined ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuItem onClick={offer.ask}>
                <ArrowUpCircleIcon />
                Update to {offer.newest}
              </DropdownMenuItem>
            </DropdownMenuGroup>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** What the domain needs, where the install remembers a check that left work: a link to the Domain screen, with the whole sentence behind it. A check that is only old is said quietly. */
function DomainNote({ onGo }: { readonly onGo?: () => void }): ReactNode {
  const { domainNote } = useFrame().data;
  if (domainNote === null) return null;

  const look = cn(
    "flex min-h-8 items-center gap-2 rounded-md px-2.5 text-xs leading-5 outline-none hover:bg-sidebar-accent/60 focus-visible:ring-2 focus-visible:ring-ring max-md:min-h-10",
    domainNote.quiet ? "text-faint" : "font-medium text-destructive",
  );

  return (
    <Tooltip>
      <TooltipTrigger render={<Link to="/domain" {...NO_OWN_MARK} className={look} onClick={onGo} />}>
        {domainNote.quiet ? null : <TriangleAlertIcon className="size-3.5 shrink-0" />}
        {domainNote.label}
      </TooltipTrigger>
      <TooltipContent side="right" className="max-w-64">
        {domainNote.sentence}
      </TooltipContent>
    </Tooltip>
  );
}

/** What a demo shows at the top of the working area: that the data is a sample, and the way to start it over. */
function DemoTag(): ReactNode {
  const client = useQueryClient();
  const navigate = useNavigate();
  const { label: opened } = useParams({ strict: false });
  if (BOOT.demo === null) return null;

  const { reset } = BOOT.demo;
  const startOver = async (): Promise<void> => {
    const answered = await fetch(reset, { method: "POST", redirect: "manual" }).catch(() => undefined);
    // The reset answers with a redirect, which is not followed here: any other answer but a done one is a failure.
    if (answered === undefined || (answered.type !== "opaqueredirect" && !answered.ok)) return sayRefused("The sample data was not reset. Try again.");

    // The screen stays where it is and reads its data again. Only the panel of a site the sample data no longer holds is closed.
    await client.invalidateQueries();
    if (opened !== undefined && client.getQueryState(siteKey(opened))?.status === "error") void navigate({ to: "/", search: true });

    sayDone("Sample data reset.");
  };

  return (
    <div className="flex items-center gap-1.5">
      <Tooltip>
        <TooltipTrigger render={<Badge variant="outline" className="cursor-default text-muted-foreground" />}>Demo</TooltipTrigger>
        <TooltipContent>Sample data. A reset starts it over.</TooltipContent>
      </Tooltip>
      <Button variant="ghost" size="sm" onClick={() => void startOver()}>
        <RotateCcwIcon data-icon="inline-start" />
        <span className="max-md:sr-only">Reset</span>
      </Button>
    </div>
  );
}

/** The version the install runs and, when a newer one is out, its notes and the start of the update. */
function VersionLine({ offer, started }: { readonly offer: Offer | undefined; readonly started: boolean }): ReactNode {
  const { update } = useFrame().data;

  return (
    <div className="flex flex-col items-start gap-1.5 px-2.5 text-xs leading-5 text-faint">
      <p>Running poplin {BOOT.version}</p>
      {update === null ? null : (
        <p className="text-foreground">
          {update.newest} is out.{" "}
          <a href={update.notes} target="_blank" rel="noreferrer" className="text-link underline-offset-2 hover:underline">
            What changed
          </a>
        </p>
      )}
      {update?.database === true ? (
        <p>This release changes the database, so it never starts by itself.{offer === undefined ? "" : " Press Update now."}</p>
      ) : null}
      {offer === undefined ? null : (
        <Button variant="outline" size="xs" onClick={offer.ask}>
          Update now
        </Button>
      )}
      {started ? <p>Update started.</p> : null}
    </div>
  );
}

/** The question before an update is started. An update that changes the database says that no older version reads it afterwards. */
function questionOf(newest: string, database: boolean): Question {
  const says = "The install is built again from the newest release. It takes a few minutes, and the sites stay up meanwhile.";

  return {
    title: `Update to ${newest}?`,
    says: database ? `${says} This release changes the database: no older version can read it afterwards.` : says,
    yes: "Update now",
  };
}

/**
 * Offer the start of an update where one can be started: a newer release is known and an update link is saved.
 *
 * @returns the offer for the controls that show it, `undefined` where there is none or one was just started, and the question to draw once
 */
function useOffer(): { readonly offer: Offer | undefined; readonly started: boolean; readonly question: ReactNode } {
  const { update, starts } = useFrame().data;
  const [asking, setAsking] = useState(false);
  const [started, setStarted] = useStarted();
  const answer = async (yes: boolean): Promise<void> => {
    setAsking(false);
    if (!yes) return;

    const taken = await send(api.update.$post({ json: {} }));
    if (taken === undefined) return;

    setStarted();
    sayDone("Update started. The new version runs in a few minutes.");
  };
  const question = (
    <Confirm question={asking && update !== null ? questionOf(update.newest, update.database) : undefined} onAnswer={(yes) => void answer(yes)} />
  );

  // A started update is not offered again from this page: the new version takes its place within minutes.
  return { offer: update !== null && starts && !started ? { newest: update.newest, ask: () => setAsking(true) } : undefined, started, question };
}

/** The sections on a phone: behind a button at the top, in a sheet that closes once a place is chosen. */
function PhoneSections({ current }: { readonly current: Section }): ReactNode {
  const [open, setOpen] = useState(false);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger render={<Button variant="ghost" size="icon-sm" aria-label="Sections" className="-ml-2 md:hidden" />}>
        <MenuIcon />
      </SheetTrigger>
      <SheetContent side="left" className="gap-4 bg-sidebar px-3 pt-3 pb-3 data-[side=left]:w-72">
        <SheetTitle className="flex h-10 items-center gap-2 px-2.5">
          <BrandMark />
          <span className="truncate font-bold tracking-tight">{NAME}</span>
        </SheetTitle>
        <SheetDescription className="sr-only">The sections of this dashboard.</SheetDescription>
        {/* biome-ignore lint/a11y/useKeyWithClickEvents: the press is a link's own, which a key presses too; the sheet only closes after it. */}
        <nav aria-label="Sections" className="flex flex-col gap-0.5" onClick={() => setOpen(false)}>
          {SECTIONS.map((section) => (
            <SectionLink key={section.key} section={section} current={current} />
          ))}
        </nav>
        <div className="mt-auto flex flex-col gap-2">
          <DomainNote onGo={() => setOpen(false)} />
          <p className="px-2.5 text-xs leading-5 text-faint">Running poplin {BOOT.version}</p>
          <Email className="px-2.5 pb-1" />
        </div>
      </SheetContent>
    </Sheet>
  );
}

/**
 * Draw the frame around one screen.
 *
 * @param current - the section the screen belongs to
 * @param heading - the screen's title
 * @param tools - what sits on the title's line, before the demo's tag
 */
export function AppShell({
  current,
  heading,
  tools,
  children,
}: {
  readonly current: Section;
  readonly heading: ReactNode;
  readonly tools?: ReactNode;
  readonly children: ReactNode;
}): ReactNode {
  const { offer, started, question } = useOffer();
  // The frame is drawn before the screen inside it, so every time of the screen is written in the time zone a person chose.
  useChosenTimeZone();

  return (
    <div className="grid h-svh grid-cols-[232px_minmax(0,1fr)] max-md:grid-cols-1">
      <aside className="flex min-h-0 flex-col gap-4 border-r bg-sidebar px-3 pt-4 pb-3 max-md:hidden">
        <Link to="/" {...NO_OWN_MARK} className="flex h-8 items-center gap-2 rounded-md px-2.5 outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <BrandMark />
          <span className="truncate text-base font-bold tracking-tight">{NAME}</span>
        </Link>
        <nav aria-label="Sections" className="flex flex-col gap-0.5">
          {SECTIONS.map((section) => (
            <SectionLink key={section.key} section={section} current={current} />
          ))}
        </nav>
        <div className="mt-auto flex flex-col gap-2">
          <DomainNote />
          <VersionLine offer={offer} started={started} />
          <AccountMenu offer={offer} />
        </div>
      </aside>
      <main className="flex min-h-0 min-w-0 flex-col">
        <header className="flex h-14 shrink-0 items-center gap-3 px-6 max-md:gap-2 max-md:px-4">
          <PhoneSections current={current} />
          <h1 className="min-w-0 truncate text-base font-bold">{heading}</h1>
          <div className="ml-auto flex items-center gap-2">
            {tools}
            <DemoTag />
            <ThemeToggle />
            <span className="md:hidden">
              <AccountMenu compact offer={offer} />
            </span>
          </div>
        </header>
        {children}
      </main>
      {question}
    </div>
  );
}
