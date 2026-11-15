// The dashboard's one script: it copies a link or a command to the clipboard and says so. Every page works without it.

/** The path the script is served under, on the dashboard's own origin. */
export const COPY_SCRIPT_PATH = "/copy.js";

/** How long a button says that it copied, in milliseconds. */
const SAID_FOR_MS = 1600;

/** The script. It shows each button with `data-copy`, hidden in the markup, and a press copies the attribute's value and says "Copied" or "Not copied" for a moment. Without it the buttons stay hidden and the text beside each can be selected. */
export const COPY_SCRIPT = `
for (const button of document.querySelectorAll("button[data-copy]")) {
  const label = button.getAttribute("aria-label") || button.textContent;
  const say = (text) => (button.hasAttribute("aria-label") ? button.setAttribute("aria-label", text) : (button.textContent = text));
  button.hidden = false;
  button.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(button.dataset.copy);
      say("Copied");
      button.classList.add("done");
    } catch {
      say("Not copied");
      button.classList.add("failed");
    }
    setTimeout(() => { say(label); button.classList.remove("done", "failed"); }, ${SAID_FOR_MS});
  });
}
`;
