// The token block of the Domain screen and the setup screen: at the left the way to a token, at the right the box it is pasted into and the two runs.
//
// The token is never held: it is read from its box when a run is sent, and the box is emptied at once, whatever the run answers.

import { ChevronRightIcon, ExternalLinkIcon } from "lucide-react";
import { type FormEvent, type ReactNode, useId, useRef, useState } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverDescription, PopoverHeader, PopoverTitle, PopoverTrigger } from "@/components/ui/popover";
import type { Domain, Ran } from "@/domain/domain-queries";
import type { Refused } from "@/lib/api";

/** The boxes beside the token's, with the words of each: `first` for an install with nothing set, `login` for an email that corrects the first login. `empty` is what a box that must be filled says when a run is asked with nothing in it. */
const BOXES = {
  first: [
    {
      name: "domain",
      label: "Domain",
      hint: "The domain your sites will live under, alone: example.com",
      type: "text",
      autoComplete: "off",
      required: true,
      empty: "Type the domain first.",
    },
    {
      name: "login",
      label: "Your email",
      hint: "The first login. The code you log in with is sent to it.",
      type: "email",
      autoComplete: "email",
      required: true,
      empty: "Type your email first.",
    },
  ],
  login: [
    {
      name: "login",
      label: "Your email",
      hint: "Leave it empty to keep the first login. If that email was wrong, type the right one: Repair sets the login to it.",
      type: "email",
      autoComplete: "email",
      required: false,
      empty: "",
    },
  ],
} as const;

/** What the token's box says when a run is asked with no token in it. */
const NO_TOKEN = "Paste a token first.";

/** What is said at a box: the box's name, or `null` for a refusal about none, and the sentence. */
type Said = Pick<Refused, "about" | "message">;

/** What a run is sent with: the token, and what the other boxes hold. */
export interface Sent {
  readonly token: string;
  readonly domain?: string;
  readonly login?: string;
}

/** What the block is drawn from. */
interface TokenFormProps {
  /** What a token must hold and where one is made, in the provider's words. */
  readonly form: Domain["form"];

  /** The boxes beside the token's; left out, the token alone. */
  readonly boxes?: keyof typeof BOXES;

  /** Sends one run. It answers the refusal, which is shown at the box it is about, or nothing when the run read its pieces. */
  readonly onRun: (run: Ran["run"], sent: Sent) => Promise<Refused | undefined>;
}

/** Read an address a link may lead to: a whole one that starts with https. Anything else is no link, so no text that reaches the page is run by a press. */
function httpsLink(address: string): string | undefined {
  if (!URL.canParse(address)) return undefined;

  const parsed = new URL(address);

  return parsed.protocol === "https:" ? parsed.href : undefined;
}

/** The way to a token: one link to the provider's form with every needed right chosen, and behind a quiet line the rights an install works without. */
function MakeToken({ form }: { readonly form: Domain["form"] }): ReactNode {
  const needed = form.tokenRights.length;
  const link = httpsLink(form.tokenLink);

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <h2 className="font-medium">First, make a token</h2>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        {link === undefined ? null : (
          <Button variant="outline" nativeButton={false} render={<a href={link} target="_blank" rel="noreferrer" />}>
            Open the token form
            <ExternalLinkIcon data-icon="inline-end" />
          </Button>
        )}
        <Popover>
          <PopoverTrigger render={<Button variant="link" className="h-auto px-0 text-link" />}>The form opened empty?</PopoverTrigger>
          <PopoverContent align="start" className="w-80">
            <PopoverHeader>
              <PopoverTitle>The form opened empty?</PopoverTitle>
              <PopoverDescription>Add each of these {needed} rights by hand:</PopoverDescription>
            </PopoverHeader>
            <ul className="flex flex-col gap-1">
              {form.tokenRights.map((right) => (
                <li key={right} className="break-words">
                  {right}
                </li>
              ))}
            </ul>
          </PopoverContent>
        </Popover>
      </div>
      <p className="text-pretty text-muted-foreground">
        It opens in a new tab with the {needed} rights chosen. Add nothing, and create the token. {form.tokenNote}
      </p>
      {form.tokenOptional.length === 0 ? null : (
        <Collapsible className="text-muted-foreground">
          <CollapsibleTrigger className="group/fold -ml-1 flex h-7 items-center gap-1 rounded-md px-1 outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">
            <ChevronRightIcon className="size-4 transition-transform group-aria-expanded/fold:rotate-90" aria-hidden="true" />
            Optional: block junk traffic and crawlers
          </CollapsibleTrigger>
          <CollapsibleContent className="flex flex-col gap-1 pt-1 pl-5">
            <ul className="flex flex-col gap-1">
              {form.tokenOptional.map((entry) => (
                <li key={entry.right} className="break-words">
                  <Badge variant="outline" className="align-baseline">
                    {entry.right}
                  </Badge>{" "}
                  {entry.adds}
                </li>
              ))}
            </ul>
            <p className="text-pretty">Add any of them to the token on the form, then press Repair.</p>
          </CollapsibleContent>
        </Collapsible>
      )}
    </div>
  );
}

/**
 * Draw the token block.
 *
 * Repair is the form's own button, so Enter repairs. A refusal about a box is said under that box, which takes the focus; any other is said over the buttons.
 */
export function TokenForm({ form, boxes, onRun }: TokenFormProps): ReactNode {
  const id = useId();
  const fields = useRef<HTMLFormElement>(null);
  const [refusal, setRefusal] = useState<Said>();
  const [busy, setBusy] = useState<Ran["run"]>();
  const others = boxes === undefined ? [] : BOXES[boxes];
  const refusedAt = (name: string): string | undefined => (refusal?.about === name ? refusal.message : undefined);
  const elsewhere = refusal !== undefined && !["token", ...others.map((box) => box.name)].includes(refusal.about ?? "");

  const send = async (run: Ran["run"]): Promise<void> => {
    const sheet = fields.current;
    if (sheet === null || busy !== undefined) return;

    const typed = new FormData(sheet);
    const text = (name: string): string => String(typed.get(name) ?? "");
    const say = (said: Said | undefined): void => {
      setRefusal(said);
      if (said?.about !== null && said?.about !== undefined) (sheet.elements.namedItem(said.about) as HTMLInputElement | null)?.focus();
    };
    // A box that must be filled and is empty is said at that box, and nothing is sent: the token stays where it was pasted.
    const unfilled = [...others.filter((box) => box.required), { name: "token", empty: NO_TOKEN }].find((box) => text(box.name).trim() === "");
    if (unfilled !== undefined) {
      say({ about: unfilled.name, message: unfilled.empty });

      return;
    }

    const token = sheet.elements.namedItem("token") as HTMLInputElement;
    const sent = { token: text("token"), ...Object.fromEntries(others.map((box) => [box.name, text(box.name)])) };
    token.value = "";
    setBusy(run);
    say(await onRun(run, sent).finally(() => setBusy(undefined)));
  };
  const onSubmit = (event: FormEvent): void => {
    event.preventDefault();
    void send("repair");
  };
  // Where the email only corrects a login, the token's box comes first: it is the one the heading speaks of.
  const tokenBox = (
    <Field data-invalid={refusedAt("token") !== undefined}>
      <FieldLabel htmlFor={`${id}-token`}>{form.tokenLabel}</FieldLabel>
      <Input id={`${id}-token`} name="token" type="password" autoComplete="off" required aria-invalid={refusedAt("token") !== undefined} />
      {refusedAt("token") === undefined ? (
        <FieldDescription>Used for this one request. Not stored. Never shown again.</FieldDescription>
      ) : (
        <FieldError className="text-pretty">{refusedAt("token")}</FieldError>
      )}
    </Field>
  );

  return (
    <div className="@container">
      <div className="grid grid-cols-1 gap-x-12 gap-y-6 @3xl:grid-cols-2">
        <MakeToken form={form} />
        <form ref={fields} onSubmit={onSubmit} className="flex min-w-0 flex-col gap-3" noValidate>
          <h2 className="font-medium">{boxes === "first" ? "Then fill in the three boxes" : "Then paste it here"}</h2>
          <FieldGroup className="gap-3">
            {boxes === "login" ? tokenBox : null}
            {others.map((box) => (
              <Field key={box.name} data-invalid={refusedAt(box.name) !== undefined}>
                <FieldLabel htmlFor={`${id}-${box.name}`}>{box.label}</FieldLabel>
                <Input
                  id={`${id}-${box.name}`}
                  name={box.name}
                  type={box.type}
                  autoComplete={box.autoComplete}
                  spellCheck={false}
                  required={box.required}
                  aria-invalid={refusedAt(box.name) !== undefined}
                />
                {refusedAt(box.name) === undefined ? (
                  <FieldDescription>{box.hint}</FieldDescription>
                ) : (
                  <FieldError className="text-pretty">{refusedAt(box.name)}</FieldError>
                )}
              </Field>
            ))}
            {boxes === "login" ? null : tokenBox}
          </FieldGroup>
          {elsewhere ? (
            <Alert variant="destructive">
              <AlertDescription>{refusal.message}</AlertDescription>
            </Alert>
          ) : null}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <Button type="submit" disabled={busy !== undefined}>
              {busy === "repair" ? "Repairing" : "Repair"}
            </Button>
            <Button type="button" variant="outline" disabled={busy !== undefined} onClick={() => void send("check")}>
              {busy === "check" ? "Checking" : "Check"}
            </Button>
          </div>
          <p className="text-pretty text-muted-foreground">Repair makes every piece match, and is safe to repeat. Check changes nothing.</p>
        </form>
      </div>
    </div>
  );
}
