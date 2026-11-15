// The line of one setting: its name, the question mark that holds one short sentence, its default, and the way back to it, and at the line's end the control, with one icon before it for the host's warnings.

import { TriangleAlertIcon } from "lucide-react";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Hint } from "@/shared/hint";
import { RowLine } from "@/settings/row-line";
import { SettingControl } from "@/settings/setting-control";
import { isSwitch, readOf } from "@/settings/setting-values";
import type { Row } from "@/settings/settings-queries";
import { wordsOf } from "@/settings/settings-words";

/** What a setting's line is drawn from. */
interface SettingRowProps {
  /** The setting. */
  readonly row: Row;

  /** The setting's text as its control shows it: the stored one, or the one a change waits with. */
  readonly text: string;

  /** The sentence the value was refused with. */
  readonly refusal: string | undefined;

  /** Called with the setting's text after a change. */
  readonly onChange: (text: string) => void;
}

/**
 * The id of a setting's control.
 *
 * @returns the id the control is found under, to give it the focus
 */
export function controlId(key: string): string {
  return `setting-${key}`;
}

/** Draw the line of a setting. */
export function SettingRow({ row, text, refusal, onChange }: SettingRowProps): ReactNode {
  const words = wordsOf(row.key);
  const id = controlId(row.key);

  const about = (close: () => void): ReactNode => (
    <>
      {words.about === "" ? null : <p>{words.about}</p>}
      <p className="text-muted-foreground">Default: {readOf(row, row.fallback)}</p>
      {text === row.fallback ? null : (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="self-start"
          onClick={() => {
            onChange(row.fallback);
            close();
          }}
        >
          Reset to default
        </Button>
      )}
    </>
  );

  return (
    <RowLine label={words.label} controlId={id} about={about} small={isSwitch(row)} refusal={refusal}>
      {row.warnings.length === 0 ? null : (
        <Hint label={`Warning: ${row.warnings.join(" ")}`} icon={<TriangleAlertIcon />} className="text-warn hover:text-warn">
          {() => row.warnings.map((warning) => <p key={warning}>{warning}</p>)}
        </Hint>
      )}
      <SettingControl row={row} id={id} text={text} onChange={onChange} refused={refusal !== undefined} />
    </RowLine>
  );
}
