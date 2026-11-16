// The dialog that changes how a site is named: its title, which the dashboard shows first, and its name, which its link is written with. Each field says its own refusal, with what was typed kept.

import { type FormEvent, type ReactNode, type Ref, type RefObject, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { thenHome } from "@/lib/focus";
import type { Site } from "@/lib/sites";

/** What is said under each field while nothing is refused there. */
const HINTS = {
  title: "Leave it empty to use the page's own title.",
  name: "The link uses this name. Old links keep working.",
} as const;

/** A field of the dialog. */
type FieldKey = keyof typeof HINTS;

/** What a site is asked to change: only the fields that differ from what it holds. An empty title takes the typed one away. */
export interface SiteNaming {
  readonly title?: string;
  readonly name?: string;
}

/** A refused change: the field it is about, or `null` where it is about neither, and the sentence to show. */
export interface NamingRefusal {
  readonly about: FieldKey | null;
  readonly sentence: string;
}

/** What the dialog is drawn from. */
interface EditSiteDialogProps {
  /** The site to change; `undefined` shows no dialog. */
  readonly site: Site | undefined;

  /** Called when the dialog closes: Cancel, Escape, a press outside, and a done change close it. */
  readonly onClose: () => void;

  /** Sends the change. It answers the refusal, which is shown at its field, or nothing when the change is done. */
  readonly onSave: (site: Site, changes: SiteNaming) => Promise<NamingRefusal | undefined>;

  /** The control that opened the dialog, which takes the focus when it closes, while it is still on the page. */
  readonly returnTo?: RefObject<HTMLElement | null>;
}

/** The title a person typed for a site: empty where the site shows its page's own. */
function typedTitle(site: Site | undefined): string {
  return site?.title_typed === true ? (site.title ?? "") : "";
}

/** One field of the dialog, with its hint or the refusal in the hint's place. */
function NamingField({
  label,
  value,
  onChange,
  refusal,
  hint,
  placeholder,
  required = false,
  first = false,
  field,
}: {
  readonly label: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly refusal: string | undefined;
  readonly hint: string;
  readonly placeholder?: string;
  readonly required?: boolean;
  readonly first?: boolean;
  readonly field?: Ref<HTMLInputElement>;
}): ReactNode {
  return (
    <Field invalid={refusal !== undefined}>
      <FieldLabel>{label}</FieldLabel>
      <Input
        ref={field}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        autoComplete="off"
        spellCheck={false}
        aria-required={required}
        autoFocus={first}
      />
      {refusal === undefined ? <FieldDescription>{hint}</FieldDescription> : <FieldError>{refusal}</FieldError>}
    </Field>
  );
}

/** Ask for a site's title and name together. Save stays off while nothing differs from what the site holds, and while the name is empty. */
export function EditSiteDialog({ site, onClose, onSave, returnTo }: EditSiteDialogProps): ReactNode {
  // The dialog holds the site it was opened for, and what is typed, in one state: both stay while it closes, so it does not empty as it fades.
  const [shown, setShown] = useState(site);
  const [title, setTitle] = useState(typedTitle(site));
  const [name, setName] = useState(site?.name ?? "");
  const [refusal, setRefusal] = useState<NamingRefusal>();
  const [busy, setBusy] = useState(false);
  const fields = { title: useRef<HTMLInputElement>(null), name: useRef<HTMLInputElement>(null) };
  // Every opening starts from what the site holds: what was typed and then left by Cancel, Close, or Escape is not there the next time.
  // An opening is told by the site's id. The same site read again while the dialog is open is no opening, so what is typed stays.
  const [asked, setAsked] = useState(site?.id);
  if (site?.id !== asked) {
    setAsked(site?.id);
    if (site !== undefined) {
      setShown(site);
      setTitle(typedTitle(site));
      setName(site.name);
      setRefusal(undefined);
    }
  }

  // A field left as it was opened is not sent, whatever it holds: only what a person typed is changed.
  const changes: SiteNaming = {
    ...(title === typedTitle(shown) ? {} : { title: title.trim() }),
    ...(name === shown?.name ? {} : { name: name.trim() }),
  };
  // A field typed in again is no longer refused: its sentence goes when its value changes.
  const type = (field: FieldKey, set: (value: string) => void) => (value: string) => {
    set(value);
    setRefusal((held) => (held?.about === field ? undefined : held));
  };
  const send = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (shown === undefined) return;

    setBusy(true);
    const refused = await onSave(shown, changes);
    setBusy(false);
    if (refused === undefined) return onClose();

    setRefusal(refused);
    // The button that was pressed was off while the change was sent, which takes the focus from it: the refused field takes it, or the first one.
    fields[refused.about ?? "title"].current?.focus();
  };
  const refusalAt = (field: FieldKey): string | undefined => (refusal?.about === field ? refusal.sentence : undefined);

  return (
    <Dialog open={site !== undefined} onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent className="sm:max-w-sm" finalFocus={thenHome(returnTo)}>
        <form onSubmit={(event) => void send(event)} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>Edit the site</DialogTitle>
            <DialogDescription>The title is shown first. The name is part of the link.</DialogDescription>
          </DialogHeader>
          <NamingField
            label="Title"
            value={title}
            onChange={type("title", setTitle)}
            refusal={refusalAt("title")}
            hint={HINTS.title}
            placeholder={shown?.title_typed === false ? (shown.title ?? undefined) : undefined}
            first
            field={fields.title}
          />
          <NamingField label="Name" value={name} onChange={type("name", setName)} refusal={refusalAt("name")} hint={HINTS.name} required field={fields.name} />
          {refusal?.about === null ? (
            <Field invalid>
              <FieldError>{refusal.sentence}</FieldError>
            </Field>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy || name.trim() === "" || Object.keys(changes).length === 0}>
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
