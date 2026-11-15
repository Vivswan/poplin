import { useRef, useState } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select.tsx";

interface Props {
  /** The agents in order, each by the key the page switches on and its plain name; the page is built showing the first. */
  agents: readonly { value: string; label: string }[];
}

/**
 * The agent picker. The pick is written as `data-picked` on the nearest element around the picker that has it, where the
 * stylesheet reads it. The trigger is as wide as the longest name, so a pick never moves what follows it.
 */
export function AgentPicker({ agents }: Props): React.ReactElement {
  const [picked, setPicked] = useState(agents[0]?.value ?? "");
  const trigger = useRef<HTMLButtonElement>(null);

  function pick(value: string | null): void {
    if (value === null) return;

    setPicked(value);
    trigger.current?.closest("[data-picked]")?.setAttribute("data-picked", value);
  }

  return (
    <Select items={agents} value={picked} onValueChange={pick} modal={false}>
      <SelectTrigger ref={trigger} aria-label="Your agent">
        <span className="grid">
          <SelectValue className="col-start-1 row-start-1" />
          {agents.map((agent) => (
            <span key={agent.value} className="invisible col-start-1 row-start-1" aria-hidden="true">
              {agent.label}
            </span>
          ))}
        </span>
      </SelectTrigger>
      <SelectContent>
        {agents.map((agent) => (
          <SelectItem key={agent.value} value={agent.value}>
            {agent.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
