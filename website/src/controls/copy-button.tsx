import { CopyIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "../ui/button.tsx";

// How long the button says what happened, in milliseconds.
const TOLD = 1600;

interface Props {
  /** What a press puts on the clipboard. */
  command: string;
}

/** The Copy button beside a command. What it says after a press takes the place of its icon and word, so it never changes width. */
export function CopyButton({ command }: Props): React.ReactElement {
  const [said, setSaid] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  async function copy(): Promise<void> {
    let outcome = "Copied";
    try {
      await navigator.clipboard.writeText(command);
    } catch {
      outcome = "Failed";
    }
    setSaid(outcome);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setSaid(""), TOLD);
  }

  return (
    <Button variant="secondary" size="sm" data-told={said === "" ? undefined : ""} aria-label={`Copy: ${command}`} onClick={copy}>
      <span className="col-start-1 row-start-1 inline-flex items-center gap-[3px] group-data-told/button:invisible">
        <CopyIcon />
        Copy
      </span>
      <span className="col-start-1 row-start-1" aria-live="polite">
        {said}
      </span>
    </Button>
  );
}
