// Norway's wind farms with WeatherNext 3 wind at 100 m, on one timeline.
// Before the run start: the past days as the model saw them (data/history.json).
// From the run start: the forecast from the newest 72-hour run (data/forecast.json).
// Farms come from data/farms.geojson. Either time file may be missing.

const HOUR_MS = 3600 * 1000;
// A generic turbine: idle below cut-in, full power from rated, shut down at cut-out.
const CUT_IN = 3;
const RATED = 12;
const CUT_OUT = 25;
const COLOR = {
  idle: "#d3d8dc",
  idleTag: "#5b6b78",
  none: "#ffffff",
  cutout: "#c2410c",
  ink: "#1c2a35",
  soft: "#5b6b78",
  band: "#c9dceb",
  deep: "#0f3d63",
  history: "#f1f3f5",
  forecast: "#eaf2f9",
};
const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// Every time on the page is in the viewer's own time zone.
const timeFormat = new Intl.DateTimeFormat("en-GB", {
  weekday: "short",
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  timeZoneName: "short",
});
const dayFormat = new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric" });
const shortFormat = new Intl.DateTimeFormat("en-GB", { weekday: "short", hour: "2-digit", minute: "2-digit" });
const clockFormat = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit" });

function localLabel(ms) {
  return timeFormat.format(new Date(ms));
}

// How far an hour is from the actual time now.
function fromNow(ms) {
  const hours = Math.round((ms - Date.now()) / HOUR_MS);
  if (hours === 0) return "this hour";
  const size = Math.abs(hours);
  const amount = size >= 48 ? `${Math.round(size / 24)} days` : `${size} h`;
  return hours > 0 ? `in ${amount}` : `${amount} ago`;
}

// Light to deep blue between cut-in and rated speed, grey below, rust above cut-out.
function windColor(speed) {
  if (speed >= CUT_OUT) return COLOR.cutout;
  if (speed < CUT_IN) return COLOR.idle;
  const t = Math.min(1, (speed - CUT_IN) / (RATED - CUT_IN));
  return `hsl(206, ${58 + t * 8}%, ${72 - t * 42}%)`;
}

function windState(speed) {
  if (speed >= CUT_OUT) return "Above cut-out";
  if (speed >= RATED) return "Full power";
  if (speed >= CUT_IN) return "Turning";
  return "Idle";
}

function radiusFor(mw) {
  return 4 + Math.sqrt(mw) * 0.9;
}

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
  node.append(...children);
  return node;
}

async function loadOptionalJson(path) {
  const response = await fetch(path).catch(() => null);
  return response?.ok ? response.json() : null;
}

const map = L.map("map", {
  zoomSnap: 0.5,
  zoomAnimation: !reduceMotion,
  fadeAnimation: !reduceMotion,
  markerZoomAnimation: !reduceMotion,
});
L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 12,
  attribution: "&copy; OpenStreetMap contributors, wind farms NVE (NLOD), wind WeatherNext 3 by Google DeepMind",
}).addTo(map);

// runMs is when the newest forecast run started: history before it, forecast after.
const state = { farms: [], times: [], index: 0, runMs: null, hasForecast: false, selected: null, timer: null };

const runEl = document.getElementById("run");
const farmEl = document.getElementById("farm");
const listEl = document.getElementById("farm-list");
const chartEl = document.getElementById("chart");
const tipEl = document.getElementById("tip");
const playEl = document.getElementById("play");

const currentTime = () => state.times[state.index];
const kindOf = (t) => (state.hasForecast && t > state.runMs ? "forecast" : "history, as the model saw it");
const stepAt = (farm) => farm.byTime.get(currentTime());

function render() {
  const t = currentTime();
  for (const farm of state.farms) {
    const step = farm.byTime.get(t);
    const selected = farm === state.selected;
    farm.dot.setStyle({
      fillColor: step ? windColor(step.p50) : COLOR.none,
      color: selected ? COLOR.ink : "#4d5b66",
      weight: selected ? 3 : 1,
    });
    farm.halo.setStyle({ fillColor: step ? windColor(step.p50) : COLOR.none });
    farm.halo.setRadius(step ? radiusFor(farm.props.capacity_mw) + (step.p90 - step.p10) * 1.5 : 0);
  }
  state.selected?.dot.bringToFront();
  document.getElementById("time-label").textContent = localLabel(t);
  document.getElementById("time-kind").textContent = `${fromNow(t)}, ${kindOf(t)}`;
  document.getElementById("series-farm").textContent = state.selected ? `Wind at ${state.selected.props.name}` : "";
  renderFarm();
  renderList();
  renderChart();
}

function renderFarm() {
  const farm = state.selected;
  if (!farm) {
    farmEl.replaceChildren(el("p", { class: "empty" }, "Choose a farm on the map or in the list."));
    return;
  }
  const p = farm.props;
  const fact = (value, label) => el("div", {}, el("dt", {}, label), el("dd", {}, value));
  const step = state.times.length ? stepAt(farm) : null;
  const nodes = [
    el("h2", {}, p.name),
    el("p", { class: "place" }, `${p.municipality}, ${p.county}, price area ${p.price_area}`),
    el("dl", { class: "facts" },
      fact(`${p.capacity_mw} MW`, "Capacity"),
      fact(String(p.turbines), "Turbines"),
      fact(`${p.hub_height_m} m`, "Hub height"),
    ),
  ];
  if (step) {
    const tag = el("span", { class: "tag" }, windState(step.p50));
    tag.style.background = step.p50 < CUT_IN ? COLOR.idleTag : windColor(Math.max(step.p50, RATED));
    nodes.push(
      el("p", { class: "speed" }, el("strong", {}, step.p50.toFixed(1)), el("span", {}, "m/s")),
      el("p", { class: "state" }, tag,
        el("span", { class: "range" },
          `80% of forecasts between ${step.p10.toFixed(1)} and ${step.p90.toFixed(1)} m/s`)),
    );
  } else {
    nodes.push(el("p", { class: "place" }, "No wind data for this farm at this hour."));
  }
  farmEl.replaceChildren(...nodes);
}

// The rows are made once and only reordered and updated, so a click or the
// keyboard focus survives the list changing. While Play runs, the order stays
// put and only the values change, so a row doesn't move away from the pointer.
function renderList() {
  const playing = Boolean(state.timer);
  document.getElementById("ranking-title").textContent =
    playing ? "Wind at this hour" : "Windiest at this hour";
  const ranked = state.farms.map((farm) => ({ farm, step: stepAt(farm) }));
  if (!playing) ranked.sort((a, b) => (b.step?.p50 ?? -1) - (a.step?.p50 ?? -1));
  const top = Math.max(CUT_OUT, ...ranked.map((r) => r.step?.p90 ?? 0));
  const focused = document.activeElement;
  ranked.forEach(({ farm, step }, i) => {
    const row = farm.row;
    row.button.setAttribute("aria-current", String(farm === state.selected));
    row.fill.style.width = step ? `${Math.min(100, (step.p50 / top) * 100)}%` : "0";
    row.fill.style.background = step ? windColor(step.p50) : "none";
    row.value.textContent = step ? `${step.p50.toFixed(1)} m/s` : "no data";
    if (!playing && listEl.children[i] !== row.item) listEl.insertBefore(row.item, listEl.children[i] ?? null);
  });
  if (focused && listEl.contains(focused) && document.activeElement !== focused) {
    focused.focus({ preventScroll: true });
  }
}

function makeRow(farm) {
  const fill = el("i");
  const value = el("span", { class: "value" });
  const button = el("button", { type: "button" }, el("span", {}, farm.props.name), el("span", { class: "bar" }, fill), value);
  button.addEventListener("click", () => selectFarm(farm, true));
  return { item: el("li", {}, button), button, fill, value };
}

function selectFarm(farm, pan) {
  state.selected = farm;
  if (pan) map.panTo(farm.dot.getLatLng(), { animate: !reduceMotion });
  if (state.times.length) render();
  else renderFarm();
}

// The timeline is the chosen farm's wind: the P10 to P90 band, the median, and
// the generic turbine's thresholds, over the history and the forecast. Gaps in
// the data stay blank.
function renderChart() {
  const w = chartEl.clientWidth || 600;
  const h = chartEl.clientHeight || 160;
  const narrow = w < 560;
  const pad = { left: 44, right: narrow ? 52 : 108, top: 24, bottom: 22 };
  const t0 = state.times[0];
  const t1 = state.times.at(-1);
  const x = (ms) => pad.left + ((Math.min(Math.max(ms, t0), t1) - t0) / Math.max(t1 - t0, 1)) * (w - pad.left - pad.right);
  const steps = state.selected?.steps ?? [];
  const top = Math.max(28, ...steps.map((s) => s.p90));
  const y = (v) => h - pad.bottom - (v / top) * (h - pad.top - pad.bottom);
  const plotTop = pad.top;
  const plotBottom = h - pad.bottom;
  const parts = [];

  // History and forecast as two labelled areas, split at the run start.
  const split = state.hasForecast ? x(state.runMs) : x(t1);
  parts.push(`<rect x="${pad.left}" y="${plotTop}" width="${split - pad.left}" height="${plotBottom - plotTop}" fill="${COLOR.history}"/>`);
  if (state.hasForecast) {
    parts.push(`<rect x="${split}" y="${plotTop}" width="${x(t1) - split}" height="${plotBottom - plotTop}" fill="${COLOR.forecast}"/>`);
  }
  if (split - pad.left > 150) {
    parts.push(`<text class="region" x="${pad.left + 6}" y="${plotTop - 8}">History, as the model saw it</text>`);
  }
  if (state.hasForecast) {
    const hours = Math.round((t1 - state.runMs) / HOUR_MS);
    const label = narrow ? `Forecast, ${hours} h` : `WeatherNext forecast, ${hours} h from the ${shortFormat.format(state.runMs)} run`;
    parts.push(`<text class="region" x="${split + 6}" y="${plotTop - 8}">${label}</text>`);
  }
  // Day ticks at local midnight, labelled every day or every few days, whatever fits.
  const dayWidth = x(t0 + 24 * HOUR_MS) - x(t0);
  const every = Math.max(1, Math.ceil(48 / dayWidth));
  const day = new Date(t0);
  day.setHours(24, 0, 0, 0);
  for (let i = 0; day.getTime() <= t1; day.setDate(day.getDate() + 1), i++) {
    const dx = x(day.getTime());
    parts.push(`<line x1="${dx}" x2="${dx}" y1="${plotTop}" y2="${plotBottom}" stroke="#dde4e9"/>`);
    if (i % every === 0) parts.push(`<text x="${dx + 4}" y="${h - 6}">${dayFormat.format(day)}</text>`);
  }
  // Turbine thresholds.
  for (const [v, label, stroke] of [[CUT_IN, "starts", "#9aa6af"], [RATED, "full power", "#9aa6af"], [CUT_OUT, "shuts down", COLOR.cutout]]) {
    parts.push(`<line x1="${pad.left}" x2="${w - pad.right}" y1="${y(v)}" y2="${y(v)}" stroke="${stroke}"
      stroke-dasharray="2 4"/><text x="${w - pad.right + 6}" y="${y(v) + 4}">${v} m/s${narrow ? "" : ` ${label}`}</text>`);
  }
  // Band and median, split wherever an hour is missing. A lone hour gets a dot.
  const runs = [];
  for (const s of steps) {
    const last = runs.at(-1);
    if (last && s.ms - last.at(-1).ms <= HOUR_MS) last.push(s);
    else runs.push([s]);
  }
  for (const run of runs) {
    if (run.length === 1) {
      parts.push(`<circle cx="${x(run[0].ms)}" cy="${y(run[0].p50)}" r="2" fill="${COLOR.deep}"/>`);
      continue;
    }
    const upper = run.map((s) => `${x(s.ms)},${y(s.p90)}`);
    const lower = run.map((s) => `${x(s.ms)},${y(s.p10)}`).reverse();
    parts.push(`<polygon points="${[...upper, ...lower].join(" ")}" fill="${COLOR.band}"/>
      <polyline points="${run.map((s) => `${x(s.ms)},${y(s.p50)}`).join(" ")}" fill="none"
      stroke="${COLOR.deep}" stroke-width="2"/>`);
  }
  // The run start, and the actual time now.
  if (state.hasForecast) {
    parts.push(`<line x1="${split}" x2="${split}" y1="${plotTop}" y2="${plotBottom}" stroke="${COLOR.soft}" stroke-dasharray="3 3"/>`);
  }
  const now = Date.now();
  if (now >= t0 && now <= t1) {
    const nx = x(now);
    parts.push(`<line x1="${nx}" x2="${nx}" y1="${plotTop}" y2="${plotBottom}" stroke="${COLOR.ink}"/>
      <path d="M ${nx - 5} ${plotTop} L ${nx + 5} ${plotTop} L ${nx} ${plotTop + 6} Z" fill="${COLOR.ink}"/>
      <text class="now" x="${nx + 5}" y="${plotBottom - 4}">Now ${clockFormat.format(now)}</text>`);
  }
  // The chosen hour.
  const t = currentTime();
  const step = state.selected?.byTime.get(t);
  parts.push(`<line x1="${x(t)}" x2="${x(t)}" y1="${plotTop}" y2="${plotBottom}" stroke="${COLOR.deep}" stroke-width="2"/>`);
  if (step) {
    parts.push(`<circle cx="${x(t)}" cy="${y(step.p50)}" r="5" fill="${windColor(step.p50)}" stroke="#fff" stroke-width="2"/>`);
  }
  parts.push(`<text x="2" y="${y(0) + 4}">0</text><text x="2" y="${y(top) + 10}">${Math.round(top)} m/s</text>`);
  chartEl.innerHTML = `<svg viewBox="0 0 ${w} ${h}" aria-hidden="true">${parts.join("")}</svg>`;
  chartEl.setAttribute("aria-valuemin", "0");
  chartEl.setAttribute("aria-valuemax", String(state.times.length - 1));
  chartEl.setAttribute("aria-valuenow", String(state.index));
  chartEl.setAttribute("aria-valuetext",
    `${localLabel(t)}, ${fromNow(t)}, ${kindOf(t)}${step ? `, ${state.selected.props.name} ${step.p50.toFixed(1)} m/s` : ""}`);
  chartEl.dataset.left = pad.left;
  chartEl.dataset.right = pad.right;
}

// The index of the hour nearest to a given time.
function indexOfTime(ms) {
  let best = 0;
  state.times.forEach((t, i) => {
    if (Math.abs(t - ms) < Math.abs(state.times[best] - ms)) best = i;
  });
  return best;
}

// The index of the hour nearest to a point on the timeline.
function indexAt(clientX) {
  const box = chartEl.getBoundingClientRect();
  const left = Number(chartEl.dataset.left);
  const right = Number(chartEl.dataset.right);
  const share = (clientX - box.left - left) / Math.max(box.width - left - right, 1);
  return indexOfTime(state.times[0] + Math.min(1, Math.max(0, share)) * (state.times.at(-1) - state.times[0]));
}

// The first hour at least a day later, or the last at least a day earlier.
function dayAway(direction) {
  const target = currentTime() + direction * 24 * HOUR_MS;
  if (direction > 0) {
    const i = state.times.findIndex((t) => t >= target);
    return i === -1 ? state.times.length - 1 : i;
  }
  return Math.max(0, state.times.findLastIndex((t) => t <= target));
}

function setIndex(index) {
  state.index = Math.min(state.times.length - 1, Math.max(0, index));
  render();
}

function showTip(index, clientX) {
  const t = state.times[index];
  const step = state.selected?.byTime.get(t);
  tipEl.textContent = `${localLabel(t)}${step ? `, ${step.p50.toFixed(1)} m/s` : ""}`;
  tipEl.hidden = false;
  const box = tipEl.parentElement.getBoundingClientRect();
  const left = Math.min(box.width - tipEl.offsetWidth - 8, Math.max(8, clientX - box.left + 10));
  tipEl.style.left = `${left}px`;
  tipEl.style.top = `${chartEl.offsetTop - 4}px`;
}

function stopPlay() {
  if (!state.timer) return;
  clearInterval(state.timer);
  state.timer = null;
  playEl.textContent = "Play";
  renderList();
}

function wireTimeline() {
  let dragging = false;
  let touchStart = null;
  const grab = (event) => {
    dragging = true;
    chartEl.setPointerCapture(event.pointerId);
    stopPlay();
    setIndex(indexAt(event.clientX));
  };
  // A mouse sets the hour at once. A finger only does once it moves sideways or
  // lifts without moving, so swiping up or down over the chart still scrolls.
  chartEl.addEventListener("pointerdown", (event) => {
    if (event.pointerType === "touch") touchStart = { x: event.clientX, y: event.clientY };
    else grab(event);
  });
  chartEl.addEventListener("pointermove", (event) => {
    if (touchStart && !dragging) {
      const dx = Math.abs(event.clientX - touchStart.x);
      if (dx > 8 && dx > Math.abs(event.clientY - touchStart.y)) grab(event);
      return;
    }
    const index = indexAt(event.clientX);
    if (dragging && index !== state.index) setIndex(index);
    showTip(index, event.clientX);
  });
  const end = () => {
    dragging = false;
    touchStart = null;
    tipEl.hidden = true;
  };
  chartEl.addEventListener("pointerup", (event) => {
    if (touchStart && !dragging) {
      stopPlay();
      setIndex(indexAt(event.clientX));
    }
    end();
  });
  chartEl.addEventListener("pointercancel", end);
  chartEl.addEventListener("pointerleave", end);
  // The usual slider keys: up and right go later, Page Up and Page Down a day.
  // The arrows step to the next hour that has data, so they cross any gap.
  chartEl.addEventListener("keydown", (event) => {
    const step = { ArrowLeft: -1, ArrowDown: -1, ArrowRight: 1, ArrowUp: 1 }[event.key];
    const day = { PageDown: -1, PageUp: 1 }[event.key];
    if (step) setIndex(state.index + step);
    else if (day) setIndex(dayAway(day));
    else if (event.key === "Home") setIndex(0);
    else if (event.key === "End") setIndex(state.times.length - 1);
    else return;
    stopPlay();
    event.preventDefault();
  });
  playEl.addEventListener("click", () => {
    if (state.timer) return stopPlay();
    if (state.index >= state.times.length - 1) setIndex(0);
    playEl.textContent = "Pause";
    state.timer = setInterval(() => {
      if (state.index >= state.times.length - 1) return stopPlay();
      setIndex(state.index + 1);
    }, 140);
  });
  window.addEventListener("resize", renderChart);
}

async function main() {
  const response = await fetch("data/farms.geojson");
  if (!response.ok) throw new Error(`data/farms.geojson: ${response.status}`);
  const farms = await response.json();
  const [history, forecast] = await Promise.all([
    loadOptionalJson("data/history.json"),
    loadOptionalJson("data/forecast.json"),
  ]);

  // The run start is where the history ends and the forecast begins.
  state.hasForecast = Boolean(forecast);
  const runIso = forecast?.init_time ?? history?.end;
  state.runMs = runIso ? Date.parse(runIso) : null;

  state.farms = farms.features.map((feature) => {
    const [lon, lat] = feature.geometry.coordinates;
    const props = feature.properties;
    const id = String(props.id);
    const withMs = (s) => ({ ...s, ms: Date.parse(s.time) });
    // History up to and including the run start, forecast strictly after, so
    // the two never overlap even if the files came from different runs.
    const steps = [
      ...(history?.farms[id] ?? []).map(withMs).filter((s) => s.ms <= state.runMs),
      ...(forecast?.farms[id] ?? []).map(withMs).filter((s) => s.ms > state.runMs),
    ].sort((a, b) => a.ms - b.ms);
    const halo = L.circleMarker([lat, lon], {
      radius: 0,
      stroke: false,
      fillOpacity: 0.2,
      interactive: false,
    }).addTo(map);
    const dot = L.circleMarker([lat, lon], {
      radius: radiusFor(props.capacity_mw),
      weight: 1,
      color: "#4d5b66",
      fillColor: COLOR.none,
      fillOpacity: 0.92,
    }).addTo(map);
    const farm = { props, steps, byTime: new Map(steps.map((s) => [s.ms, s])), dot, halo };
    farm.row = makeRow(farm);
    // An element, not a string, so the name is shown as text and never as HTML.
    dot.bindTooltip(el("span", {}, props.name), { direction: "top", offset: [0, -6] });
    dot.on("click", () => selectFarm(farm, false));
    return farm;
  });
  const fit = () => {
    map.invalidateSize();
    map.fitBounds(L.latLngBounds(state.farms.map((f) => f.dot.getLatLng())), { padding: [24, 24] });
  };

  state.times = [...new Set(state.farms.flatMap((f) => [...f.byTime.keys()]))].sort((a, b) => a - b);
  if (!state.times.length) {
    runEl.textContent = "No wind data loaded yet.";
    document.getElementById("ranking").hidden = true;
    document.getElementById("timeline").hidden = true;
    farmEl.replaceChildren(el("p", { class: "empty" }, "No wind data loaded yet. Choose a farm on the map to see its details."));
    fit();
    return;
  }
  runEl.textContent = state.hasForecast
    ? `Wind at 100 m from WeatherNext 3. Newest forecast run started ${localLabel(state.runMs)}.`
    : `Wind at 100 m from WeatherNext 3. History up to ${localLabel(state.runMs)}.`;
  if (Date.now() > state.times.at(-1) + HOUR_MS) {
    runEl.textContent += ` The data ended ${fromNow(state.times.at(-1))}, so it is out of date.`;
  }
  // Open at the current hour, or as close to it as the data goes, on the windiest farm.
  state.index = indexOfTime(Date.now());
  state.selected = state.farms.reduce((best, farm) =>
    (stepAt(farm)?.p50 ?? -1) > (stepAt(best)?.p50 ?? -1) ? farm : best);
  // The map needs a view before its dots can be styled, and fitting again after
  // the first render, once the header and timeline have their final height.
  fit();
  wireTimeline();
  render();
  fit();
}

main().catch((error) => {
  runEl.textContent = `Could not load the map data: ${error.message}`;
  document.getElementById("ranking").hidden = true;
  document.getElementById("timeline").hidden = true;
  map.invalidateSize();
  map.setView([65, 14], 4.5);
});
