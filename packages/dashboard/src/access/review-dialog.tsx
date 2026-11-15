// The review of one waiting login: what it asks for, the name it gave, what it may change once allowed, the letters of its code that the person types from their terminal, and Allow or Deny. A login's code is shown whole nowhere.
//
// Anyone can begin a login, so nothing the login says of itself is the page's own words: its name is a quoted fact, and what it may change starts at the least, whatever it asked for.

import { useMutation } from "@tanstack/react-query";
import { type ReactNode, type RefObject, useId, useRef, useState } from "react";

import type { AccessActions } from "@/access/access-actions";
import type { Review } from "@/access/access-queries";
import { SCOPE_WORDS } from "@/access/access-values";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { thenHome } from "@/lib/focus";
import { shortMoment, wholeMoment } from "@/lib/sites";
import { PanelFact, PanelFacts } from "@/shared/side-panel";

/** The scopes a computer that asked for everything can be let in with, the least first. */
const CHOICES = ["publisher", "admin"] as const;

/** What the wider choice gives, said where it is chosen. */
const EVERYTHING_GIVES = "Everything means every site, the settings, and who has access.";

/** What the review says first, by how the person came: one who came by an address, and pressed nothing here, is told that a link proves nothing. */
const SAYS_FIRST = {
  listed: "Allow it only if you started this login yourself.",
  linked: "Anyone can start a login and send its link. Allow this one only if you just started it, and its code is on your screen.",
} as const;

/** How many letters at the end of a code the person types. */
const TYPED_LETTERS = 4;

/** What a person may type between the letters of a code. */
const CODE_SEPARATORS = /[\s-]/g;

/** What a review is drawn from. */
interface ReviewDialogProps {
  /** The login under review; `undefined` shows no dialog. */
  readonly login: Review | undefined;

  /** Whether the person came by an address, which anyone can send, and not by a press on this screen. */
  readonly byLink?: boolean;

  /** The changes of the screen. */
  readonly actions: AccessActions;

  /** Called when the review ends: decided, gone, Escape, or a press outside. */
  readonly onClose: () => void;

  /** What takes the focus when the review closes: the control that opened it. */
  readonly returnTo?: RefObject<HTMLElement | null>;
}

/** The name a computer gave itself, in quotes: a fact about the login, never words of the page. Its letters keep their own direction and turn nothing beside them. */
function GivenName({ computer }: { readonly computer: string }): ReactNode {
  if (computer.trim() === "") return <span className="text-muted-foreground">None</span>;

  return (
    <span className="wrap-anywhere">
      "<bdi>{computer}</bdi>"
    </span>
  );
}

/** What an allowed computer may change: the choice of two for one that asked for everything, plain words for one that did not. */
function ScopeChoice({
  asked,
  scope,
  onChoose,
}: {
  readonly asked: Review["scope"];
  readonly scope: Review["scope"];
  readonly onChoose: (scope: Review["scope"]) => void;
}): ReactNode {
  if (asked !== "admin") return SCOPE_WORDS[asked];

  return (
    <ToggleGroup
      aria-label="Can change"
      value={[scope]}
      onValueChange={(value) => (value[0] === undefined ? undefined : onChoose(value[0] as Review["scope"]))}
      variant="outline"
      size="sm"
      spacing={0}
      className="max-md:w-full"
    >
      {CHOICES.map((choice) => (
        <ToggleGroupItem key={choice} value={choice} className="w-31 aria-pressed:bg-chosen aria-pressed:font-bold max-md:min-h-10 max-md:w-auto max-md:flex-1">
          {SCOPE_WORDS[choice]}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}

/** How what was typed stands to a code: its last letters or the whole of it, not yet as long as those, or other letters. Capitals, spaces, and dashes are the typist's to choose. */
function typedAgainst(typed: string, code: string): "same" | "short" | "other" {
  const [given, letters] = [typed, code].map((text) => text.replace(CODE_SEPARATORS, "").toUpperCase()) as [string, string];
  if (given === letters || given === letters.slice(-TYPED_LETTERS)) return "same";

  return given.length < TYPED_LETTERS ? "short" : "other";
}

/** The check that the login is the person's own: the code is not shown whole, and its last letters are typed from the terminal, which only the one who began the login has. */
function TypedCode({ code, onMatch }: { readonly code: string; readonly onMatch: (matches: boolean) => void }): ReactNode {
  const id = useId();
  const [typed, setTyped] = useState("");
  const wrong = typedAgainst(typed, code) === "other";

  return (
    <Field data-invalid={wrong} className="gap-1.5 border-t pt-4">
      <FieldLabel htmlFor={id} className="font-normal">
        Last {TYPED_LETTERS} letters of the code in your terminal
      </FieldLabel>
      <div>
        <Input
          id={id}
          value={typed}
          aria-invalid={wrong}
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          maxLength={code.length}
          className="w-28 font-mono uppercase max-md:h-10"
          onChange={(event) => {
            setTyped(event.target.value);
            onMatch(typedAgainst(event.target.value, code) === "same");
          }}
        />
      </div>
      <div className="min-h-5 max-md:min-h-10">
        {wrong ? (
          <FieldError className="text-[13px]">Those are not the last letters of this login's code.</FieldError>
        ) : (
          <FieldDescription className="text-[13px]">
            It starts <span className="font-mono">{code.slice(0, code.length - TYPED_LETTERS)}</span>. Type the rest to allow.
          </FieldDescription>
        )}
      </div>
    </Field>
  );
}

/** The inside of the review of one login. A login that follows another starts with nothing typed, and at the least it may change. */
function ReviewForm({
  login,
  byLink,
  actions,
  onClose,
  under,
}: {
  readonly login: Review;
  readonly byLink: boolean;
  readonly actions: AccessActions;
  readonly onClose: () => void;
  readonly under: RefObject<Review | undefined>;
}): ReactNode {
  const [confirmed, setConfirmed] = useState(false);
  const [scope, setScope] = useState<Review["scope"]>("publisher");
  const sending = useMutation({ mutationFn: (allow: boolean) => actions.decide(login, { allow, confirm: confirmed, scope }) });
  const busy = sending.isPending;

  // The answer is acted on only while this login is still the one under review: a review that was left, even one still fading out, does not close the one that followed it.
  const decide = (allow: boolean): void =>
    sending.mutate(allow, {
      onSuccess: (decided) => (under.current?.id === login.id && decided.kind !== "refused" ? onClose() : undefined),
    });

  return (
    <>
      <DialogHeader>
        <DialogTitle className="pr-8">Allow this login?</DialogTitle>
        <DialogDescription className={byLink ? "text-foreground" : undefined}>{SAYS_FIRST[byLink ? "linked" : "listed"]}</DialogDescription>
      </DialogHeader>
      <PanelFacts>
        <PanelFact name="Name it gave">
          <GivenName computer={login.computer} />
        </PanelFact>
        <PanelFact name="Asked">
          <time dateTime={new Date(login.asked).toISOString()} title={wholeMoment(login.asked)}>
            {shortMoment(login.asked)}
          </time>
        </PanelFact>
        <PanelFact name="Waits until">{wholeMoment(login.expires)}</PanelFact>
        <PanelFact name="Asks for">{SCOPE_WORDS[login.scope]}</PanelFact>
        <dt className="flex min-h-7 items-center text-muted-foreground max-md:col-span-2 max-md:min-h-0">Can change</dt>
        <dd className="flex min-h-7 items-center max-md:col-span-2">
          <ScopeChoice asked={login.scope} scope={scope} onChoose={setScope} />
        </dd>
      </PanelFacts>
      {login.scope === "admin" ? <p className="text-[13px] text-muted-foreground">{EVERYTHING_GIVES}</p> : null}
      <TypedCode code={login.code} onMatch={setConfirmed} />
      <DialogFooter>
        <Button type="button" variant="outline" disabled={busy} onClick={() => decide(false)}>
          Deny
        </Button>
        <Button type="button" disabled={busy || !confirmed} onClick={() => decide(true)}>
          Allow
        </Button>
      </DialogFooter>
    </>
  );
}

/** Draw the review of a waiting login in a dialog over the lists. */
export function ReviewDialog({ login, byLink = false, actions, onClose, returnTo }: ReviewDialogProps): ReactNode {
  // The login, and how the person came to it, stay while the dialog closes, so it does not change as it fades.
  const last = useRef({ login, byLink });
  if (login !== undefined) last.current = { login, byLink };

  // The login under review at this moment: none while the dialog is closed or closing.
  const under = useRef(login);
  under.current = login;

  const shown = last.current;

  return (
    <Dialog open={login !== undefined} onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent className="gap-4 sm:max-w-md" finalFocus={thenHome(returnTo)}>
        {shown.login === undefined ? null : <ReviewForm key={shown.login.id} login={shown.login} byLink={shown.byLink} actions={actions} onClose={onClose} under={under} />}
      </DialogContent>
    </Dialog>
  );
}
