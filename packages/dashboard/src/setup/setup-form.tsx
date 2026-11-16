// The form of the setup screen, one column read top to bottom: make a token, fill in the boxes, press Repair.
// An install with nothing set first asks its kind: under a domain of the person's own, which it is then asked with the first login, or with none, which asks the first login alone.
// One nobody has logged in to takes an email that corrects the first login.

import type { FormEvent, ReactNode } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Step } from "@/domain/step";
import { TokenBox } from "@/domain/token-box";
import { type Sent, useTokenRun } from "@/domain/token-run";
import { TokenWay } from "@/domain/token-way";
import type { Refused } from "@/lib/api";
import { useUnsavedTyping } from "@/lib/unsaved";
import { type Kind, type Boxes, type Start, shownOf } from "@/setup/setup-start";

/** The box an install with nothing set is asked its domain in. */
const DOMAIN = { name: "domain", label: "Domain", hint: "Your sites live under it: example.com", inputMode: "text", autoComplete: "off", empty: "Type the domain first." } as const;

/** The box of the first login, which must be filled. */
const FIRST_LOGIN = { name: "login", label: "Your email", hint: "Your login code is sent here.", inputMode: "email", autoComplete: "email", empty: "Type your email first." } as const;

/** The box of an email that corrects the first login, which may stay empty. */
const OTHER_LOGIN = { name: "login", label: "Your email", hint: "Leave empty to keep the first login.", inputMode: "email", autoComplete: "email" } as const;

/** Each form: what its second step is called, and its boxes before and after the token's. Where the email only corrects a login the token's box comes first. */
const FORMS = {
  domain: { title: "Fill in three boxes", before: [DOMAIN, FIRST_LOGIN], after: [] },
  "no-domain": { title: "Fill in two boxes", before: [FIRST_LOGIN], after: [] },
  login: { title: "Paste it", before: [], after: [OTHER_LOGIN] },
} as const satisfies Readonly<Record<Boxes, object>>;

/** The kinds of install a person chooses from, in the words of the choice. */
const KINDS: readonly { readonly kind: Kind; readonly label: string }[] = [
  { kind: "domain", label: "Your domain" },
  { kind: "no-domain", label: "No domain" },
];

/** One box beside the token's. */
type Box = typeof DOMAIN | typeof FIRST_LOGIN | typeof OTHER_LOGIN;

/** What the form is drawn from. */
interface SetupFormProps {
  /** Which boxes the form has, and what a token must hold, in the provider's words. */
  readonly start: Start;

  /** The kind of install chosen. */
  readonly kind: Kind;

  /** Called with the kind a person chooses. */
  readonly onKind: (kind: Kind) => void;

  /** Sends the repair. It answers the refusal, which is shown at the box it is about, or nothing when the run read its pieces. */
  readonly onRepair: (sent: Sent) => Promise<Refused | undefined>;
}

/** One box with its note, or the refusal said in the note's place. The box holds no rule the browser checks: the server alone refuses, in a sentence the box shows. */
function TypedBox({ box, refusal }: { readonly box: Box; readonly refusal: string | undefined }): ReactNode {
  return (
    <Field invalid={refusal !== undefined}>
      <FieldLabel>{box.label}</FieldLabel>
      <Input name={box.name} inputMode={box.inputMode} autoComplete={box.autoComplete} spellCheck={false} aria-required={"empty" in box} />
      {refusal === undefined ? <FieldDescription>{box.hint}</FieldDescription> : <FieldError className="text-pretty">{refusal}</FieldError>}
    </Field>
  );
}

/** Draw the form. A refusal about a box is said under that box, any other over the button. */
export function SetupForm({ start, kind, onKind, onRepair }: SetupFormProps): ReactNode {
  const { boxes, form } = shownOf(start, kind);
  const { title, before, after } = FORMS[boxes];
  const { sheet, busy, saidAt, saidElsewhere, send, forget } = useTokenRun([...before, ...after], (_run, sent) => onRepair(sent));
  const typed = useUnsavedTyping();
  const onSubmit = (event: FormEvent): void => {
    event.preventDefault();
    void send("repair");
  };
  // What was said was about the other kind's boxes.
  const choose = (chosen: Kind): void => {
    forget();
    onKind(chosen);
  };
  const steps = (
    <ol className="flex flex-col gap-6">
      <Step number={1} title="Make an account token">
        <TokenWay form={form} />
      </Step>
      <Step number={2} title={title}>
        <FieldGroup className="gap-4">
          {before.map((box) => (
            <TypedBox key={box.name} box={box} refusal={saidAt(box.name)} />
          ))}
          <TokenBox refusal={saidAt("token")} />
          {after.map((box) => (
            <TypedBox key={box.name} box={box} refusal={saidAt(box.name)} />
          ))}
        </FieldGroup>
      </Step>
    </ol>
  );

  return (
    <form ref={sheet} onSubmit={onSubmit} onInput={typed} className="flex max-w-md flex-col gap-6" noValidate>
      {boxes === "login" ? (
        steps
      ) : (
        <Tabs value={kind} onValueChange={(chosen: Kind) => choose(chosen)} className="gap-6">
          <TabsList aria-label="Where your sites answer">
            {KINDS.map((one) => (
              <TabsTrigger key={one.kind} value={one.kind} className="px-3">
                {one.label}
              </TabsTrigger>
            ))}
          </TabsList>
          <TabsContent value={kind}>{steps}</TabsContent>
        </Tabs>
      )}
      {saidElsewhere === undefined ? null : (
        <Alert variant="destructive">
          <AlertDescription>{saidElsewhere}</AlertDescription>
        </Alert>
      )}
      <Button type="submit" disabled={busy !== undefined} className="w-fit">
        {busy === undefined ? null : <Spinner data-icon="inline-start" aria-hidden="true" />}
        {busy === undefined ? "Repair" : "Repairing"}
      </Button>
    </form>
  );
}
