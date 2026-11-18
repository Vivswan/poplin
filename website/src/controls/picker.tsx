import { useRef, useState } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select.tsx";

interface Props {
  /** The attribute, less its `data-` prefix, that carries the pick on the nearest element around the picker that has it. */
  name: string;

  /** What is picked, for a reader who cannot see it. */
  legend: string;

  /** The options in order, each by the key the page switches on and its plain name; the page is built showing the first. */
  options: readonly { value: string; label: string }[];
}

/**
 * The pick is written to the page, where the stylesheet reads it. The trigger is as wide as the longest name, so a pick
 * never moves what follows it.
 */
export function Picker({ name, legend, options }: Props): React.ReactElement {
  const [picked, setPicked] = useState(options[0]?.value ?? "");
  const trigger = useRef<HTMLButtonElement>(null);

  function pick(value: string | null): void {
    if (value === null) return;

    setPicked(value);
    trigger.current?.closest(`[data-${name}]`)?.setAttribute(`data-${name}`, value);
  }

  return (
    <Select items={options} value={picked} onValueChange={pick} modal={false}>
      <SelectTrigger ref={trigger} aria-label={legend}>
        <span className="grid">
          <SelectValue className="col-start-1 row-start-1" />
          {options.map((option) => (
            <span key={option.value} className="invisible col-start-1 row-start-1" aria-hidden="true">
              {option.label}
            </span>
          ))}
        </span>
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
