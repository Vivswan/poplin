// The search box every list has above it: it searches as a person types, after a short rest, and keeps the text in the address.

import { SearchIcon, XIcon } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { useDebouncedCallback } from "use-debounce";

import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/components/ui/input-group";

/** How long typing rests before the search is sent, in milliseconds. */
const REST_MS = 250;

/** What a search box is drawn from. */
interface SearchBoxProps {
  /** The text the list is searched for now, from the address. */
  readonly sent: string;

  /** Called with the trimmed text once typing rests, when it differs from `sent`. */
  readonly onSearch: (text: string) => void;

  /** The words shown in the empty box, and what the box is for. */
  readonly placeholder: string;

  /** What the box is for, for a screen reader. */
  readonly label: string;

  /** The most characters the box takes. */
  readonly maxLength?: number;
}

/** Draw a search box with a button that clears it. */
export function SearchBox({ sent, onSearch, placeholder, label, maxLength }: SearchBoxProps): ReactNode {
  const [typed, setTyped] = useState(sent);
  // Text that came back to what the list is searched for already is not sent again.
  const search = useDebouncedCallback((text: string) => (text === sent ? undefined : onSearch(text)), REST_MS);
  const type = (text: string): void => {
    setTyped(text);
    search(text.trim());
  };
  // An address that changed by another way than typing takes the box's place, and what was typed meanwhile is not sent after it.
  useEffect(() => {
    setTyped(sent);
    search.cancel();
  }, [sent, search]);

  return (
    <InputGroup className="w-64 max-md:w-auto max-md:flex-1">
      <InputGroupAddon>
        <SearchIcon />
      </InputGroupAddon>
      <InputGroupInput
        type="search"
        value={typed}
        onChange={(event) => type(event.target.value)}
        maxLength={maxLength}
        placeholder={placeholder}
        aria-label={label}
        className="[&::-webkit-search-cancel-button]:hidden"
      />
      {typed === "" ? null : (
        <InputGroupAddon align="inline-end">
          <InputGroupButton size="icon-xs" aria-label="Clear the search" onClick={() => type("")}>
            <XIcon />
          </InputGroupButton>
        </InputGroupAddon>
      )}
    </InputGroup>
  );
}
