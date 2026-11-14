const SVG_NS = "http://www.w3.org/2000/svg";
const LINES_HEIGHT = 240;
const ROW_HEIGHT = 40;
const BAR_THICKNESS = 18;
const ARROW_STEPS = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };

function svgNode(tag, attrs, text) {
  const node = document.createElementNS(SVG_NS, tag);

  for (const [name, value] of Object.entries(attrs)) {
    node.setAttribute(name, value);
  }
  if (text !== undefined) {
    node.textContent = text;
  }

  return node;
}

function htmlNode(tag, className, text) {
  const node = document.createElement(tag);

  node.className = className;
  if (text !== undefined) {
    node.textContent = text;
  }

  return node;
}

function formatMoney(value) {
  if (value >= 1000) {
    return `$${(value / 1000).toFixed(2)}M`;
  }

  return `$${value}K`;
}

function formatValue(unit, value) {
  return unit === "count" ? value.toLocaleString("en-US") : formatMoney(value);
}

function formatTick(unit, value) {
  if (value === 0 || unit === "count") {
    return value.toLocaleString("en-US");
  }
  if (value >= 1000) {
    return `$${value / 1000}M`;
  }

  return `$${value}K`;
}

// A round axis: the smallest 1, 2, 2.5 or 5 step that covers the peak in about `count` ticks.
function axisFor(peak, count) {
  const rough = peak / count;
  const power = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 2.5, 5, 10].find((unit) => unit * power >= rough) * power;

  return { step, top: Math.ceil(peak / step) * step };
}

function barPath(x0, x1, y, roundEnd) {
  const bottom = y + BAR_THICKNESS;

  if (!roundEnd) {
    return `M${x0},${y}H${x1}V${bottom}H${x0}Z`;
  }

  const r = Math.min(4, (x1 - x0) / 2);

  return `M${x0},${y}H${x1 - r}Q${x1},${y} ${x1},${y + r}V${bottom - r}Q${x1},${bottom} ${x1 - r},${bottom}H${x0}Z`;
}

function drawLines(spec, width) {
  const box = { left: 46, right: spec.endLabel ? 58 : 20, top: 12, bottom: 28 };
  const plotWidth = width - box.left - box.right;
  const plotHeight = LINES_HEIGHT - box.top - box.bottom;
  const last = spec.labels.length - 1;
  const axis = axisFor(Math.max(...spec.series.flatMap((series) => series.values)), 4);
  const x = (index) => box.left + (plotWidth * index) / last;
  const y = (value) => box.top + plotHeight * (1 - value / axis.top);
  const svg = svgNode("svg", { width, height: LINES_HEIGHT, "aria-hidden": "true" });

  for (let value = 0; value <= axis.top; value += axis.step) {
    const rule = value === 0 ? "axis" : "grid";

    svg.append(svgNode("line", { class: rule, x1: box.left, x2: width - box.right, y1: y(value), y2: y(value) }));
    svg.append(svgNode("text", { class: "tick", x: box.left - 8, y: y(value) + 4, "text-anchor": "end" }, formatTick(spec.unit, value)));
  }

  const labelEvery = Math.max(1, Math.ceil(40 / (plotWidth / last)));

  spec.labels.forEach((label, index) => {
    if ((last - index) % labelEvery === 0) {
      svg.append(svgNode("text", { class: "tick", x: x(index), y: LINES_HEIGHT - 8, "text-anchor": "middle" }, label));
    }
  });

  for (const series of spec.series) {
    const route = series.values.map((value, index) => `${x(index)},${y(value)}`).join("L");

    if (spec.area) {
      svg.append(svgNode("path", { class: `area fill-${series.slot}`, d: `M${route}L${x(last)},${y(0)}L${x(0)},${y(0)}Z` }));
    }
    svg.append(svgNode("path", { class: `line stroke-${series.slot}`, d: `M${route}` }));
    svg.append(svgNode("circle", { class: `dot fill-${series.slot}`, cx: x(last), cy: y(series.values[last]), r: 4 }));
  }

  if (spec.endLabel) {
    const lead = spec.series[spec.series.length - 1].values[last];

    svg.append(svgNode("text", { class: "value-label", x: x(last) + 10, y: y(lead) + 4 }, formatValue(spec.unit, lead)));
  }

  const band = plotWidth / last;
  const points = spec.labels.map((label, index) => {
    const mark = svgNode("g", { class: "focus" });

    mark.append(svgNode("line", { class: "crosshair", x1: x(index), x2: x(index), y1: box.top, y2: y(0) }));
    for (const series of spec.series) {
      mark.append(svgNode("circle", { class: `dot fill-${series.slot}`, cx: x(index), cy: y(series.values[index]), r: 4 }));
    }
    svg.append(mark);

    return {
      title: label,
      rows: spec.series.map((series) => ({ key: `line stroke-${series.slot}`, name: series.name, value: series.values[index] })).reverse(),
      x: x(index),
      y: Math.min(...spec.series.map((series) => y(series.values[index]))),
      mark,
      hit: { x: x(index) - band / 2, y: box.top, width: band, height: plotHeight },
    };
  });

  return { svg, points };
}

function drawRows(spec, width) {
  const box = { left: 98, right: 62, top: 6, bottom: 26 };
  const plotWidth = width - box.left - box.right;
  const height = box.top + spec.labels.length * ROW_HEIGHT + box.bottom;
  const totals = spec.series.reduce((sums, series) => sums.map((sum, row) => sum + series.values[row]), spec.labels.map(() => 0));
  const axis = axisFor(Math.max(...totals, ...(spec.targets ?? [])), plotWidth < 240 ? 2 : 4);
  const x = (value) => box.left + (plotWidth * value) / axis.top;
  const svg = svgNode("svg", { width, height, "aria-hidden": "true" });

  for (let value = 0; value <= axis.top; value += axis.step) {
    const rule = value === 0 ? "axis" : "grid";

    svg.append(svgNode("line", { class: rule, x1: x(value), x2: x(value), y1: box.top, y2: height - box.bottom }));
    svg.append(svgNode("text", { class: "tick", x: x(value), y: height - 8, "text-anchor": "middle" }, formatTick(spec.unit, value)));
  }

  const points = spec.labels.map((label, row) => {
    const rowTop = box.top + row * ROW_HEIGHT;
    const barTop = rowTop + (ROW_HEIGHT - BAR_THICKNESS) / 2;
    const mark = svgNode("g", { class: "bar" });
    const rows = [];
    let start = 0;

    spec.series.forEach((series, index) => {
      const value = series.values[row];
      const isEnd = index === spec.series.length - 1;
      const gap = isEnd ? 0 : 2;

      mark.append(svgNode("path", { class: `fill-${series.slot}`, d: barPath(x(start), x(start + value) - gap, barTop, isEnd) }));
      rows.push({ key: `box fill-${series.slot}`, name: series.name, value });
      start += value;
    });

    let labelEdge = x(totals[row]);

    if (spec.targets) {
      const target = x(spec.targets[row]);

      mark.append(svgNode("line", { class: "target", x1: target, x2: target, y1: barTop - 5, y2: barTop + BAR_THICKNESS + 5 }));
      rows.push({ key: "target-key", name: "Target", value: spec.targets[row] });
      labelEdge = Math.max(labelEdge, target);
    }
    if (spec.series.length > 1) {
      rows.push({ key: "", name: "Total", value: totals[row] });
    }

    svg.append(mark);
    svg.append(svgNode("text", { class: "row-label", x: box.left - 10, y: barTop + 13, "text-anchor": "end" }, label));
    svg.append(svgNode("text", { class: "value-label", x: labelEdge + 8, y: barTop + 13 }, formatValue(spec.unit, totals[row])));

    return {
      title: label,
      rows,
      x: (box.left + x(totals[row])) / 2,
      y: barTop,
      mark,
      hit: { x: 0, y: rowTop, width, height: ROW_HEIGHT },
    };
  });

  return { svg, points };
}

function buildLegend(spec) {
  const legend = htmlNode("ul", "legend");
  const keyShape = spec.kind === "lines" ? "line stroke" : "box fill";
  const entries = spec.series.map((series) => ({ key: `${keyShape}-${series.slot}`, name: series.name }));

  if (spec.targets) {
    entries.push({ key: "target-key", name: "Target" });
  }
  for (const entry of entries) {
    const item = htmlNode("li", "");

    item.append(htmlNode("span", `key ${entry.key}`), entry.name);
    legend.append(item);
  }

  return legend;
}

// The table twin of a chart: every plotted value, readable without hover or sight of the marks.
function buildDataTable(spec) {
  const details = htmlNode("details", "data-table");
  const table = htmlNode("table", "");
  const head = table.createTHead().insertRow();
  const body = table.createTBody();
  const columns = spec.series.map((series) => ({ name: series.name, values: series.values }));

  if (spec.targets) {
    columns.push({ name: "Target", values: spec.targets });
  }

  head.append(htmlNode("th", "", spec.labelName));
  for (const column of columns) {
    head.append(htmlNode("th", "num", column.name));
  }

  spec.labels.forEach((label, row) => {
    const line = body.insertRow();
    const heading = htmlNode("th", "", label);

    heading.scope = "row";
    line.append(heading);
    for (const column of columns) {
      line.append(htmlNode("td", "num", formatValue(spec.unit, column.values[row])));
    }
  });

  const scroller = htmlNode("div", "table-scroll");

  scroller.append(table);
  details.append(htmlNode("summary", "", "Data table"), scroller);

  return details;
}

function fillTip(tip, spec, point) {
  tip.replaceChildren(htmlNode("p", "tip-title", point.title));

  for (const row of point.rows) {
    const line = htmlNode("p", "tip-row");

    line.append(htmlNode("span", `key ${row.key}`), htmlNode("strong", "", formatValue(spec.unit, row.value)), ` ${row.name}`);
    tip.append(line);
  }
}

function mountChart(figure, spec) {
  const title = figure.querySelector("h3").textContent;
  const frame = htmlNode("div", "frame");
  const plot = htmlNode("div", "plot");
  const tip = htmlNode("div", "tip");
  let points = [];
  let active = -1;
  let drawnWidth = 0;

  plot.tabIndex = 0;
  plot.setAttribute("role", "group");
  plot.setAttribute("aria-label", `${title}. Use the arrow keys to read each value, or open the data table below.`);
  tip.setAttribute("role", "status");
  tip.hidden = true;

  function activate(index) {
    points[active]?.mark.classList.remove("is-active");
    active = index;
    tip.hidden = index < 0;

    if (index < 0) {
      return;
    }

    const point = points[index];

    point.mark.classList.add("is-active");
    fillTip(tip, spec, point);

    const left = Math.min(Math.max(point.x - tip.offsetWidth / 2, 0), drawnWidth - tip.offsetWidth);

    tip.style.left = `${left}px`;
    tip.style.top = `${point.y - tip.offsetHeight - 10}px`;
  }

  function render() {
    const width = Math.floor(plot.clientWidth);

    if (width === 0 || width === drawnWidth) {
      return;
    }

    const drawn = spec.kind === "lines" ? drawLines(spec, width) : drawRows(spec, width);

    activate(-1);
    drawnWidth = width;
    points = drawn.points;

    points.forEach((point, index) => {
      const hit = svgNode("rect", { class: "hit", ...point.hit });

      hit.addEventListener("pointerenter", () => activate(index));
      hit.addEventListener("pointerdown", () => activate(index));
      drawn.svg.append(hit);
    });
    drawn.svg.addEventListener("pointerleave", () => activate(-1));
    plot.replaceChildren(drawn.svg);
  }

  plot.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      activate(-1);
      return;
    }

    const step = ARROW_STEPS[event.key];

    if (step === undefined) {
      return;
    }

    event.preventDefault();
    activate(Math.min(Math.max(active + step, 0), points.length - 1));
  });
  plot.addEventListener("blur", () => activate(-1));

  frame.append(plot, tip);
  if (spec.series.length > 1 || spec.targets) {
    figure.append(buildLegend(spec));
  }
  figure.append(frame, buildDataTable(spec));
  render();
  new ResizeObserver(render).observe(plot);
}

const reportCharts = JSON.parse(document.getElementById("report-data").textContent);

for (const figure of document.querySelectorAll("figure[data-chart]")) {
  mountChart(figure, reportCharts[figure.dataset.chart]);
}
