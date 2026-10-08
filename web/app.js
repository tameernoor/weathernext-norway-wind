// Map of Norway's wind farms with WeatherNext 3 wind at 100 m, on one timeline.
// Left of "now": the past days as the model saw them (data/history.json).
// Right of "now": the forecast from the newest run (data/forecast.json).
// Farms come from data/farms.geojson. Either time file may be missing.

const map = L.map("map").setView([65, 13], 5);
L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 12,
  attribution: "&copy; OpenStreetMap contributors · Wind farms: NVE (NLOD)",
}).addTo(map);

const statusEl = document.getElementById("status");
const slider = document.getElementById("time-slider");
const timeLabel = document.getElementById("time-label");
const HOUR_MS = 3600 * 1000;

// Sequential scale: pale when idle, deep blue at full output.
function outputColor(share) {
  const light = 88 - share * 58;
  return `hsl(212, 70%, ${light}%)`;
}

function radiusFor(mw) {
  return 4 + Math.sqrt(mw) * 0.9;
}

// Every time on the page is in the viewer's own time zone.
const timeFormat = new Intl.DateTimeFormat("en-GB", {
  weekday: "short",
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  timeZoneName: "short",
});

function localLabel(ms) {
  return timeFormat.format(new Date(ms));
}

function relativeLabel(ms, nowMs) {
  const hours = Math.round((ms - nowMs) / HOUR_MS);
  if (hours === 0) return "now";
  if (Math.abs(hours) >= 48) return `${hours > 0 ? "+" : "−"}${Math.round(Math.abs(hours) / 24)} d`;
  return `${hours >= 0 ? "+" : "−"}${Math.abs(hours)} h`;
}

async function loadOptionalJson(path) {
  const response = await fetch(path).catch(() => null);
  return response?.ok ? response.json() : null;
}

const CHART = { w: 280, h: 110, pad: 22 };
const CHART_HINT = "Point at the chart for each hour's values. Click to show that hour on the map.";

function chartScales(steps) {
  const { w, h, pad } = CHART;
  const first = steps[0].ms, last = steps.at(-1).ms;
  const maxWind = Math.max(25, ...steps.map((s) => s.p90));
  return {
    first,
    last,
    maxWind,
    x: (ms) => pad + ((ms - first) / Math.max(last - first, 1)) * (w - pad * 2),
    y: (v) => h - pad - (v / maxWind) * (h - pad * 2),
  };
}

// Small SVG fan chart: P10–P90 band, median line, and a line at "now".
function bandChart(steps, nowMs) {
  const { w, h, pad } = CHART;
  const { first, last, maxWind, x, y } = chartScales(steps);
  const upper = steps.map((s) => `${x(s.ms)},${y(s.p90)}`);
  const lower = steps.map((s) => `${x(s.ms)},${y(s.p10)}`).reverse();
  const median = steps.map((s) => `${x(s.ms)},${y(s.p50)}`).join(" ");
  const nowLine = nowMs >= first && nowMs <= last
    ? `<line x1="${x(nowMs)}" x2="${x(nowMs)}" y1="${pad / 2}" y2="${h - pad}"
         stroke="#1c2430" stroke-dasharray="3 3"/>
       <text x="${x(nowMs) + 3}" y="${pad / 2 + 8}">now</text>`
    : "";
  return `
    <svg class="band-chart" width="${w}" height="${h}" role="img" tabindex="0"
         aria-label="Wind at 100 m, P10 to P90, past and forecast. Arrow keys, Home and End step through the hours; Enter shows that hour on the map.">
      <polygon points="${[...upper, ...lower].join(" ")}" fill="hsl(212,70%,85%)"/>
      <polyline points="${median}" fill="none" stroke="hsl(212,70%,35%)" stroke-width="2"/>
      ${nowLine}
      <text x="2" y="${y(maxWind) + 4}">${Math.round(maxWind)} m/s</text>
      <text x="2" y="${h - pad + 4}">0</text>
      <text x="${pad}" y="${h - 4}">${relativeLabel(first, nowMs)}</text>
      <text x="${w - pad - 26}" y="${h - 4}">${relativeLabel(last, nowMs)}</text>
      <line class="hair" y1="${pad / 2}" y2="${h - pad}" visibility="hidden"/>
      <circle class="hair-dot" r="4" visibility="hidden"/>
      <rect class="hit" width="${w}" height="${h}" fill="transparent"/>
    </svg>`;
}

function popupHtml(props, steps, nowMs) {
  const head = `<strong>${props.name}</strong><br>
    ${props.capacity_mw} MW · ${props.turbines} turbines · hub ${props.hub_height_m} m<br>
    ${props.municipality}, ${props.price_area}`;
  if (!steps.length) return head;
  return `${head}<br>${bandChart(steps, nowMs)}
    <div class="chart-readout" aria-live="polite">${CHART_HINT}</div>
    <small>Shaded = 80% of forecasts (P10–P90), line = median.<br>
    Left of now: what the model saw an hour ahead. Right: the forecast.</small>`;
}

// Pointing, tapping or the arrow keys show one hour's values under the chart.
// A click, Enter or Space moves the map's slider to that hour.
function wireChart(container, steps, nowMs, pick) {
  const svg = container.querySelector(".band-chart");
  const readout = container.querySelector(".chart-readout");
  if (!svg || !readout) return;
  const { x, y } = chartScales(steps);
  const hair = svg.querySelector(".hair");
  const marker = svg.querySelector(".hair-dot");
  let current = Math.max(0, steps.findLastIndex((s) => s.ms <= nowMs));

  function show(index) {
    current = index;
    const s = steps[index];
    hair.setAttribute("x1", x(s.ms));
    hair.setAttribute("x2", x(s.ms));
    marker.setAttribute("cx", x(s.ms));
    marker.setAttribute("cy", y(s.p50));
    hair.setAttribute("visibility", "visible");
    marker.setAttribute("visibility", "visible");
    const strong = (text) => Object.assign(document.createElement("strong"), { textContent: text });
    readout.replaceChildren(
      `${localLabel(s.ms)} (${relativeLabel(s.ms, nowMs)})`,
      document.createElement("br"),
      strong(`${s.p50.toFixed(1)} m/s`),
      " median · ",
      strong(`${s.p10.toFixed(1)}–${s.p90.toFixed(1)} m/s`),
      // Non-breaking spaces keep "output ≈ 35%" on one line.
      " low to high · output\u00a0≈\u00a0",
      strong(`${Math.round(s.output_p50 * 100)}%`),
      " (rough)",
    );
  }

  function hide() {
    hair.setAttribute("visibility", "hidden");
    marker.setAttribute("visibility", "hidden");
    readout.textContent = CHART_HINT;
  }

  function nearest(event) {
    const box = svg.getBoundingClientRect();
    const px = ((event.clientX - box.left) / box.width) * CHART.w;
    let best = 0;
    steps.forEach((s, i) => {
      if (Math.abs(x(s.ms) - px) < Math.abs(x(steps[best].ms) - px)) best = i;
    });
    return best;
  }

  svg.addEventListener("pointermove", (event) => show(nearest(event)));
  svg.addEventListener("pointerdown", (event) => show(nearest(event)));
  // On a touch screen the values stay after the finger lifts.
  svg.addEventListener("pointerleave", (event) => event.pointerType === "mouse" && hide());
  // Pick the hour the readout shows. Recomputing it from the click's position
  // can land on the next hour, since clicks round to whole pixels.
  svg.addEventListener("click", () => pick(steps[current].ms));
  svg.addEventListener("focus", () => show(current));
  svg.addEventListener("blur", hide);
  svg.addEventListener("keydown", (event) => {
    const moves = { ArrowLeft: -1, ArrowRight: 1, Home: -Infinity, End: Infinity };
    if (event.key in moves) {
      show(Math.min(steps.length - 1, Math.max(0, current + moves[event.key])));
    } else if (event.key === "Enter" || event.key === " ") {
      pick(steps[current].ms);
    } else {
      return;
    }
    event.preventDefault();
  });
}

async function main() {
  const response = await fetch("data/farms.geojson");
  if (!response.ok) throw new Error(`data/farms.geojson: ${response.status}`);
  const farms = await response.json();
  const [history, forecast] = await Promise.all([
    loadOptionalJson("data/history.json"),
    loadOptionalJson("data/forecast.json"),
  ]);

  // "Now" is where the history ends and the forecast begins.
  const nowIso = forecast?.init_time ?? history?.end;
  const nowMs = nowIso ? Date.parse(nowIso) : null;

  const layers = farms.features.map((feature) => {
    const [lon, lat] = feature.geometry.coordinates;
    const props = feature.properties;
    const id = String(props.id);
    const withMs = (s) => ({ ...s, ms: Date.parse(s.time) });
    // History up to and including now, forecast strictly after, so the two
    // never overlap even if the files came from different runs.
    const steps = [
      ...(history?.farms[id] ?? []).map(withMs).filter((s) => s.ms <= nowMs),
      ...(forecast?.farms[id] ?? []).map(withMs).filter((s) => s.ms > nowMs),
    ].sort((a, b) => a.ms - b.ms);
    const halo = L.circleMarker([lat, lon], {
      radius: 0,
      stroke: false,
      fillOpacity: 0.18,
      interactive: false,
    }).addTo(map);
    const dot = L.circleMarker([lat, lon], {
      radius: radiusFor(props.capacity_mw),
      color: "#1c2430",
      weight: 1,
      fillOpacity: 0.9,
      fillColor: "#9aa3ad",
    }).addTo(map);
    dot.bindPopup(popupHtml(props, steps, nowMs));
    // Leaflet rebuilds the popup's content on every open, including a second
    // click on the same dot, and fires contentupdate each time.
    dot.getPopup().on("contentupdate", (event) =>
      wireChart(event.target.getElement(), steps, nowMs, (ms) => pickTime(ms)),
    );
    return { props, byTime: new Map(steps.map((s) => [s.ms, s])), dot, halo };
  });

  const times = [...new Set(layers.flatMap((l) => [...l.byTime.keys()]))].sort((a, b) => a - b);
  if (!times.length) {
    statusEl.textContent =
      `${layers.length} wind farms. Run \`wnw forecast\` or the dbt route to add wind data.`;
    return;
  }

  slider.max = times.length - 1;
  // Start at the last hour that is not in the future.
  slider.value = Math.max(0, times.filter((t) => t <= nowMs).length - 1);
  // A tick on the slider where "now" is.
  document.getElementById("now-mark").innerHTML = `<option value="${slider.value}"></option>`;
  document.getElementById("time-control").hidden = false;
  statusEl.textContent =
    `${layers.length} wind farms · now = ${localLabel(nowMs)} · ` +
    `${relativeLabel(times[0], nowMs)} to ${relativeLabel(times.at(-1), nowMs)}`;

  function render(index) {
    const t = times[index];
    let expectedMw = 0;
    let capacityMw = 0;
    for (const { props, byTime, dot, halo } of layers) {
      const step = byTime.get(t);
      if (!step) {
        dot.setStyle({ fillColor: "#9aa3ad" });
        halo.setRadius(0);
        continue;
      }
      dot.setStyle({ fillColor: outputColor(step.output_p50) });
      halo.setStyle({ fillColor: outputColor(step.output_p50) });
      halo.setRadius(radiusFor(props.capacity_mw) + (step.p90 - step.p10) * 1.5);
      expectedMw += props.capacity_mw * step.output_p50;
      capacityMw += props.capacity_mw;
    }
    const kind = t <= nowMs ? "model at the time" : "median forecast";
    timeLabel.textContent =
      `${localLabel(t)} (${relativeLabel(t, nowMs)}) · ${kind} ≈ ` +
      // To the nearest 100 MW: a generic power curve can't do better.
      `${(Math.round(expectedMw / 100) * 100).toLocaleString("en-GB")} of ` +
      `${Math.round(capacityMw).toLocaleString("en-GB")} MW (rough)`;
  }

  // A click in a farm's chart moves the slider, and so the whole map, to that hour.
  function pickTime(ms) {
    const index = times.indexOf(ms);
    if (index < 0) return;
    slider.value = index;
    render(index);
  }

  slider.addEventListener("input", () => render(Number(slider.value)));
  render(Number(slider.value));
}

main().catch((error) => {
  statusEl.textContent = `Could not load data: ${error.message}`;
});
