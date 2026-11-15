// The control a setting is changed with, by the kind the server read from the setting's type: a switch, a choice, a number with its unit, a list, or text.

import type { ReactNode } from "react";

import { Input } from "@/components/ui/input";
import { InputGroup, InputGroupAddon, InputGroupInput, InputGroupText } from "@/components/ui/input-group";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import type { Row } from "@/settings/settings-queries";
import { wordsOf } from "@/settings/settings-words";

/** The fewest lines a list's field is tall. */
const LEAST_LINES = 3;

/** The control of each kind. A kind missing here does not compile. */
const CONTROLS: { readonly [Kind in Row["control"]["kind"]]: (props: ControlProps) => ReactNode } = {
  switch: SwitchControl,
  choice: ChoiceControl,
  number: NumberControl,
  lines: LinesControl,
  text: TextControl,
};

/** What a control is drawn from. */
interface ControlProps {
  /** The setting. */
  readonly row: Row;

  /** The id the row's name points at; the name itself has this id with `-label` after it. */
  readonly id: string;

  /** What the control holds, as `shownOf` writes it. */
  readonly shown: string;

  /** Called with what the control holds after a change. */
  readonly onChange: (shown: string) => void;

  /** Whether the value was refused. */
  readonly refused: boolean;
}

function capitalised(word: string): string {
  return `${word.slice(0, 1).toUpperCase()}${word.slice(1)}`;
}

function SwitchControl({ id, shown, onChange, refused }: ControlProps): ReactNode {
  return (
    <span className="flex h-8 items-center">
      <Switch
        id={id}
        aria-labelledby={`${id}-label`}
        checked={shown === "on"}
        onCheckedChange={(checked) => onChange(checked ? "on" : "off")}
        aria-invalid={refused}
      />
    </span>
  );
}

function ChoiceControl({ row, id, shown, onChange, refused }: ControlProps): ReactNode {
  const options = row.control.kind === "choice" ? row.control.options : [];
  const items = options.map((option) => ({ value: option, label: capitalised(option) }));

  return (
    <Select items={items} value={shown} onValueChange={(value) => onChange(String(value))}>
      <SelectTrigger id={id} aria-invalid={refused} className="w-44">
        <SelectValue />
      </SelectTrigger>
      <SelectContent alignItemWithTrigger={false} align="start">
        <SelectGroup>
          {items.map((item) => (
            <SelectItem key={item.value} value={item.value}>
              {item.label}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  );
}

function NumberControl({ row, id, shown, onChange, refused }: ControlProps): ReactNode {
  const unit = row.suffix === "" ? wordsOf(row.key).unit : row.suffix;

  return (
    <InputGroup className="w-48 max-w-full">
      <InputGroupInput
        id={id}
        value={shown}
        onChange={(event) => onChange(event.target.value)}
        inputMode="numeric"
        autoComplete="off"
        aria-invalid={refused}
        className="tabular-nums"
      />
      {unit === undefined ? null : (
        <InputGroupAddon align="inline-end">
          <InputGroupText>{unit}</InputGroupText>
        </InputGroupAddon>
      )}
    </InputGroup>
  );
}

function LinesControl({ id, shown, onChange, refused }: ControlProps): ReactNode {
  return (
    <Textarea
      id={id}
      value={shown}
      onChange={(event) => onChange(event.target.value)}
      rows={Math.max(LEAST_LINES, shown.split("\n").length)}
      autoComplete="off"
      spellCheck={false}
      aria-invalid={refused}
      className="max-w-96"
    />
  );
}

function TextControl({ id, shown, onChange, refused }: ControlProps): ReactNode {
  return (
    <Input
      id={id}
      value={shown}
      onChange={(event) => onChange(event.target.value)}
      autoComplete="off"
      spellCheck={false}
      aria-invalid={refused}
      className="max-w-72"
    />
  );
}

/** Draw the control of a setting. */
export function SettingControl(props: ControlProps): ReactNode {
  const Control = CONTROLS[props.row.control.kind];

  return <Control {...props} />;
}
