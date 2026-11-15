// What a dashboard page holds, read out of its markup with the runtime's own HTML parser: the text of the elements a selector matches, and one attribute of each.

/** The entities the dashboard's markup writes, and the character each stands for. The parser hands an attribute over as it is written. */
const ENTITIES: Readonly<Record<string, string>> = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'" };

function decoded(value: string): string {
  return value.replace(/&(?:amp|lt|gt|quot|#39);/g, (entity) => ENTITIES[entity] ?? entity);
}

/**
 * The text of every element a selector matches, in the order of the page.
 *
 * @param selector - a CSS selector whose matches do not hold one another
 * @returns each match's text, that of the elements inside it included, with its entities decoded
 */
export async function textsOf(page: string, selector: string): Promise<string[]> {
  const texts: string[] = [];
  const rewriter = new HTMLRewriter().on(selector, {
    element() {
      texts.push("");
    },
    text(chunk) {
      texts[texts.length - 1] += chunk.text;
    },
  });
  await rewriter.transform(new Response(page)).text();

  return texts.map(decoded);
}

/**
 * One attribute of every element a selector matches, in the order of the page.
 *
 * @returns the attribute's value for each match that has it, with its entities decoded
 */
export async function attributesOf(page: string, selector: string, name: string): Promise<string[]> {
  const values: string[] = [];
  const rewriter = new HTMLRewriter().on(selector, {
    element(element) {
      const value = element.getAttribute(name);
      if (value !== null) values.push(decoded(value));
    },
  });
  await rewriter.transform(new Response(page)).text();

  return values;
}
