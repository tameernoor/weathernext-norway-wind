// Map of Norway's wind farms with the WeatherNext 3 100 m wind forecast.
// Reads data/farms.geojson (from `wnw farms`) and, if present,
// data/forecast.json (from `wnw forecast`).

const map = L.map("map").setView([65, 13], 5);
L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 12,
  attribution: "&copy; OpenStreetMap contributors · Wind farms: NVE (NLOD)",
}).addTo(map);

const statusEl = document.getElementById("status");
const slider = document.getElementById("time-slider");
const timeLabel = document.getElementById("time-label");

// Sequential scale: pale when idle, deep blue at full output.
function outputColor(share) {
  const light = 88 - share * 58;
  return `hsl(212, 70%, ${light}%)`;
}

function radiusFor(mw) {
  return 4 + Math.sqrt(mw) * 0.9;
}

async function loadJson(path) {
  const response = await fetch(path);
  if (!response.ok) throw new Error(`${path}: ${response.status}`);
  return response.json();
}

// Small SVG fan chart: P10–P90 band with the median line, wind in m/s.
function bandChart(steps) {
  const w = 260, h = 110, pad = 22;
  const maxWind = Math.max(25, ...steps.map((s) => s.p90));
  const x = (i) => pad + (i / (steps.length - 1)) * (w - pad * 2);
  const y = (v) => h - pad - (v / maxWind) * (h - pad * 2);
  const upper = steps.map((s, i) => `${x(i)},${y(s.p90)}`);
  const lower = steps.map((s, i) => `${x(i)},${y(s.p10)}`).reverse();
  const median = steps.map((s, i) => `${x(i)},${y(s.p50)}`).join(" ");
  return `
    <svg class="band-chart" width="${w}" height="${h}" role="img"
         aria-label="Wind forecast band, P10 to P90">
      <polygon points="${[...upper, ...lower].join(" ")}" fill="hsl(212,70%,85%)"/>
      <polyline points="${median}" fill="none" stroke="hsl(212,70%,35%)" stroke-width="2"/>
      <text x="2" y="${y(maxWind) + 4}">${Math.round(maxWind)} m/s</text>
      <text x="2" y="${h - pad + 4}">0</text>
      <text x="${pad}" y="${h - 4}">+${steps[0].hours} h</text>
      <text x="${w - pad - 30}" y="${h - 4}">+${steps.at(-1).hours} h</text>
    </svg>`;
}

function popupHtml(props, steps) {
  const head = `<strong>${props.name}</strong><br>
    ${props.capacity_mw} MW · ${props.turbines} turbines · hub ${props.hub_height_m} m<br>
    ${props.municipality}, ${props.price_area}`;
  if (!steps) return head;
  return `${head}<br>${bandChart(steps)}<br>
    <small>Shaded = 80% of forecasts (P10–P90), line = median</small>`;
}

async function main() {
  const farms = await loadJson("data/farms.geojson");
  let forecast = null;
  try {
    forecast = await loadJson("data/forecast.json");
  } catch {
    // No forecast yet: show the farms on their own.
  }

  const layers = farms.features.map((feature) => {
    const [lon, lat] = feature.geometry.coordinates;
    const props = feature.properties;
    const steps = forecast?.farms[String(props.id)];
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
    dot.bindPopup(popupHtml(props, steps));
    return { props, steps, dot, halo };
  });

  if (!forecast) {
    statusEl.textContent = `${layers.length} wind farms. Run \`wnw forecast\` to add the forecast.`;
    return;
  }

  const hours = Math.max(...layers.map((l) => l.steps?.length ?? 0));
  slider.max = hours - 1;
  document.getElementById("time-control").hidden = false;
  const initUtc = new Date(forecast.init_time).toISOString().slice(0, 16).replace("T", " ");
  statusEl.textContent = `${layers.length} wind farms · forecast run ${initUtc} UTC`;

  function render(index) {
    let expectedMw = 0;
    let capacityMw = 0;
    for (const { props, steps, dot, halo } of layers) {
      const step = steps?.[index];
      const radius = radiusFor(props.capacity_mw);
      if (!step) {
        dot.setStyle({ fillColor: "#9aa3ad" });
        halo.setRadius(0);
        continue;
      }
      dot.setStyle({ fillColor: outputColor(step.output_p50) });
      halo.setStyle({ fillColor: outputColor(step.output_p50) });
      halo.setRadius(radius + (step.p90 - step.p10) * 1.5);
      expectedMw += props.capacity_mw * step.output_p50;
      capacityMw += props.capacity_mw;
    }
    const step = layers.find((l) => l.steps?.[index])?.steps[index];
    if (step) {
      const when = new Date(step.time).toLocaleString([], {
        weekday: "short", hour: "2-digit", minute: "2-digit", timeZone: "UTC",
      }) + " UTC";
      timeLabel.textContent =
        `${when} (+${step.hours} h) · median forecast ≈ ` +
        `${Math.round(expectedMw)} of ${Math.round(capacityMw)} MW`;
    }
  }

  slider.addEventListener("input", () => render(Number(slider.value)));
  render(0);
}

main().catch((error) => {
  statusEl.textContent = `Could not load data: ${error.message}`;
});
