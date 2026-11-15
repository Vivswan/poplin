// The block of one setting: its name, one short sentence, the control, and under the control only what is needed: a refusal, the host's warnings, a hint, and the default with the way back to it while the value differs.

import { TriangleAlertIcon } from "lucide-react";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { FieldError } from "@/components/ui/field";
import { settingAnchor } from "@/settings/setting-address";
import { SettingControl } from "@/settings/setting-control";
import { SettingFrame } from "@/settings/setting-frame";
import { readOf } from "@/settings/setting-values";
import type { Row } from "@/settings/settings-queries";
import { wordsOf } from "@/settings/settings-words";

/** What a setting's block is drawn from. */
interface SettingRowProps {
  /** The setting. */
  readonly row: Row;

  /** The setting's text as its control shows it: the stored one, or the one a change waits with. */
  readonly text: string;

  /** The sentence the value was refused with. */
  readonly refusal: string | undefined;

  /** Called with the setting's text after a change. */
  readonly onChange: (text: string) => void;

  /** `true` while an address points the block out. */
  readonly marked: boolean;
}

/**
 * The id of a setting's control.
 *
 * @returns the id the control is found under, to give it the focus
 */
export function controlId(key: string): string {
  return `${settingAnchor(key)}-control`;
}

/** Draw the block of a setting. */
export function SettingRow({ row, text, refusal, onChange, marked }: SettingRowProps): ReactNode {
  const words = wordsOf(row.key);
  const id = controlId(row.key);

  const under = (
    <>
      {refusal === undefined ? null : <FieldError className="text-[13px]">{refusal}</FieldError>}
      {row.warnings.map((warning) => (
        <p key={warning} className="flex items-start gap-1.5 text-warn">
          <TriangleAlertIcon className="mt-0.5 size-3.5 shrink-0" aria-label="Warning" />
          {warning}
        </p>
      ))}
      {words.hint === undefined ? null : <p>{words.hint}</p>}
      {text === row.fallback ? null : (
        <p className="flex items-center gap-2">
          Default: {readOf(row, row.fallback)}
          <Button type="button" variant="link" size="xs" className="h-auto p-0 text-[13px] text-link" onClick={() => onChange(row.fallback)}>
            Reset
          </Button>
        </p>
      )}
    </>
  );

  return (
    <SettingFrame name={words.label} controlId={id} anchor={settingAnchor(row.key)} marked={marked} says={words.about} under={under}>
      <SettingControl row={row} id={id} text={text} onChange={onChange} refused={refusal !== undefined} />
    </SettingFrame>
  );
}
