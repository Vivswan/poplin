// The review of one waiting login: what it asks for, the name it gave, the role it has once approved, when its token expires, the code the person types or pastes from their terminal, and Approve or Deny. The page never holds that code.
//
// Anyone can begin a login, so nothing the login says of itself is the page's own words: its name is a quoted fact, and what it may change starts at the least, whatever it asked for.

import { fillsUserCode, MAX_TYPED_LENGTH, USER_CODE_SHAPE } from "@poplin/core/src/auth/computer-logins";
import { defaultExpiry } from "@poplin/core/src/auth/tokens";
import { type FormEvent, type ReactNode, type RefObject, useRef, useState } from "react";

import type { AccessActions, Decision } from "@/access/access-actions";
import type { Review } from "@/access/access-queries";
import { ROLE_WORDS, SCOPE_WORDS } from "@/access/access-values";
import { ExpiresChoice } from "@/access/tokens/expires-choice";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { type Expiry, sentFor } from "@/dialog/expiry/expiry-moments";
import { thenHome } from "@/lib/focus";
import { shortMoment, wholeMoment } from "@/lib/sites";
import { useOnePress } from "@/dialog/one-press";
import { PanelFact, PanelFacts } from "@/shared/side-panel";

/** The scopes a computer that asked for everything can be let in with, the least first. */
const CHOICES = ["publisher", "admin"] as const;

/** What each role of the choice may change, said where it is chosen. */
const ROLES_GIVE = "A publisher changes its own sites only. An admin changes every site, the settings, and who has access.";

/** What the review says first, by how the person came: one who came by an address, and pressed nothing here, is told that a link proves nothing. */
const SAYS_FIRST = {
  listed: "Approve it only if you started this login yourself.",
  linked: "Anyone can start a login and send its link. Approve this one only if you just started it, and its code is on your screen.",
} as const;

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

/** The role an approved machine has: the choice of two for one that asked for everything, plain words for one that did not. */
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
          {ROLE_WORDS[choice]}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}

/** The check that the login is the person's own: the page knows no part of its code, and the person types or pastes the whole of it from the terminal, which only the one who began the login has. */
function TypedCode({
  typed,
  refusal,
  field,
  onType,
}: {
  readonly typed: string;
  readonly refusal: string | undefined;
  readonly field: RefObject<HTMLInputElement | null>;
  readonly onType: (typed: string) => void;
}): ReactNode {
  return (
    <Field invalid={refusal !== undefined} className="gap-1.5 border-t pt-4">
      <FieldLabel className="font-normal">Code from your terminal</FieldLabel>
      <div>
        <Input
          ref={field}
          value={typed}
          aria-required
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          maxLength={MAX_TYPED_LENGTH}
          placeholder={USER_CODE_SHAPE}
          className="w-32 font-mono uppercase max-md:h-10"
          onChange={(event) => onType(event.target.value)}
        />
      </div>
      <div className="min-h-5 max-md:min-h-10">
        {refusal === undefined ? (
          <FieldDescription className="text-[13px]">Type or paste it to approve.</FieldDescription>
        ) : (
          <FieldError className="text-[13px]">{refusal}</FieldError>
        )}
      </div>
    </Field>
  );
}

/** The inside of the review of one login. A login that follows another starts with nothing typed, at the least it may change, and at the expiry of that role. */
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
  const field = useRef<HTMLInputElement>(null);
  const [typed, setTyped] = useState("");
  const [scope, setScope] = useState<Review["scope"]>("publisher");
  // When the token expires: what the person picked, and until they pick, what a token of the chosen role lasts, counted from the moment the review opened.
  const [opened] = useState(() => Date.now());
  const [picked, setPicked] = useState<Expiry>();
  const expires = picked ?? defaultExpiry(scope, opened);
  const [refusal, setRefusal] = useState<string>();
  // The answer is acted on only while this login is still the one under review: a review that was left, even one still fading out, does not close the one that followed it.
  const { press: decide, busy } = useOnePress(async (decision: Decision): Promise<void> => {
    const decided = await actions.decide(decision, login.scope);
    if (under.current?.id !== login.id) return;

    if (decided.kind === "done" || decided.kind === "gone") return onClose();

    if (decided.kind !== "code") return;

    setRefusal(decided.sentence);
    field.current?.focus();
  });
  const type = (code: string): void => {
    setTyped(code);
    setRefusal(undefined);
  };

  // Enter in the field does what Approve does, and nothing while Approve is off.
  const allow = (event: FormEvent): void => {
    event.preventDefault();
    decide({ login: login.id, allow: true, scope, code: typed, expires: sentFor(expires) });
  };

  return (
    <form onSubmit={allow} className="contents">
      <DialogHeader>
        <DialogTitle className="pr-8">Approve this login?</DialogTitle>
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
        <dt className="flex min-h-7 items-center text-muted-foreground max-md:col-span-2 max-md:min-h-0">Expires</dt>
        <dd className="flex min-h-7 items-center max-md:col-span-2">
          <ExpiresChoice expires={expires} scope={scope} onChoose={setPicked} />
        </dd>
      </PanelFacts>
      {login.scope === "admin" ? <p className="text-[13px] text-muted-foreground">{ROLES_GIVE}</p> : null}
      <TypedCode typed={typed} refusal={refusal} field={field} onType={type} />
      <DialogFooter>
        <Button type="button" variant="outline" disabled={busy} onClick={() => decide({ login: login.id, allow: false })}>
          Deny
        </Button>
        <Button type="submit" disabled={busy || !fillsUserCode(typed)}>
          Approve
        </Button>
      </DialogFooter>
    </form>
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
