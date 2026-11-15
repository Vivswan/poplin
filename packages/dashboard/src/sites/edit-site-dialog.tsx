// The dialog that changes how a site is named: its title, which the dashboard shows first, and its name, which its link is written with. Each field says its own refusal, with what was typed kept.

import { type FormEvent, type ReactNode, useId, useState } from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import type { Site } from "@/lib/sites";

/** The most characters a site's name holds. */
const LONGEST_NAME = 40;

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
  maxLength,
  first = false,
}: {
  readonly label: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly refusal: string | undefined;
  readonly hint: string;
  readonly placeholder?: string;
  readonly maxLength?: number;
  readonly first?: boolean;
}): ReactNode {
  const id = useId();
  const saysId = `${id}-says`;

  return (
    <Field data-invalid={refusal !== undefined}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Input
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        aria-invalid={refusal !== undefined}
        aria-describedby={saysId}
        placeholder={placeholder}
        autoComplete="off"
        spellCheck={false}
        maxLength={maxLength}
        autoFocus={first}
      />
      {refusal === undefined ? <FieldDescription id={saysId}>{hint}</FieldDescription> : <FieldError id={saysId}>{refusal}</FieldError>}
    </Field>
  );
}

/** Ask for a site's title and name together. Save stays off while nothing differs from what the site holds, and while the name is empty. */
export function EditSiteDialog({ site, onClose, onSave }: EditSiteDialogProps): ReactNode {
  // The dialog holds the site it was opened for, and what is typed, in one state: both stay while it closes, so it does not empty as it fades.
  const [shown, setShown] = useState(site);
  const [title, setTitle] = useState(typedTitle(site));
  const [name, setName] = useState(site?.name ?? "");
  const [refusal, setRefusal] = useState<NamingRefusal>();
  const [busy, setBusy] = useState(false);
  if (site !== undefined && site !== shown) {
    setShown(site);
    setTitle(typedTitle(site));
    setName(site.name);
    setRefusal(undefined);
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
    if (refused === undefined) onClose();
    else setRefusal(refused);
  };
  const refusalAt = (field: FieldKey): string | undefined => (refusal?.about === field ? refusal.sentence : undefined);

  return (
    <Dialog open={site !== undefined} onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent className="sm:max-w-sm">
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
          />
          <NamingField label="Name" value={name} onChange={type("name", setName)} refusal={refusalAt("name")} hint={HINTS.name} maxLength={LONGEST_NAME} />
          {refusal?.about === null ? <FieldError>{refusal.sentence}</FieldError> : null}
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
