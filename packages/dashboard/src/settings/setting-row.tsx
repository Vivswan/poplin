// The row of one setting: its name, what it does, its default with the way back to it while the value differs, the control, the host's warnings, and a refusal under the control.

import type { ReactNode } from "react";

import { FieldError } from "@/components/ui/field";
import { settingAnchor } from "@/settings/setting-address";
import { SettingControl } from "@/settings/setting-control";
import { SettingFrame } from "@/settings/setting-frame";
import { isSwitch, readOf } from "@/settings/setting-values";
import type { Row } from "@/settings/settings-queries";
import { wordsOf } from "@/settings/settings-words";

/** What a setting's row is drawn from. */
interface SettingRowProps {
  /** The setting. */
  readonly row: Row;

  /** The setting's text as its control shows it: the stored one, or the one a change waits with. */
  readonly text: string;

  /** The sentence the value was refused with. */
  readonly refusal: string | undefined;

  /** Called with the setting's text after a change. */
  readonly onChange: (text: string) => void;

  /** `true` while an address points the row out. */
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

/** Draw the row of a setting. */
export function SettingRow({ row, text, refusal, onChange, marked }: SettingRowProps): ReactNode {
  const words = wordsOf(row.key);
  const id = controlId(row.key);

  return (
    <SettingFrame
      name={words.label}
      controlId={id}
      anchor={settingAnchor(row.key)}
      marked={marked}
      says={[words.about, words.hint ?? ""]}
      fallback={readOf(row, row.fallback)}
      onReset={text === row.fallback ? undefined : () => onChange(row.fallback)}
      warnings={row.warnings}
      beside={isSwitch(row)}
      under={refusal === undefined ? undefined : <FieldError className="text-[13px]">{refusal}</FieldError>}
    >
      <SettingControl row={row} id={id} text={text} onChange={onChange} refused={refusal !== undefined} />
    </SettingFrame>
  );
}
