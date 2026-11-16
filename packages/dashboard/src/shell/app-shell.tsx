// The frame every screen sits in: the sections at the side, each marked where its screen holds a problem, the version and the account at its foot, and the working area. On a phone the sections are behind a button at the top.

import { useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "@tanstack/react-router";
import { cn } from "cn";
import {
  ActivityIcon,
  GaugeIcon,
  GlobeIcon,
  KeyRoundIcon,
  LayoutListIcon,
  MenuIcon,
  RotateCcwIcon,
  SettingsIcon,
  TriangleAlertIcon,
} from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { api } from "@/lib/api";
import { BOOT } from "@/lib/boot";
import { useScreenFocus } from "@/lib/focus";
import { FRAME_KEY, GET_KEY, useFrame, useStarted } from "@/lib/frame";
import { sayDone, sayRefused, send } from "@/lib/notify";
import { dateIn, useChosenTimeZone } from "@/lib/timezone";
import { problemCount } from "@/problems/problem-words";
import { MarkedSection, useMarkedCount } from "@/problems/section-mark";
import { Confirm, type Question } from "@/shared/confirm";
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

/** The look of the email where it rests: blurred, and sharp under a pointer, with the focus the keys give it, and with the focus a tap gives it where a finger is the pointer. */
const EMAIL_AT_REST = "blur-xs transition-[filter] hover:blur-none focus-visible:blur-none focus-visible:ring-2 focus-visible:ring-ring pointer-coarse:focus:blur-none";

/** What keeps the router from marking a link of the frame as the place the address is at for every address under it, and from adding a class of its own. */
const NO_OWN_MARK = { activeOptions: { exact: true }, activeProps: {} } as const;

/** What stands where the start of an update would, on an install that holds no key to send one with. */
const NO_KEY = `poplin holds no key, so it cannot update itself.${GET_KEY}`;

/** The offer of a frame with nothing to start. */
const NO_OFFER: Offer = { update: undefined, back: undefined };

/** What can be started from the frame, each by what asks before it starts: the update to the newer release, and the way back to the version before. Either is `undefined` where there is none. */
interface Offer {
  readonly update: (() => void) | undefined;
  readonly back: (() => void) | undefined;
}

/** A section's key. */
export type Section = (typeof SECTIONS)[number]["key"];

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
    <MarkedSection section={section.key} link={<Link to={section.inside} {...NO_OWN_MARK} aria-current={here ? "page" : undefined} className={look} />}>
      <Icon className="size-4 shrink-0" />
      {section.label}
    </MarkedSection>
  );
}

/**
 * The email of who is logged in, whole: where one line is too short for it, it goes on at the "@" on a second line. What follows the "@" is quieter either way.
 *
 * It is blurred where it rests, so a shared screen or a screenshot does not show it. A pointer over it, the focus the keys give it, or a tap on a phone shows it sharp. A screen reader reads it either way.
 */
function Email({ className }: { readonly className?: string }): ReactNode {
  const at = Math.max(BOOT.email.lastIndexOf("@"), 0);

  return (
    // biome-ignore lint/a11y/noNoninteractiveTabindex: the keys must reach the email to show it sharp, and it does nothing a button does.
    <span title={BOOT.email} tabIndex={0} className={cn("flex min-w-0 flex-wrap rounded-sm text-xs leading-4 font-normal outline-none", EMAIL_AT_REST, className)}>
      <span className="max-w-full break-all text-foreground">{BOOT.email.slice(0, at)}</span>
      <span className="max-w-full break-all text-muted-foreground">{BOOT.email.slice(at)}</span>
    </span>
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

/** The version the install runs and since when, where it came in by an update, with the way back to the version before; and, when a newer one is out, its notes and the start of the update. */
function VersionLine({ offer, started }: { readonly offer: Offer; readonly started: boolean }): ReactNode {
  const { update, starts, back } = useFrame().data;

  return (
    <div className="flex flex-col items-start gap-1.5 px-2.5 text-xs leading-5 text-faint">
      <p>
        Running poplin {BOOT.version}
        {back === null ? "" : `, since ${dateIn(back.since)}`}
      </p>
      {back === null || offer.back === undefined ? null : (
        <Button variant="ghost" size="xs" className="-ml-2" onClick={offer.back}>
          Go back to {back.to}
        </Button>
      )}
      {update === null ? null : (
        <p className="text-foreground">
          {update.newest} is out.{" "}
          <a href={update.notes} target="_blank" rel="noreferrer" className="text-link underline-offset-2 hover:underline">
            What changed
          </a>
        </p>
      )}
      {update?.database === true ? (
        <p>This release changes the database, so it never starts by itself.{offer.update === undefined ? "" : " Press Update now."}</p>
      ) : null}
      {update !== null && !starts ? <p>{NO_KEY}</p> : null}
      {offer.update === undefined ? null : (
        <Button variant="outline" size="xs" onClick={offer.update}>
          Update now
        </Button>
      )}
      {started ? <p>Updated. Reload the page.</p> : null}
    </div>
  );
}

/** The question before an update is started. An update that changes the database says that the install cannot go back from it. */
function questionOf(newest: string, database: boolean): Question {
  const says = "poplin fetches the newest release, checks it, and puts it in place of the running code. It takes a moment, and the sites stay up meanwhile.";

  return {
    title: `Update to ${newest}?`,
    says: database ? `${says} This release changes the database: after it, poplin cannot go back to ${BOOT.version}.` : says,
    yes: "Update now",
  };
}

/** The question before the install goes back to the version before. */
function backQuestionOf(to: string): Question {
  return {
    title: `Go back to ${to}?`,
    says: `poplin fetches release ${to}, checks it, and puts it in place of the running code. It takes a moment, and the sites stay up meanwhile.`,
    yes: `Go back to ${to}`,
  };
}

/** The question of what is asked about, or none while nothing is. */
function askedOf(asking: keyof Offer | undefined, frame: Pick<ReturnType<typeof useFrame>["data"], keyof Offer>): Question | undefined {
  if (asking === "update" && frame.update !== null) return questionOf(frame.update.newest, frame.update.database);

  return asking === "back" && frame.back !== null ? backQuestionOf(frame.back.to) : undefined;
}

/**
 * Offer what can be started from the frame, on an install that holds its key: the update, where a newer release is known, and the way back, where there is one.
 *
 * @returns the offer for the controls that show it, with nothing in it where there is nothing to start or something was just started, and the question to draw once
 */
function useOffer(): { readonly offer: Offer; readonly started: boolean; readonly question: ReactNode } {
  const { update, starts, back } = useFrame().data;
  const [asking, setAsking] = useState<keyof Offer>();
  const [started, setStarted] = useStarted();
  const client = useQueryClient();
  const answer = async (yes: boolean): Promise<void> => {
    const to = asking === "back" ? back?.to : undefined;
    setAsking(undefined);
    if (!yes) return;

    const taken = await send(api.update.$post({ json: to === undefined ? {} : { to } }));
    // A try that was refused is a problem the frame marks, and one that was taken changes what the frame offers: either way it is read again.
    void client.invalidateQueries({ queryKey: FRAME_KEY });
    if (taken === undefined) return;

    setStarted();
    sayDone(to === undefined ? `Updated to ${taken.to}. Reload the page.` : `Went back to ${taken.to}. Reload the page.`);
  };
  const question = <Confirm question={askedOf(asking, { update, back })} onAnswer={(yes) => void answer(yes)} />;
  // A started update is not offered again from this page: it runs the client it was loaded with until it is loaded again.
  if (!starts || started) return { offer: NO_OFFER, started, question };

  const offer = { update: update === null ? undefined : () => setAsking("update"), back: back === null ? undefined : () => setAsking("back") };

  return { offer, started, question };
}

/** The sections on a phone: behind a button at the top, in a sheet that closes once a place is chosen or an update is asked about. */
function PhoneSections({ current, offer, started }: { readonly current: Section; readonly offer: Offer; readonly started: boolean }): ReactNode {
  const [open, setOpen] = useState(false);
  // The question of an update is drawn over the page: the sheet makes room for it.
  const closing = (ask: (() => void) | undefined): (() => void) | undefined => {
    if (ask === undefined) return undefined;

    return () => {
      setOpen(false);
      ask();
    };
  };
  const closingOffer = { update: closing(offer.update), back: closing(offer.back) };
  const marked = useMarkedCount();
  const name = marked === 0 ? "Sections" : `Sections, ${problemCount(marked)}`;

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger render={<Button variant="ghost" size="icon-sm" aria-label={name} className="relative -ml-2 md:hidden" />}>
        <MenuIcon />
        {marked === 0 ? null : <TriangleAlertIcon aria-hidden="true" className="absolute -top-0.5 -right-0.5 size-3 text-destructive" />}
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
            <VersionLine offer={closingOffer} started={started} />
            <Email className="px-2.5 py-1" />
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
  const { offer, started, question } = useOffer();
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
          <VersionLine offer={offer} started={started} />
          <Email className="px-2.5 py-1" />
        </div>
      </aside>
      <main className="flex min-h-0 min-w-0 flex-col">
        <header className="flex h-14 shrink-0 items-center gap-3 px-6 max-md:gap-2 max-md:px-4">
          <PhoneSections current={current} offer={offer} started={started} />
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
      {question}
    </div>
  );
}
