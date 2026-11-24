// The frame every screen sits in: the sections at the side, each marked where its screen holds a problem or the start of an update, the account at its foot, and the working area. On a phone the sections are behind a button at the top.

import { useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "@tanstack/react-router";
import { cn } from "cn";
import {
  ActivityIcon,
  ChevronsUpDownIcon,
  GaugeIcon,
  GlobeIcon,
  KeyRoundIcon,
  LayoutListIcon,
  MenuIcon,
  RotateCcwIcon,
  SettingsIcon,
} from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent, SheetDescription, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { BOOT } from "@/lib/boot";
import { useScreenFocus } from "@/lib/focus";
import { useFrame } from "@/lib/frame";
import { sayDone, sayRefused } from "@/lib/notify";
import { useChosenTimeZone } from "@/lib/timezone";
import { MarkedSection, MarkSign, useSectionMark, useSectionsMark } from "@/problems/section-mark";
import { ThemeButton } from "@/shell/theme-button";
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

/** The look of the way past the sections: over the page's corner, and in sight only while it holds the focus after a key. */
const SKIP_LOOK = "pointer-events-none absolute top-2 left-2 z-50 opacity-0 focus-visible:pointer-events-auto focus-visible:opacity-100";

/** The look of the email where it rests: blurred, and sharp while a pointer is over its button, while the button holds the focus the keys give it or the one a tap gives it where a finger is the pointer, and while its menu is open. */
const EMAIL_AT_REST =
  "blur-xs transition-[filter] group-hover/account:blur-none group-focus-visible/account:blur-none group-aria-expanded/account:blur-none pointer-coarse:group-focus/account:blur-none";

/** What the way out of this browser's login is called. */
const SIGN_OUT = "Sign out";

/** The console's path that sends a browser on to where the provider ends its login. */
const OUT_PATH = "/out";

/** What keeps the router from marking a link of the frame as the place the address is at for every address under it, and from adding a class of its own. */
const NO_OWN_MARK = { activeOptions: { exact: true }, activeProps: {} } as const;

/** A section's key. */
export type Section = (typeof SECTIONS)[number]["key"];

/** The product's mark. */
function BrandMark(): ReactNode {
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
  const mark = useSectionMark(section.key);
  const look = cn(
    "flex h-8 items-center gap-2.5 rounded-md px-2.5 text-muted-foreground outline-none hover:bg-sidebar-accent/60 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring max-md:h-10",
    here && "bg-sidebar-accent font-bold text-foreground",
    section.apart && "mt-3",
  );

  // The section's mark comes from the screen drawn. The router adds its own only at the link's exact address, where the two agree.
  // A mark that is about one line of the screen leads to that line.
  return (
    <MarkedSection mark={mark} link={<Link to={section.inside} hash={mark?.at} {...NO_OWN_MARK} aria-current={here ? "page" : undefined} className={look} />}>
      <Icon className="size-4 shrink-0" />
      {section.label}
    </MarkedSection>
  );
}

/**
 * Who is logged in: the email, whole, as the button of a small menu that opens over it and holds the way out of this browser's login.
 * Where one line is too short for the email, it goes on at the "@" on a second line. What follows the "@" is quieter either way.
 *
 * The email is blurred where it rests, so a shared screen or a screenshot does not show it, and sharp as `EMAIL_AT_REST` says. A screen reader reads it either way.
 * The way out is a link to the console's own path that sends the browser on to where the provider ends the login. It asks the server for the page, as no screen of the dashboard answers there.
 */
function Account(): ReactNode {
  const at = Math.max(BOOT.email.lastIndexOf("@"), 0);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<Button variant="ghost" title={BOOT.email} className="group/account h-auto w-full justify-start gap-2 px-2.5 py-1 text-left text-xs leading-4 font-normal whitespace-normal pointer-coarse:min-h-10" />}
      >
        <span className={cn("flex min-w-0 flex-1 flex-wrap", EMAIL_AT_REST)}>
          <span className="max-w-full break-all text-foreground">{BOOT.email.slice(0, at)}</span>
          <span className="max-w-full break-all text-muted-foreground">{BOOT.email.slice(at)}</span>
        </span>
        <ChevronsUpDownIcon className="text-muted-foreground" aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="start" className="w-(--anchor-width) min-w-40">
        <DropdownMenuItem render={<Link to={OUT_PATH} reloadDocument {...NO_OWN_MARK} />}>{SIGN_OUT}</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** The reminder that the last check of the domain is old: a quiet link to the Domain screen, with the whole sentence behind it. A domain that needs work is marked at its section, as every problem is. */
function DomainNote({ onGo }: { readonly onGo?: () => void }): ReactNode {
  const { domainNote } = useFrame().data;
  if (domainNote === null || !domainNote.quiet) return null;

  const look =
    "flex min-h-8 items-center gap-2 rounded-md px-2.5 text-xs leading-5 text-faint outline-none hover:bg-sidebar-accent/60 focus-visible:ring-2 focus-visible:ring-ring max-md:min-h-10";

  return (
    <Tooltip>
      <TooltipTrigger render={<Link to="/domain" {...NO_OWN_MARK} className={look} onClick={onGo} />}>
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

    // A line said before the reset speaks of data that is gone, and its Undo would act on it.
    toast.dismiss();
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

/** The sections on a phone: behind a button at the top, which carries the mark of them all, in a sheet that closes once a place is chosen. */
function PhoneSections({ current }: { readonly current: Section }): ReactNode {
  const [open, setOpen] = useState(false);
  const mark = useSectionsMark();
  const name = mark === null ? "Sections" : `Sections, ${mark.name}`;

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger render={<Button variant="ghost" size="icon-sm" aria-label={name} className="relative -ml-2 md:hidden" />}>
        <MenuIcon />
        {mark === null ? null : <MarkSign kind={mark.kind} className="absolute top-1/2 left-1/2 size-3 translate-x-0.5 -translate-y-3.5 rounded-full bg-background" />}
      </SheetTrigger>
      <SheetContent side="left" className="gap-0 bg-sidebar data-[side=left]:w-72">
        <SheetTitle className="mx-3 mt-3 flex h-10 shrink-0 items-center gap-2 px-2.5">
          <BrandMark />
          <span className="truncate font-bold tracking-tight">{NAME}</span>
        </SheetTitle>
        <SheetDescription className="sr-only">The sections of this dashboard.</SheetDescription>
        {/* A phone lying on its side is shorter than what the sheet holds: what is under the name scrolls, and the name and Close stay in sight. */}
        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-3 pt-4 pb-3">
          {/* biome-ignore lint/a11y/useKeyWithClickEvents: the press is a link's own, which a key presses too; the sheet only closes after it. */}
          <nav aria-label="Sections" className="flex flex-col gap-0.5" onClick={() => setOpen(false)}>
            {SECTIONS.map((section) => (
              <SectionLink key={section.key} section={section} current={current} />
            ))}
          </nav>
          <div className="mt-auto flex flex-col gap-2">
            <DomainNote onGo={() => setOpen(false)} />
            <Account />
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

/**
 * Draw the frame around one screen.
 *
 * @param current - the section the screen belongs to
 * @param heading - the screen's title, which the page's own title starts with
 * @param tools - what sits on the title's line, before the demo's tag
 */
export function AppShell({
  current,
  heading,
  tools,
  children,
}: {
  readonly current: Section;
  readonly heading: string;
  readonly tools?: ReactNode;
  readonly children: ReactNode;
}): ReactNode {
  // The frame is drawn before the screen inside it, so every time of the screen is written in the time zone a person chose.
  useChosenTimeZone();
  const title = useScreenFocus(heading);
  useEffect(() => {
    document.title = `${heading} - ${NAME}`;
  }, [heading]);

  return (
    <div className="grid h-svh grid-cols-[232px_minmax(0,1fr)] max-md:grid-cols-1">
      {/* The first stop of the Tab key, in sight only while it holds the focus: it leads past the sections to the screen. */}
      <Button variant="outline" size="sm" className={SKIP_LOOK} onClick={() => title.ref.current?.focus()}>
        Skip to the content
      </Button>
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
          <Account />
        </div>
      </aside>
      <main className="flex min-h-0 min-w-0 flex-col">
        <header className="flex h-14 shrink-0 items-center gap-3 px-6 max-md:gap-2 max-md:px-4">
          <PhoneSections current={current} />
          <h1 {...title} className="min-w-0 truncate text-base font-bold outline-none">
            {heading}
          </h1>
          <div className="ml-auto flex items-center gap-2">
            {tools}
            <DemoTag />
            <ThemeButton />
          </div>
        </header>
        {children}
      </main>
    </div>
  );
}
