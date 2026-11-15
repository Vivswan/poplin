import { useRef, useState } from "react";
import { ToggleGroup, ToggleGroupItem } from "../ui/toggle-group.tsx";

interface Props {
  /** The attribute, less its `data-` prefix, that carries the choice on the nearest element around the switch that has it. */
  name: string;

  /** What the group is, for a reader who cannot see it. */
  legend: string;

  /** The choices in order; the page is built showing the first. */
  options: readonly { value: string; label: string }[];
}

/**
 * A segmented switch between a few choices, exactly one of them made. A choice is written to the page, where the
 * stylesheet reads it, and then told to the page's scripts by a `choice` event that bubbles from the switch.
 */
export function Choice({ name, legend, options }: Props): React.ReactElement {
  const [chosen, setChosen] = useState(options[0]?.value ?? "");
  const group = useRef<HTMLDivElement>(null);

  function choose(values: string[]): void {
    const value = values[0];
    // Pressing the chosen one again takes nothing away: there is always a choice.
    if (value === undefined) return;

    setChosen(value);
    group.current?.closest(`[data-${name}]`)?.setAttribute(`data-${name}`, value);
    group.current?.dispatchEvent(new Event("choice", { bubbles: true }));
  }

  return (
    <ToggleGroup ref={group} aria-label={legend} value={[chosen]} onValueChange={choose}>
      {options.map((option) => (
        <ToggleGroupItem key={option.value} value={option.value}>
          {option.label}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}
