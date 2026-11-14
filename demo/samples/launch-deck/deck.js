const SWIPE_DISTANCE = 40;
// Home and End overshoot on purpose: show() clamps to the first and last slide.
const KEY_STEPS = { ArrowRight: 1, PageDown: 1, " ": 1, ArrowLeft: -1, PageUp: -1, Home: -Infinity, End: Infinity };

const stage = document.getElementById("stage");
const slides = [...stage.querySelectorAll(".slide")];
const counter = document.getElementById("counter");
const announcer = document.getElementById("announcer");
const progress = document.getElementById("progress");
const previous = document.getElementById("previous");
const next = document.getElementById("next");
const threads = slides.map(() => document.createElement("span"));
let current = 0;
let pressedAt = null;
let swiped = false;

function show(index) {
  const last = slides.length - 1;

  current = Math.min(Math.max(index, 0), last);

  slides.forEach((slide, position) => {
    slide.hidden = position !== current;
  });
  threads.forEach((thread, position) => {
    thread.classList.toggle("is-done", position <= current);
  });

  counter.textContent = `${current + 1} of ${slides.length}`;
  announcer.textContent = `Slide ${current + 1} of ${slides.length}: ${slides[current].querySelector("h1, h2").textContent}`;
  progress.setAttribute("aria-valuenow", current + 1);
  previous.disabled = current === 0;
  next.disabled = current === last;
  stage.scrollTop = 0;
}

function onKey(event) {
  const step = KEY_STEPS[event.key];
  const onControl = event.target.closest("a, button") !== null;

  if (step === undefined || event.altKey || event.ctrlKey || event.metaKey) {
    return;
  }
  // Space on a focused button or link belongs to that control.
  if (event.key === " " && onControl) {
    return;
  }

  event.preventDefault();
  show(current + step);
}

function onClick(event) {
  const selecting = String(document.getSelection()) !== "";

  if (swiped || selecting || event.target.closest("a, button") !== null) {
    return;
  }

  const bounds = stage.getBoundingClientRect();
  const inBackZone = event.clientX < bounds.left + bounds.width / 3;

  show(inBackZone ? current - 1 : current + 1);
}

function onRelease(event) {
  if (pressedAt === null) {
    return;
  }

  const across = event.clientX - pressedAt.x;
  const down = event.clientY - pressedAt.y;

  pressedAt = null;
  if (Math.abs(across) < SWIPE_DISTANCE || Math.abs(across) < Math.abs(down)) {
    return;
  }

  swiped = true;
  show(across < 0 ? current + 1 : current - 1);
}

document.documentElement.classList.add("is-live");
document.querySelector(".deck-nav").hidden = false;
progress.setAttribute("aria-valuemax", slides.length);
progress.append(...threads);

document.addEventListener("keydown", onKey);
stage.addEventListener("click", onClick);
stage.addEventListener("pointerup", onRelease);
stage.addEventListener("pointerdown", (event) => {
  swiped = false;
  pressedAt = { x: event.clientX, y: event.clientY };
});
previous.addEventListener("click", () => show(current - 1));
next.addEventListener("click", () => show(current + 1));

show(0);
