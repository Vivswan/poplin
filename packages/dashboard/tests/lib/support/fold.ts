// A fold of a panel, as a person opens it: by a press on its heading.

import { fireEvent, within } from "@testing-library/react";

/**
 * Open a fold of the panel on the page, once the panel is drawn. A fold that is open stays open.
 *
 * @param name - the fold's heading, such as `Details`
 * @returns the button of the heading
 */
export async function openFold(name: string): Promise<HTMLElement> {
  const heading = await within(document.body).findByRole("button", { name: new RegExp(`^${name}`) });
  if (heading.getAttribute("aria-expanded") !== "true") fireEvent.click(heading);

  return heading;
}
