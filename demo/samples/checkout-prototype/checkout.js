const PRODUCTS = [
  { id: "notebook", name: "Dot-grid notebook", detail: "A5, 160 pages", price: 1400, start: 2 },
  { id: "pencils", name: "Cedar pencils", detail: "Box of 12, soft lead", price: 950, start: 1 },
  { id: "ink", name: "Bottled ink", detail: "Slate blue, 50 ml", price: 1200, start: 1 },
];
const DELIVERY_COST = { standard: 400, express: 900, pickup: 0 };
const FREE_STANDARD_FROM = 4000;
const PROMO_CODE = "SAMPLE10";
const PROMO_RATE = 0.1;
const MOST_OF_ONE_ITEM = 9;
const DONE_STEP = 3;
const SAMPLE_DETAILS = { name: "Sam Sample", email: "sam@example.com", street: "12 Example Lane", city: "Sampleton", postcode: "00000" };
const SAMPLE_CARD = { card: "0000 0000 0000 0000", expiry: "12/30", code: "000" };
const RULES = {
  name: { test: (value) => value.length > 1, message: "Enter the name the parcel is for." },
  email: { test: (value) => /^\S+@\S+\.\S+$/.test(value), message: "Enter an email address, such as name@example.com." },
  street: { test: (value) => value.length > 2, message: "Enter the street address." },
  city: { test: (value) => value.length > 1, message: "Enter the town or city." },
  postcode: { test: (value) => value.length > 2, message: "Enter the postcode." },
  card: { test: (value) => /^\d{16}$/.test(value.replace(/\s/g, "")), message: "Enter the 16 digits of the card number." },
  expiry: { test: (value) => /^(0[1-9]|1[0-2])\/\d{2}$/.test(value), message: "Enter the expiry as month and year, such as 12/30." },
  code: { test: (value) => /^\d{3}$/.test(value), message: "Enter the 3 digits of the security code." },
};

const byId = (id) => document.getElementById(id);
const panels = [...document.querySelectorAll("[data-panel]")];
const stepButtons = [...document.querySelectorAll("#stepper button")];
const cartRows = new Map();
// Everything the prototype knows lives here, in memory, and is gone on reload.
const state = { step: 0, quantities: {}, method: "standard", promo: false };

function money(cents) {
  return `$${(cents / 100).toFixed(2)}`;
}

function node(tag, className, text) {
  const element = document.createElement(tag);

  element.className = className;
  if (text !== undefined) {
    element.textContent = text;
  }

  return element;
}

function totals() {
  const items = PRODUCTS.reduce((sum, product) => sum + product.price * state.quantities[product.id], 0);
  const discount = state.promo ? Math.round(items * PROMO_RATE) : 0;
  const standardIsFree = state.method === "standard" && items - discount >= FREE_STANDARD_FROM;
  const delivery = standardIsFree ? 0 : DELIVERY_COST[state.method];

  return { items, discount, delivery, total: items - discount + delivery };
}

function changeQuantity(product, change) {
  state.quantities[product.id] += change;
  renderOrder();

  if (state.quantities[product.id] === 0) {
    byId("cart-title").focus();
  }
}

function buildCartRow(product) {
  const row = node("li", "cart-row");
  const picture = node("img", "cart-picture");
  const text = node("div", "cart-text");
  const stepper = node("div", "quantity");
  const minus = node("button", "quantity-button", "-");
  const count = node("span", "quantity-count");
  const plus = node("button", "quantity-button", "+");
  const price = node("span", "cart-price num");
  const remove = node("button", "link-button", "Remove");

  picture.src = `assets/${product.id}.svg`;
  picture.alt = "";
  picture.width = 72;
  picture.height = 72;
  text.append(node("strong", "", product.name), node("span", "cart-detail", product.detail));

  for (const button of [minus, plus, remove]) {
    button.type = "button";
  }
  minus.setAttribute("aria-label", `One fewer: ${product.name}`);
  plus.setAttribute("aria-label", `One more: ${product.name}`);
  remove.setAttribute("aria-label", `Remove ${product.name} from the cart`);
  minus.addEventListener("click", () => changeQuantity(product, -1));
  plus.addEventListener("click", () => changeQuantity(product, 1));
  remove.addEventListener("click", () => changeQuantity(product, -state.quantities[product.id]));

  stepper.append(minus, count, plus);
  row.append(picture, text, stepper, price, remove);
  byId("cart-items").append(row);
  cartRows.set(product.id, { row, minus, count, plus, price });
}

function renderOrder() {
  const sums = totals();
  const lines = [];

  for (const product of PRODUCTS) {
    const quantity = state.quantities[product.id];
    const parts = cartRows.get(product.id);

    parts.row.hidden = quantity === 0;
    parts.count.textContent = quantity;
    parts.minus.disabled = quantity <= 1;
    parts.plus.disabled = quantity >= MOST_OF_ONE_ITEM;
    parts.price.textContent = money(product.price * quantity);

    if (quantity > 0) {
      const line = node("li", "");

      line.append(node("span", "", `${quantity} x ${product.name}`), node("span", "num", money(product.price * quantity)));
      lines.push(line);
    }
  }

  const isEmpty = lines.length === 0;

  if (isEmpty) {
    lines.push(node("li", "hint", "Nothing in the cart yet."));
  }

  byId("cart-empty").hidden = !isEmpty;
  byId("to-delivery").disabled = isEmpty;
  byId("summary-lines").replaceChildren(...lines);
  byId("total-items").textContent = money(sums.items);
  byId("discount-row").hidden = sums.discount === 0;
  byId("total-discount").textContent = `-${money(sums.discount)}`;
  byId("total-delivery").textContent = sums.delivery === 0 ? "Free" : money(sums.delivery);
  byId("total-grand").textContent = money(sums.total);
}

function renderStep() {
  panels.forEach((panel, index) => {
    panel.hidden = index !== state.step;
  });

  stepButtons.forEach((button, index) => {
    const isCurrent = index === state.step;

    button.disabled = index >= state.step || state.step === DONE_STEP;
    button.parentElement.classList.toggle("is-done", index < state.step);
    button.parentElement.classList.toggle("is-current", isCurrent);
    button.setAttribute("aria-current", isCurrent ? "step" : "false");
  });
}

// Marks every failing field in the panel and reports whether the panel may be left.
function validatePanel(panel) {
  let firstBad = null;

  for (const input of panel.querySelectorAll("[data-rule]")) {
    const rule = RULES[input.dataset.rule];
    const isBad = input.closest("[hidden]") === null && !rule.test(input.value.trim());
    const error = byId(`${input.id}-error`);

    error.hidden = !isBad;
    error.textContent = isBad ? rule.message : "";
    input.setAttribute("aria-invalid", String(isBad));
    firstBad ??= isBad ? input : null;
  }

  firstBad?.focus();

  return firstBad === null;
}

function describeOrder() {
  const { total } = totals();
  const firstName = byId("name").value.trim().split(/\s+/)[0];
  const address = `${byId("street").value.trim()}, ${byId("city").value.trim()}`;
  const where = state.method === "pickup" ? "will be ready to collect from the shop counter" : `is on its way to ${address}`;
  const receipt = `A receipt would go to ${byId("email").value.trim()}.`;

  byId("done-line").textContent = `Thanks, ${firstName}. Order QP-${1000 + (total % 9000)} for ${money(total)} ${where}. ${receipt}`;
}

function goTo(step) {
  const movingOn = step > state.step;

  if (movingOn && !validatePanel(panels[state.step])) {
    return;
  }

  state.step = step;
  if (step === DONE_STEP) {
    describeOrder();
  }

  renderStep();
  panels[step].querySelector("h2").focus();
}

function chooseMethod(method) {
  state.method = method;
  byId("address").hidden = method === "pickup";
  renderOrder();
}

function applyPromo() {
  state.promo = byId("promo").value.trim().toUpperCase() === PROMO_CODE;
  byId("promo-note").textContent = state.promo ? "SAMPLE10 applied: 10% off your items." : "That code did not match. Try SAMPLE10.";
  renderOrder();
}

function fillFields(values) {
  for (const [id, value] of Object.entries(values)) {
    byId(id).value = value;
  }
}

function fillCart() {
  for (const product of PRODUCTS) {
    state.quantities[product.id] = product.start;
  }
}

function startAgain() {
  for (const input of document.querySelectorAll("#panels input:not([type=radio])")) {
    input.value = "";
    input.removeAttribute("aria-invalid");
  }
  for (const error of document.querySelectorAll(".error")) {
    error.hidden = true;
  }

  document.querySelector('[name="method"][value="standard"]').checked = true;
  byId("promo-note").textContent = "Try SAMPLE10 for 10% off.";
  state.promo = false;
  fillCart();
  chooseMethod("standard");
  goTo(0);
}

function onEnter(event) {
  const isTextField = event.target.matches("input:not([type=radio])");

  if (event.key !== "Enter" || !isTextField) {
    return;
  }

  event.preventDefault();
  event.target.closest("[data-enter]").querySelector("[data-primary]").click();
}

fillCart();
PRODUCTS.forEach(buildCartRow);
renderOrder();
renderStep();

byId("panels").addEventListener("keydown", onEnter);
byId("apply-promo").addEventListener("click", applyPromo);
byId("fill-details").addEventListener("click", () => fillFields(SAMPLE_DETAILS));
byId("fill-card").addEventListener("click", () => fillFields(SAMPLE_CARD));
byId("start-again").addEventListener("click", startAgain);
byId("restore").addEventListener("click", () => {
  fillCart();
  renderOrder();
});

for (const button of document.querySelectorAll("[data-go]")) {
  button.addEventListener("click", () => goTo(Number(button.dataset.go)));
}
for (const button of stepButtons) {
  button.addEventListener("click", () => goTo(Number(button.dataset.step)));
}
for (const radio of document.querySelectorAll('[name="method"]')) {
  radio.addEventListener("change", () => chooseMethod(radio.value));
}
