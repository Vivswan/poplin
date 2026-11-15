// The control a setting is changed with, by the kind the server read from the setting's type: a switch, a choice, a number with its unit beside it, or text. Every control holds the setting's text, the one form the server shows and takes.

import { NumberField } from "@base-ui/react/number-field";
import type { ReactNode } from "react";

import { Input } from "@/components/ui/input";
import { InputGroup, InputGroupAddon, InputGroupInput, InputGroupText } from "@/components/ui/input-group";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { choiceLabel, isOn, isSwitch, partsOf, switchText, textOf } from "@/settings/setting-values";
import type { Row } from "@/settings/settings-queries";
import { unitWord, wordsOf } from "@/settings/settings-words";

/** The two values of the choice before a number that can also be a word. */
const WORD_CHOICE = { word: "word", number: "number" } as const;

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

  /** The setting's text as the control shows it: the stored one, or the one a change waits with. */
  readonly text: string;

  /** Called with the setting's text after a change. */
  readonly onChange: (text: string) => void;

  /** Whether the value was refused. */
  readonly refused: boolean;
}

function SwitchControl({ row, id, text, onChange, refused }: ControlProps): ReactNode {
  return (
    <span className="flex h-8 items-center">
      <Switch id={id} aria-labelledby={`${id}-label`} checked={isOn(row, text)} onCheckedChange={(checked) => onChange(switchText(row, checked))} aria-invalid={refused} />
    </span>
  );
}

/** A choice among a few named values. */
function Choice({
  id,
  labelledBy,
  items,
  value,
  onChoose,
  refused,
  className,
}: {
  readonly id: string;
  readonly labelledBy: string;
  readonly items: readonly { readonly value: string; readonly label: string }[];
  readonly value: string;
  readonly onChoose: (value: string) => void;
  readonly refused: boolean;
  readonly className: string;
}): ReactNode {
  return (
    <Select items={items} value={value} onValueChange={(chosen) => onChoose(String(chosen))}>
      <SelectTrigger id={id} aria-labelledby={labelledBy} aria-invalid={refused} className={className}>
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

function ChoiceControl(props: ControlProps): ReactNode {
  const { row, id, text, onChange, refused } = props;
  if (isSwitch(row)) return <SwitchControl {...props} />;

  const options = row.control.kind === "choice" ? row.control.options : [];
  const items = options.map((option) => ({ value: option, label: choiceLabel(row, option) }));

  return <Choice id={id} labelledBy={`${id}-label`} items={items} value={text} onChoose={onChange} refused={refused} className="w-44" />;
}

/** The field of a number, with its unit fixed at its right. Only a number is typed in it; whether it is one the setting takes is the server's to say. */
function CountField({ row, id, text, onChange, refused, className }: ControlProps & { readonly className: string }): ReactNode {
  const parts = partsOf(row, text);
  const unit = unitWord(row.key, parts.unit);

  return (
    <NumberField.Root
      id={id}
      value={parts.count}
      onValueChange={(count) => onChange(textOf(row, { count, unit: parts.unit }))}
      locale="en-US"
      className={className}
    >
      <InputGroup>
        <NumberField.Input
          render={<InputGroupInput aria-labelledby={`${id}-label`} aria-invalid={refused} autoComplete="off" className="tabular-nums" />}
          placeholder={wordsOf(row.key).empty}
        />
        {unit === "" ? null : (
          <InputGroupAddon align="inline-end">
            <InputGroupText>{unit}</InputGroupText>
          </InputGroupAddon>
        )}
      </InputGroup>
    </NumberField.Root>
  );
}

function NumberControl(props: ControlProps): ReactNode {
  const { row, id, text, onChange } = props;
  const { wordLabels, start } = wordsOf(row.key);
  const word = row.control.kind === "number" ? row.control.word : null;
  if (word === null || wordLabels === undefined) return <CountField {...props} className="w-44" />;

  // A number that can also be a word is a choice between the two, and the field only while the number is chosen. The row's id is the field's while it is there, so a refusal's focus lands in it.
  const items = [
    { value: WORD_CHOICE.word, label: wordLabels.word },
    { value: WORD_CHOICE.number, label: wordLabels.number },
  ];
  const choose = (chosen: string): void => onChange(chosen === WORD_CHOICE.word ? word : `${start ?? ""}${row.unit}`);

  return (
    <span className="flex items-center gap-2">
      <Choice
        id={text === word ? id : `${id}-choice`}
        labelledBy={`${id}-label`}
        items={items}
        value={text === word ? WORD_CHOICE.word : WORD_CHOICE.number}
        onChoose={choose}
        refused={false}
        className="w-28"
      />
      {text === word ? null : <CountField {...props} className="w-32" />}
    </span>
  );
}

function LinesControl({ id, text, onChange, refused }: ControlProps): ReactNode {
  const lines = text.split(",");

  return (
    <Textarea
      id={id}
      value={lines.join("\n")}
      onChange={(event) => onChange(event.target.value.split("\n").join(","))}
      rows={Math.max(LEAST_LINES, lines.length)}
      autoComplete="off"
      spellCheck={false}
      aria-invalid={refused}
    />
  );
}

function TextControl({ id, text, onChange, refused }: ControlProps): ReactNode {
  return <Input id={id} value={text} onChange={(event) => onChange(event.target.value)} autoComplete="off" spellCheck={false} aria-invalid={refused} />;
}

/** Draw the control of a setting. */
export function SettingControl(props: ControlProps): ReactNode {
  const Control = CONTROLS[props.row.control.kind];

  return <Control {...props} />;
}
