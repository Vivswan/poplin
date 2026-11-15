// The form of the setup screen, one column read top to bottom: make a token, fill in the boxes, press Repair. An install with nothing set is asked its domain and first login; one nobody has logged in to takes an email that corrects the first login.

import { type FormEvent, type ReactNode, useId } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import type { Domain } from "@/domain/domain-queries";
import { Step } from "@/domain/step";
import { TokenBox } from "@/domain/token-box";
import { type Sent, useTokenRun } from "@/domain/token-run";
import { TokenWay } from "@/domain/token-way";
import type { Refused } from "@/lib/api";

/** The box an install with nothing set is asked its domain in. */
const DOMAIN = { name: "domain", label: "Domain", hint: "Your sites live under it: example.com", type: "text", autoComplete: "off", empty: "Type the domain first." } as const;

/** The box of the first login, which must be filled. */
const FIRST_LOGIN = { name: "login", label: "Your email", hint: "Your login code is sent here.", type: "email", autoComplete: "email", empty: "Type your email first." } as const;

/** The box of an email that corrects the first login, which may stay empty. */
const OTHER_LOGIN = { name: "login", label: "Your email", hint: "Leave empty to keep the first login.", type: "email", autoComplete: "email" } as const;

/** The form of each install: what its second step is called, and its boxes before and after the token's. Where the email only corrects a login the token's box comes first. */
const FORMS = {
  first: { title: "Fill in three boxes", before: [DOMAIN, FIRST_LOGIN], after: [] },
  login: { title: "Paste it", before: [], after: [OTHER_LOGIN] },
} as const;

/** One box beside the token's. */
type Box = typeof DOMAIN | typeof FIRST_LOGIN | typeof OTHER_LOGIN;

/** What the form is drawn from. */
interface SetupFormProps {
  /** What a token must hold and where one is made, in the provider's words. */
  readonly form: Domain["form"];

  /** Which install the form is of. */
  readonly boxes: keyof typeof FORMS;

  /** Sends the repair. It answers the refusal, which is shown at the box it is about, or nothing when the run read its pieces. */
  readonly onRepair: (sent: Sent) => Promise<Refused | undefined>;
}

/** One box with its note, or the refusal said in the note's place. */
function TypedBox({ box, refusal }: { readonly box: Box; readonly refusal: string | undefined }): ReactNode {
  const id = useId();

  return (
    <Field data-invalid={refusal !== undefined}>
      <FieldLabel htmlFor={id}>{box.label}</FieldLabel>
      <Input id={id} name={box.name} type={box.type} autoComplete={box.autoComplete} spellCheck={false} required={"empty" in box} aria-invalid={refusal !== undefined} />
      {refusal === undefined ? <FieldDescription>{box.hint}</FieldDescription> : <FieldError className="text-pretty">{refusal}</FieldError>}
    </Field>
  );
}

/** Draw the form. A refusal about a box is said under that box, any other over the button. */
export function SetupForm({ form, boxes, onRepair }: SetupFormProps): ReactNode {
  const { title, before, after } = FORMS[boxes];
  const { sheet, busy, saidAt, saidElsewhere, send } = useTokenRun([...before, ...after], (_run, sent) => onRepair(sent));
  const onSubmit = (event: FormEvent): void => {
    event.preventDefault();
    void send("repair");
  };

  return (
    <form ref={sheet} onSubmit={onSubmit} className="flex max-w-md flex-col gap-6" noValidate>
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
