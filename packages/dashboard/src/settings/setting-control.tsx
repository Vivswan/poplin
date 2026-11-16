// The control a setting is changed with, by the kind the server read from the setting's type: a switch, a choice, a number with its unit beside it, or text. Every control holds the setting's text, the one form the server shows and takes.

import { Field } from "@base-ui/react/field";
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

/** The width of a field or a choice: one for all. */
const WIDE = "w-48";

/** The two values of the choice before a number that can also be a word. */
const WORD_CHOICE = { word: "word", number: "number" } as const;

/** How a count is written in its field: with separators between its thousands, and with the digits of a fraction that was typed, as many as the setting's text holds, so the field shows what Save sends. */
const AS_TYPED = { maximumFractionDigits: 20 } as const;

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

  /** The id of the control, where the focus finds it. */
  readonly id: string;

  /** The setting's text as the control shows it: the stored one, or the one a change waits with. */
  readonly text: string;

  /** Called with the setting's text after a change. */
  readonly onChange: (text: string) => void;

  /** Whether the value was refused. */
  readonly refused: boolean;
}

function SwitchControl({ row, id, text, onChange }: ControlProps): ReactNode {
  return <Switch id={id} checked={isOn(row, text)} onCheckedChange={(checked) => onChange(switchText(row, checked))} />;
}

/** A choice among a few named values. The row's name is given to its trigger by id. */
function Choice({
  id,
  labelledBy,
  items,
  value,
  onChoose,
  className,
}: {
  readonly id: string;
  readonly labelledBy: string;
  readonly items: readonly { readonly value: string; readonly label: string }[];
  readonly value: string;
  readonly onChoose: (value: string) => void;
  readonly className: string;
}): ReactNode {
  return (
    <Select items={items} value={value} onValueChange={(chosen) => onChoose(String(chosen))}>
      <SelectTrigger id={id} aria-labelledby={labelledBy} className={className}>
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
  const { row, id, text, onChange } = props;
  if (isSwitch(row)) return <SwitchControl {...props} />;

  const options = row.control.kind === "choice" ? row.control.options : [];
  const items = options.map((option) => ({ value: option, label: choiceLabel(row, option) }));

  return <Choice id={id} labelledBy={`${id}-label`} items={items} value={text} onChoose={onChange} className={WIDE} />;
}

/** The field of a number, with its unit fixed at its right. It takes a count from 0 up: a minus or a letter is not let in. Whether the count is one the setting takes is the server's to say, a fraction too. */
function CountField({ row, id, text, onChange, className }: ControlProps & { readonly className: string }): ReactNode {
  const parts = partsOf(row, text);
  const unit = unitWord(row.key, parts.unit);

  return (
    <NumberField.Root
      id={id}
      value={parts.count}
      onValueChange={(count) => onChange(textOf(row, { count, unit: parts.unit }))}
      min={0}
      format={AS_TYPED}
      locale="en-US"
      className={className}
    >
      <InputGroup>
        <NumberField.Input
          render={<InputGroupInput id={id} autoComplete="off" className="tabular-nums" />}
          placeholder={wordsOf(row.key).empty}
        />
        {unit === "" ? null : (
          <InputGroupAddon align="inline-end" className="self-stretch border-l py-0 pl-2.5">
            <Field.Description render={<InputGroupText />}>{unit}</Field.Description>
          </InputGroupAddon>
        )}
      </InputGroup>
    </NumberField.Root>
  );
}

function NumberControl(props: ControlProps): ReactNode {
  const { row, id, text, onChange, refused } = props;
  const { wordLabels, start } = wordsOf(row.key);
  const word = row.control.kind === "number" ? row.control.word : null;
  if (word === null || wordLabels === undefined) return <CountField {...props} className={WIDE} />;

  // A number that can also be a word is a choice between the two, and the field only while the number is chosen. The row's id is the field's while it is there, so a refusal's focus lands in it.
  // A field ties its name and its lines to one control, the count's: the choice is a field of its own, named by the row's name, and marked as refused only while it stands alone.
  const items = [
    { value: WORD_CHOICE.word, label: wordLabels.word },
    { value: WORD_CHOICE.number, label: wordLabels.number },
  ];
  const choose = (chosen: string): void => onChange(chosen === WORD_CHOICE.word ? word : `${start ?? ""}${row.unit}`);

  return (
    <span className="flex items-center gap-2">
      <Field.Root invalid={refused && text === word} className="shrink-0">
        <Choice
          id={text === word ? id : `${id}-choice`}
          labelledBy={`${id}-label`}
          items={items}
          value={text === word ? WORD_CHOICE.word : WORD_CHOICE.number}
          onChoose={choose}
          className="w-28"
        />
      </Field.Root>
      {text === word ? null : <CountField {...props} className="w-36" />}
    </span>
  );
}

function LinesControl({ id, text, onChange }: ControlProps): ReactNode {
  const lines = text.split(",");

  return (
    <Field.Control
      render={<Textarea rows={Math.max(LEAST_LINES, lines.length)} />}
      id={id}
      value={lines.join("\n")}
      onValueChange={(typed) => onChange(typed.split("\n").join(","))}
      autoComplete="off"
      spellCheck={false}
    />
  );
}

function TextControl({ id, text, onChange }: ControlProps): ReactNode {
  return <Input id={id} value={text} onChange={(event) => onChange(event.target.value)} autoComplete="off" spellCheck={false} />;
}

/** Draw the control of a setting. */
export function SettingControl(props: ControlProps): ReactNode {
  const Control = CONTROLS[props.row.control.kind];

  return <Control {...props} />;
}
