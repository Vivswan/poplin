// The row of one setting: its name, what it does, its default with the way back to it while the value differs, the control, under it the host's warnings for the value it holds, and a refusal or a plain line.
// A setting that does nothing on this install says in that line what it needs, and its control takes no change.

import { type ReactNode, useEffect, useRef } from "react";

import { FieldDescription, FieldError } from "@/components/ui/field";
import { settingAnchor } from "@/settings/setting-address";
import { SettingControl } from "@/settings/setting-control";
import { SettingFrame } from "@/settings/setting-frame";
import { isSwitch, partsOf, readOf } from "@/settings/setting-values";
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

  /** A line under the control while nothing is refused: what the setting needs before it does anything. */
  readonly note?: string;
}

/**
 * The id of a setting's control.
 *
 * @returns the id the control is found under, to give it the focus
 */
export function controlId(key: string): string {
  return `${settingAnchor(key)}-control`;
}

/** The host's sentences for the text a control holds now, saved or not: one for each free limit its count is above. */
function warningsOf(row: Row, text: string): readonly string[] {
  const { count, unit } = partsOf(row, text);
  if (count === null) return [];

  return row.limits.filter((limit) => limit.unit === unit && count > limit.over).map((limit) => limit.warning);
}

/** A plain line under the control, or nothing. */
function underOf(said: string | undefined): ReactNode {
  return said === undefined ? undefined : <FieldDescription className="text-[13px] leading-5">{said}</FieldDescription>;
}

/** Draw the row of a setting. */
export function SettingRow({ row, text, refusal, onChange, marked, note }: SettingRowProps): ReactNode {
  const words = wordsOf(row.key);
  const id = controlId(row.key);
  // Reset leaves with the value it put back, and the focus with it. The setting's control takes it once the default is drawn: another control may show the default than showed the value.
  const resetting = useRef(false);
  useEffect(() => {
    if (!resetting.current) return;

    resetting.current = false;
    document.getElementById(id)?.focus();
  });
  const reset = (): void => {
    resetting.current = true;
    onChange(row.fallback);
  };

  return (
    <SettingFrame
      name={words.label}
      controlId={id}
      anchor={settingAnchor(row.key)}
      marked={marked}
      says={[words.about]}
      fallback={readOf(row, row.fallback)}
      onReset={row.needs !== null || text === row.fallback ? undefined : reset}
      warnings={warningsOf(row, text)}
      beside={isSwitch(row)}
      idle={row.needs !== null}
      refused={refusal !== undefined}
      under={refusal === undefined ? underOf(row.needs ?? note) : <FieldError className="text-[13px]">{refusal}</FieldError>}
    >
      <SettingControl row={row} id={id} text={text} onChange={onChange} refused={refusal !== undefined} />
    </SettingFrame>
  );
}
