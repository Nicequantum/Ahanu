import { useEffect, useRef } from "react";
import { REGION } from "@/lib/ahanu/constants";
import { landPolygon } from "@/lib/ahanu/bathymetry";
import {
  EMPTY_RASTER_URL,
  fieldImage,
  habitatImage,
  overlayBounds,
  type FieldImage,
  type OverlayBounds,
} from "@/lib/ahanu/rasters";
import { getPackedOcean } from "@/lib/ahanu/packed-fields";
import {
  buoyPointsGeo,
  buoysForChart,
  canyonHeadsForLabels,
  canyonsForChart,
  contoursForChart,
  encAidsForChart,
  encCatalogLabelPoints,
  encCoastForChart,
  encDepthAreasForChart,
  encDepthContoursForChart,
  encForChart,
  encHazardAreas,
  encHazardPoints,
  encLandPolygons,
  encShoreForChart,
  encSoundingsForChart,
  hmsForChart,
} from "@/lib/ahanu/packed-chart";
import { applyEncLayerPaint, encLayerPaint } from "@/lib/ahanu/enc-paint";
import { applyHmsLayerPaint, hmsLayerPaint } from "@/lib/ahanu/hms-paint";
import { isColorEdge, isTempBreak, sstC } from "@/lib/ahanu/ocean";
import { COMMUNITY_REPORTS } from "@/lib/data/community";
import { aisGeo, aisTargets } from "@/lib/data/ais";
import { steamRouteGeo, waveFieldGeo, windBarbGeo } from "@/lib/ahanu/wind-field";
import { circleRingGeo, destination, formatCoord } from "@/lib/ahanu/geo";
import { replayAt } from "@/lib/ahanu/replay";
import { useAhanu } from "@/lib/ahanu/store";


function emptyFc(): GeoJSON.FeatureCollection {
  return { type: "FeatureCollection", features: [] };
}

const DEFAULT_SAMPLE = { west: -74.6, east: -67.4, south: 37.4, north: 41.0 };

function samplePoints(
  test: (lat: number, lon: number) => boolean,
  hour: number,
  step = 0.28,
  box = DEFAULT_SAMPLE,
): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = [];
  for (let lat = box.south; lat <= box.north; lat += step) {
    for (let lon = box.west; lon <= box.east; lon += step) {
      if (test(lat, lon)) {
        features.push({
          type: "Feature",
          properties: { sst: sstC(lat, lon, hour) },
          geometry: { type: "Point", coordinates: [lon, lat] },
        });
      }
    }
  }
  return { type: "FeatureCollection", features };
}

function breaksGeo(hour: number, sensitivity: number) {
  const ocean = getPackedOcean();
  if (ocean && !ocean.sst) return emptyFc();
  const box = ocean?.sst?.bbox ?? DEFAULT_SAMPLE;
  return samplePoints((lat, lon) => isTempBreak(lat, lon, hour, sensitivity), hour, 0.28, box);
}

function colorEdgeGeo(hour: number, sensitivity: number) {
  const ocean = getPackedOcean();
  if (ocean && !ocean.chl) return emptyFc();
  const box = ocean?.chl?.bbox ?? DEFAULT_SAMPLE;
  return samplePoints((lat, lon) => isColorEdge(lat, lon, hour, sensitivity), hour, 0.32, box);
}

function rasterOrEmpty(image: FieldImage | null): { url: string; coordinates: OverlayBounds } {
  if (image?.url) return { url: image.url, coordinates: image.bounds };
  return { url: EMPTY_RASTER_URL, coordinates: overlayBounds() };
}

function applyRaster(
  map: import("maplibre-gl").Map,
  id: "sst" | "chl" | "ssh" | "habitat" | "bathy",
  image: FieldImage | null,
) {
  const src = map.getSource(id) as
    | { updateImage?: (a: { url: string; coordinates: OverlayBounds }) => void }
    | undefined;
  src?.updateImage?.(rasterOrEmpty(image));
}

function lineGeo(pts: { lat: number; lon: number }[]): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features:
      pts.length >= 2
        ? [
            {
              type: "Feature",
              properties: {},
              geometry: {
                type: "LineString",
                coordinates: pts.map((p) => [p.lon, p.lat] as [number, number]),
              },
            },
          ]
        : [],
  };
}

function windLines(hour: number): GeoJSON.FeatureCollection {
  const src = windBarbGeo(hour);
  return {
    type: "FeatureCollection",
    features: src.features.flatMap((f) => {
      if (f.geometry.type !== "Point") return [];
      const [lon, lat] = f.geometry.coordinates as [number, number];
      const dir = Number(f.properties?.windDir ?? 0);
      const kt = Number(f.properties?.windKt ?? 0);
      const tip = destination({ lat, lon }, dir, 0.28 + kt * 0.018);
      return [
        {
          type: "Feature" as const,
          properties: f.properties ?? {},
          geometry: {
            type: "LineString" as const,
            coordinates: [
              [lon, lat],
              [tip.lon, tip.lat],
            ],
          },
        },
      ];
    }),
  };
}


function applyEncPaintFromStore(
  map: {
    getLayer: (id: string) => unknown;
    setPaintProperty: (id: string, prop: string, value: number) => void;
  },
) {
  const enc = useAhanu.getState().layers.enc;
  applyEncLayerPaint(map, Boolean(enc?.visible), enc?.opacity);
}

function applyHmsPaintFromStore(
  map: {
    getLayer: (id: string) => unknown;
    setPaintProperty: (id: string, prop: string, value: number) => void;
  },
) {
  const hms = useAhanu.getState().layers.hms_zones;
  applyHmsLayerPaint(map, Boolean(hms?.visible), hms?.opacity);
}

export function ChartMap() {
  const host = useRef<HTMLDivElement>(null);
  const mapRef = useRef<import("maplibre-gl").Map | null>(null);
  const shipRef = useRef<import("maplibre-gl").Marker | null>(null);
  const labelRefs = useRef<import("maplibre-gl").Marker[]>([]);
  const encLabelRefs = useRef<import("maplibre-gl").Marker[]>([]);
  const rippleRef = useRef<import("maplibre-gl").Marker | null>(null);

  const layers = useAhanu((s) => s.layers);
  const hour = useAhanu((s) => s.forecastHour);
  const species = useAhanu((s) => s.species);
  const vessel = useAhanu((s) => s.vessel);
  const track = useAhanu((s) => s.track);
  const waypoints = useAhanu((s) => s.waypoints);
  const measure = useAhanu((s) => s.measure);
  const follow = useAhanu((s) => s.followShip);
  const ripple = useAhanu((s) => s.markRipple);
  const mode = useAhanu((s) => s.displayMode);
  const sens = useAhanu((s) => s.breakSensitivity);
  const boat = useAhanu((s) => s.boat);
  const clock = useAhanu((s) => s.clockMs);
  const aisTick = Math.floor(clock / 20000);
  const replayT = useAhanu((s) => s.replayT);
  const catches = useAhanu((s) => s.catches);
  const packEpoch = useAhanu((s) => s.packEpoch);

  useEffect(() => {
    let dead = false;
    let map: import("maplibre-gl").Map | undefined;
    (async () => {
      const maplibregl = await import("maplibre-gl");
      if (dead || !host.current) return;
      const abyss = mode === "day" ? "#9bb7c6" : "#071016";
      map = new maplibregl.Map({
        container: host.current,
        style: {
          version: 8,
          sources: {},
          layers: [{ id: "bg", type: "background", paint: { "background-color": abyss } }],
        },
        center: [vessel.lon, vessel.lat],
        zoom: 7.4,
        maxZoom: 12.5,
        minZoom: 5.4,
        attributionControl: false,
        fadeDuration: 0,
      });
      mapRef.current = map;

      map.on("load", () => {
        if (!map) return;
        const skipperLayers = useAhanu.getState().layers;
        const encNow = skipperLayers.enc;
        const encPaint = encLayerPaint(Boolean(encNow?.visible), encNow?.opacity);
        const hmsNow = skipperLayers.hms_zones;
        const hmsPaint = hmsLayerPaint(Boolean(hmsNow?.visible), hmsNow?.opacity);
        const land: GeoJSON.FeatureCollection = {
          type: "FeatureCollection",
          features: [landPolygon()],
        };
        map.addSource("land", { type: "geojson", data: land });
        map.addLayer({
          id: "land",
          type: "fill",
          source: "land",
          paint: { "fill-color": mode === "day" ? "#c5d4c0" : "#1a2a22", "fill-opacity": 1 },
        });

        const bathy = fieldImage("depth", 0, 280, 192);
        const bathyImg = rasterOrEmpty(bathy);
        map.addSource("bathy", { type: "image", url: bathyImg.url, coordinates: bathyImg.coordinates });
        map.addLayer({
          id: "bathy",
          type: "raster",
          source: "bathy",
          paint: { "raster-opacity": layers.bathymetry.opacity, "raster-fade-duration": 0 },
        });

        const packClock = new Date(useAhanu.getState().clockMs);
        const initial: Record<"sst" | "chl" | "ssh" | "habitat", FieldImage | null> = {
          sst: fieldImage("sst", hour, 220, 150),
          chl: fieldImage("chl", hour, 220, 150),
          ssh: fieldImage("ssh", hour, 180, 120),
          habitat: habitatImage(species, hour, packClock, 120, 82),
        };
        const rasterOp = {
          sst: skipperLayers.sst.visible ? skipperLayers.sst.opacity : 0,
          chl: skipperLayers.chlorophyll.visible ? skipperLayers.chlorophyll.opacity : 0,
          ssh: skipperLayers.altimetry.visible ? skipperLayers.altimetry.opacity : 0,
          habitat: skipperLayers.habitat.visible ? skipperLayers.habitat.opacity : 0,
        };
        for (const id of ["sst", "chl", "ssh", "habitat"] as const) {
          const img = rasterOrEmpty(initial[id]);
          map.addSource(id, { type: "image", url: img.url, coordinates: img.coordinates });
          map.addLayer({
            id,
            type: "raster",
            source: id,
            paint: { "raster-opacity": rasterOp[id], "raster-fade-duration": 0 },
          });
        }

        const packedContours = contoursForChart();
        map.addSource("c100", { type: "geojson", data: packedContours.c100 });
        map.addSource("c200", { type: "geojson", data: packedContours.c200 });
        map.addLayer({
          id: "c100",
          type: "line",
          source: "c100",
          paint: { "line-color": "#4ecdc4", "line-width": 1.1, "line-opacity": 0.55 },
        });
        map.addLayer({
          id: "c200",
          type: "line",
          source: "c200",
          paint: { "line-color": "#e4b56a", "line-width": 0.8, "line-opacity": 0.4 },
        });

        map.addSource("canyons", { type: "geojson", data: canyonsForChart() });
        map.addLayer({
          id: "canyon-axis",
          type: "line",
          source: "canyons",
          filter: ["==", ["get", "kind"], "axis"],
          paint: { "line-color": "#e4b56a", "line-width": 1.6, "line-opacity": 0.75 },
        });
        map.addLayer({
          id: "canyon-heads",
          type: "circle",
          source: "canyons",
          filter: ["==", ["get", "kind"], "head"],
          paint: {
            "circle-radius": 4,
            "circle-color": "#e4b56a",
            "circle-stroke-width": 1,
            "circle-stroke-color": "#071016",
          },
        });

        map.addSource("hms", { type: "geojson", data: hmsForChart() });
        map.addLayer({
          id: "hms",
          type: "fill",
          source: "hms",
          paint: { "fill-color": "#e06b5a", "fill-opacity": hmsPaint.hms.opacity },
        });
        map.addLayer({
          id: "hms-outline",
          type: "line",
          source: "hms",
          paint: { "line-color": "#e06b5a", "line-width": 1.2, "line-opacity": hmsPaint["hms-outline"].opacity },
        });

        map.addSource("enc-land", { type: "geojson", data: encLandPolygons() });
        map.addLayer({
          id: "enc-land",
          type: "fill",
          source: "enc-land",
          paint: { "fill-color": "#3d4a3a", "fill-opacity": encPaint["enc-land"].opacity },
        });
        map.addSource("enc-depth-areas", { type: "geojson", data: encDepthAreasForChart() });
        map.addLayer({
          id: "enc-depth-areas",
          type: "fill",
          source: "enc-depth-areas",
          paint: {
            "fill-color": [
              "case",
              ["==", ["typeof", ["get", "drval1"]], "number"],
              ["step", ["get", "drval1"], "#8b7355", 0, "#2a5360", 5, "#1d3f4c", 10, "#152f3a"],
              "#1d3f4c",
            ],
            "fill-opacity": encPaint["enc-depth-areas"].opacity,
          },
        });
        map.addSource("enc-coast", { type: "geojson", data: encCoastForChart() });
        map.addLayer({
          id: "enc-coast",
          type: "line",
          source: "enc-coast",
          paint: { "line-color": "#d4c4a8", "line-width": 1.35, "line-opacity": encPaint["enc-coast"].opacity },
        });
        map.addSource("enc-shore", { type: "geojson", data: encShoreForChart() });
        map.addLayer({
          id: "enc-shore",
          type: "line",
          source: "enc-shore",
          paint: { "line-color": "#b8a070", "line-width": 1.15, "line-opacity": encPaint["enc-shore"].opacity },
        });
        map.addSource("enc-depth-contours", { type: "geojson", data: encDepthContoursForChart() });
        map.addLayer({
          id: "enc-depth-contours",
          type: "line",
          source: "enc-depth-contours",
          paint: { "line-color": "#6a8a9a", "line-width": 0.8, "line-opacity": encPaint["enc-depth-contours"].opacity },
        });
        map.addSource("enc-hazard-areas", { type: "geojson", data: encHazardAreas() });
        map.addLayer({
          id: "enc-hazard-areas",
          type: "fill",
          source: "enc-hazard-areas",
          filter: ["==", ["geometry-type"], "Polygon"],
          paint: { "fill-color": "#e06b5a", "fill-opacity": encPaint["enc-hazard-areas"].opacity },
        });
        map.addLayer({
          id: "enc-hazard-lines",
          type: "line",
          source: "enc-hazard-areas",
          paint: { "line-color": "#e4b56a", "line-width": 1.1, "line-opacity": encPaint["enc-hazard-lines"].opacity },
        });
        map.addSource("enc", { type: "geojson", data: encForChart() });
        map.addLayer({
          id: "enc",
          type: "fill",
          source: "enc",
          paint: { "fill-color": "#4ecdc4", "fill-opacity": encPaint.enc.opacity },
        });
        map.addLayer({
          id: "enc-outline",
          type: "line",
          source: "enc",
          paint: {
            "line-color": "#4ecdc4",
            "line-width": 1.1,
            "line-dasharray": [3, 2],
            "line-opacity": encPaint["enc-outline"].opacity,
          },
        });
        map.addSource("enc-aids", { type: "geojson", data: encAidsForChart() });
        map.addLayer({
          id: "enc-aids",
          type: "circle",
          source: "enc-aids",
          paint: {
            "circle-radius": ["case", ["==", ["get", "kind"], "enc-s57-light"], 4.2, 3.4],
            "circle-color": ["case", ["==", ["get", "kind"], "enc-s57-light"], "#f4d35e", "#4ecdc4"],
            "circle-opacity": encPaint["enc-aids"].opacity,
            "circle-stroke-width": 1,
            "circle-stroke-color": "#071016",
          },
        });
        map.addSource("enc-soundings", { type: "geojson", data: encSoundingsForChart() });
        map.addLayer({
          id: "enc-soundings",
          type: "circle",
          source: "enc-soundings",
          paint: {
            "circle-radius": 1.6,
            "circle-color": "#8aa0ab",
            "circle-opacity": encPaint["enc-soundings"].opacity,
          },
        });
        map.addSource("enc-hazards", { type: "geojson", data: encHazardPoints() });
        map.addLayer({
          id: "enc-hazards",
          type: "circle",
          source: "enc-hazards",
          paint: {
            "circle-radius": ["case", ["==", ["get", "kind"], "enc-s57-wreck"], 4.6, 3.6],
            "circle-color": ["case", ["==", ["get", "kind"], "enc-s57-wreck"], "#e06b5a", "#e4b56a"],
            "circle-opacity": encPaint["enc-hazards"].opacity,
            "circle-stroke-width": 1,
            "circle-stroke-color": "#071016",
          },
        });

        map.addSource("buoys", { type: "geojson", data: buoyPointsGeo(buoysForChart()) });
        map.addLayer({
          id: "buoys",
          type: "circle",
          source: "buoys",
          paint: {
            "circle-radius": 4,
            "circle-color": "#8aa0ab",
            "circle-opacity": 0.9,
            "circle-stroke-width": 1,
            "circle-stroke-color": "#071016",
          },
        });

        map.addSource("breaks", { type: "geojson", data: breaksGeo(hour, sens) });
        map.addLayer({
          id: "breaks",
          type: "circle",
          source: "breaks",
          paint: {
            "circle-radius": 2.2,
            "circle-color": "#e4b56a",
            "circle-opacity": 0.85,
            "circle-stroke-width": 0,
          },
        });

        map.addSource("chl-edges", { type: "geojson", data: colorEdgeGeo(hour, sens) });
        map.addLayer({
          id: "chl-edges",
          type: "circle",
          source: "chl-edges",
          paint: {
            "circle-radius": 2,
            "circle-color": "#4ecdc4",
            "circle-opacity": skipperLayers.chl_edges.visible ? 0.8 : 0,
          },
        });

        map.addSource("waves", { type: "geojson", data: waveFieldGeo(hour) });
        map.addLayer({
          id: "waves",
          type: "circle",
          source: "waves",
          paint: {
            "circle-radius": ["interpolate", ["linear"], ["get", "waveFt"], 2, 3, 12, 10],
            "circle-color": [
              "match",
              ["get", "go"],
              "go",
              "#6bcb8b",
              "caution",
              "#e0b15a",
              "#e06b5a",
            ],
            "circle-opacity": skipperLayers.waves.visible ? skipperLayers.waves.opacity : 0,
          },
        });

        map.addSource("wind", { type: "geojson", data: windLines(hour) });
        map.addLayer({
          id: "wind",
          type: "line",
          source: "wind",
          paint: {
            "line-color": "#e6eef2",
            "line-width": 1.2,
            "line-opacity": skipperLayers.wind.visible ? skipperLayers.wind.opacity : 0,
          },
        });

        map.addSource("route", { type: "geojson", data: steamRouteGeo() });
        map.addLayer({
          id: "route",
          type: "line",
          source: "route",
          paint: {
            "line-color": "#e4b56a",
            "line-width": 1.4,
            "line-dasharray": [2, 2],
            "line-opacity": 0.85,
          },
        });

        map.addSource("track", { type: "geojson", data: lineGeo(track) });
        map.addLayer({
          id: "track",
          type: "line",
          source: "track",
          paint: { "line-color": "#4ecdc4", "line-width": 2, "line-opacity": 0.8 },
        });
        map.addSource("measure", { type: "geojson", data: lineGeo(measure.points) });
        map.addLayer({
          id: "measure",
          type: "line",
          source: "measure",
          paint: {
            "line-color": "#e6eef2",
            "line-width": 1.4,
            "line-dasharray": [2, 2],
          },
        });

        map.addSource("range", { type: "geojson", data: emptyFc() });
        map.addLayer({
          id: "range",
          type: "line",
          source: "range",
          paint: { "line-color": "#4ecdc4", "line-width": 1, "line-opacity": 0.35, "line-dasharray": [4, 3] },
        });
        map.addSource("anchor", { type: "geojson", data: emptyFc() });
        map.addLayer({
          id: "anchor",
          type: "line",
          source: "anchor",
          paint: { "line-color": "#e06b5a", "line-width": 1.4, "line-opacity": 0 },
        });

        map.addSource("spots", {
          type: "geojson",
          data: {
            type: "FeatureCollection",
            features: waypoints.map((w) => ({
              type: "Feature" as const,
              properties: { name: w.name, color: w.color ?? "#e4b56a" },
              geometry: { type: "Point" as const, coordinates: [w.lon, w.lat] },
            })),
          },
        });
        map.addLayer({
          id: "spots",
          type: "circle",
          source: "spots",
          paint: {
            "circle-radius": 3.5,
            "circle-color": ["get", "color"],
            "circle-stroke-width": 1,
            "circle-stroke-color": "#071016",
          },
        });

        map.addSource("community", {
          type: "geojson",
          data: {
            type: "FeatureCollection",
            features: COMMUNITY_REPORTS.map((r) => ({
              type: "Feature" as const,
              properties: { who: r.who, note: r.note },
              geometry: { type: "Point" as const, coordinates: [r.lon, r.lat] },
            })),
          },
        });
        map.addLayer({
          id: "community",
          type: "circle",
          source: "community",
          paint: {
            "circle-radius": 3,
            "circle-color": "#4ecdc4",
            "circle-opacity": 0.55,
          },
        });

        map.addSource("ais", { type: "geojson", data: aisGeo(aisTargets(clock, hour)) });
        map.addLayer({
          id: "ais",
          type: "circle",
          source: "ais",
          paint: {
            "circle-radius": ["match", ["get", "type"], "tanker", 5, "cargo", 4.5, "tug", 3.5, 3.2],
            "circle-color": [
              "match",
              ["get", "type"],
              "fishing",
              "#e4b56a",
              "tanker",
              "#e06b5a",
              "cargo",
              "#e06b5a",
              "tug",
              "#8aa0ab",
              "#4ecdc4",
            ],
            "circle-opacity": skipperLayers.ais.visible ? skipperLayers.ais.opacity : 0,
            "circle-stroke-width": 1,
            "circle-stroke-color": "#071016",
          },
        });

        map.addSource("catches", { type: "geojson", data: emptyFc() });
        map.addLayer({
          id: "catches",
          type: "circle",
          source: "catches",
          paint: {
            "circle-radius": 5,
            "circle-color": "#e4b56a",
            "circle-stroke-width": 2,
            "circle-stroke-color": "#e6eef2",
          },
        });

        const shipEl = document.createElement("div");
        shipEl.className = "ownship-mark";
        shipEl.style.cssText =
          "width:18px;height:18px;display:grid;place-items:center;transform-origin:50% 50%;";
        shipEl.innerHTML = `<svg width="18" height="18" viewBox="0 0 18 18"><polygon points="9,1 16,16 9,12 2,16" fill="#E4B56A" stroke="#071016" stroke-width="1"/></svg>`;
        shipRef.current = new maplibregl.Marker({ element: shipEl, rotationAlignment: "map" })
          .setLngLat([vessel.lon, vessel.lat])
          .addTo(map);

        labelRefs.current.forEach((m) => m.remove());
        labelRefs.current = canyonHeadsForLabels().map((c) => {
          const el = document.createElement("div");
          el.style.cssText =
            "font:500 10px Outfit,sans-serif;letter-spacing:.12em;text-transform:uppercase;color:#e4b56a;text-shadow:0 1px 6px #071016,0 0 8px #071016;white-space:nowrap;pointer-events:none;";
          el.textContent = c.name.replace(" Canyon", "");
          return new maplibregl.Marker({ element: el, anchor: "left", offset: [12, -8] })
            .setLngLat([c.lon, c.lat])
            .addTo(map!);
        });
        encLabelRefs.current.forEach((m) => m.remove());
        encLabelRefs.current = encCatalogLabelPoints().map((c) => {
          const el = document.createElement("div");
          el.style.cssText =
            "font:600 10px Outfit,sans-serif;letter-spacing:.04em;color:#4ecdc4;text-shadow:0 1px 6px #071016,0 0 8px #071016;white-space:nowrap;pointer-events:none;";
          el.style.display = encNow?.visible ? "" : "none";
          el.textContent = c.id;
          return new maplibregl.Marker({ element: el, anchor: "center" })
            .setLngLat([c.lon, c.lat])
            .addTo(map!);
        });
        applyHmsPaintFromStore(map);
        applyEncPaintFromStore(map);
      });

      map.on("click", (e) => {
        const st = useAhanu.getState();
        if (st.measure.active) {
          st.addMeasurePoint({ lat: e.lngLat.lat, lon: e.lngLat.lng });
        }
      });
      map.on("contextmenu", (e) => {
        e.preventDefault();
        const st = useAhanu.getState();
        st.addWaypoint({
          name: `MARK ${formatCoord({ lat: e.lngLat.lat, lon: e.lngLat.lng }).slice(0, 18)}`,
          lat: e.lngLat.lat,
          lon: e.lngLat.lng,
          tags: ["mark"],
          color: "#E4B56A",
        });
      });
    })();

    return () => {
      dead = true;
      labelRefs.current.forEach((m) => m.remove());
      labelRefs.current = [];
      encLabelRefs.current.forEach((m) => m.remove());
      encLabelRefs.current = [];
      shipRef.current?.remove();
      rippleRef.current?.remove();
      mapRef.current?.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- map mounts once; overlays update below
  }, [mode]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map?.getSource("bathy")) return;
    const vis = (id: string, on: boolean, op: number) => {
      if (!map.getLayer(id)) return;
      map.setLayoutProperty(id, "visibility", on ? "visible" : "none");
      if (id === "sst" || id === "chl" || id === "ssh" || id === "habitat" || id === "bathy") {
        map.setPaintProperty(id, "raster-opacity", on ? op : 0);
      }
    };
    vis("bathy", layers.bathymetry.visible, layers.bathymetry.opacity);
    vis("sst", layers.sst.visible, layers.sst.opacity);
    vis("chl", layers.chlorophyll.visible, layers.chlorophyll.opacity);
    vis("ssh", layers.altimetry.visible, layers.altimetry.opacity);
    vis("habitat", layers.habitat.visible, layers.habitat.opacity);
    vis("c100", layers.contours.visible, layers.contours.opacity);
    vis("c200", layers.contours.visible, layers.contours.opacity);
    vis("canyon-axis", layers.canyons.visible, 0.75);
    vis("canyon-heads", layers.canyons.visible, 1);
    vis("breaks", layers.temp_breaks.visible, 0.85);
    vis("chl-edges", layers.chl_edges.visible, 0.8);
    vis("hms", layers.hms_zones.visible, layers.hms_zones.opacity);
    vis("hms-outline", layers.hms_zones.visible, layers.hms_zones.opacity);
    vis("enc-land", layers.enc?.visible ?? false, layers.enc?.opacity ?? 0);
    vis("enc-depth-areas", layers.enc?.visible ?? false, layers.enc?.opacity ?? 0);
    vis("enc-coast", layers.enc?.visible ?? false, layers.enc?.opacity ?? 0);
    vis("enc-shore", layers.enc?.visible ?? false, layers.enc?.opacity ?? 0);
    vis("enc-depth-contours", layers.enc?.visible ?? false, layers.enc?.opacity ?? 0);
    vis("enc-hazard-areas", layers.enc?.visible ?? false, layers.enc?.opacity ?? 0);
    vis("enc-hazard-lines", layers.enc?.visible ?? false, layers.enc?.opacity ?? 0);
    vis("enc", layers.enc?.visible ?? false, layers.enc?.opacity ?? 0);
    vis("enc-outline", layers.enc?.visible ?? false, layers.enc?.opacity ?? 0);
    vis("enc-aids", layers.enc?.visible ?? false, layers.enc?.opacity ?? 0);
    vis("enc-soundings", layers.enc?.visible ?? false, layers.enc?.opacity ?? 0);
    vis("enc-hazards", layers.enc?.visible ?? false, layers.enc?.opacity ?? 0);
    vis("buoys", layers.buoys.visible, 0.9);
    vis("track", layers.tracks.visible, 0.8);
    vis("spots", layers.spots.visible, 1);
    vis("route", layers.routes.visible, 0.85);
    vis("wind", layers.wind.visible, 0.8);
    vis("waves", layers.waves.visible, 0.45);
    vis("ais", layers.ais.visible, 0.9);
    vis("community", layers.spots.visible, 0.55);
    applyHmsPaintFromStore(map);
    applyEncPaintFromStore(map);
    for (const m of encLabelRefs.current) {
      const el = m.getElement();
      if (el) el.style.display = layers.enc?.visible ? "" : "none";
    }
    if (map.getLayer("wind")) {
      map.setPaintProperty("wind", "line-opacity", layers.wind.visible ? layers.wind.opacity : 0);
    }
    if (map.getLayer("waves")) {
      map.setPaintProperty("waves", "circle-opacity", layers.waves.visible ? layers.waves.opacity : 0);
    }
    if (map.getLayer("ais")) {
      map.setPaintProperty("ais", "circle-opacity", layers.ais.visible ? layers.ais.opacity : 0);
    }
    if (map.getLayer("chl-edges")) {
      map.setPaintProperty("chl-edges", "circle-opacity", layers.chl_edges.visible ? 0.8 : 0);
    }
  }, [layers, packEpoch]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    applyRaster(map, "sst", fieldImage("sst", hour, 220, 150));
    applyRaster(map, "chl", fieldImage("chl", hour, 220, 150));
    applyRaster(map, "ssh", fieldImage("ssh", hour, 180, 120));
    applyRaster(map, "bathy", fieldImage("depth", 0, 280, 192));
    applyRaster(map, "habitat", habitatImage(species, hour, new Date(useAhanu.getState().clockMs), 120, 82));
    const set = (id: string, data: GeoJSON.GeoJSON) => {
      const src = map.getSource(id) as { setData?: (d: GeoJSON.GeoJSON) => void } | undefined;
      src?.setData?.(data);
    };
    set("breaks", breaksGeo(hour, sens));
    set("chl-edges", colorEdgeGeo(hour, sens));
    set("wind", windLines(hour));
    set("waves", waveFieldGeo(hour));
    const packedContours = contoursForChart();
    set("c100", packedContours.c100);
    set("c200", packedContours.c200);
    set("canyons", canyonsForChart());
    set("hms", hmsForChart());
    set("enc-land", encLandPolygons());
    set("enc-depth-areas", encDepthAreasForChart());
    set("enc-coast", encCoastForChart());
    set("enc-shore", encShoreForChart());
    set("enc-depth-contours", encDepthContoursForChart());
    set("enc-hazard-areas", encHazardAreas());
    set("enc", encForChart());
    set("enc-aids", encAidsForChart());
    set("enc-soundings", encSoundingsForChart());
    set("enc-hazards", encHazardPoints());
    applyHmsPaintFromStore(map);
    applyEncPaintFromStore(map);
    set("buoys", buoyPointsGeo(buoysForChart()));
    void import("maplibre-gl").then((maplibregl) => {
      if (mapRef.current !== map) return;
      labelRefs.current.forEach((m) => m.remove());
      labelRefs.current = canyonHeadsForLabels().map((c) => {
        const el = document.createElement("div");
        el.style.cssText =
          "font:500 10px Outfit,sans-serif;letter-spacing:.12em;text-transform:uppercase;color:#e4b56a;text-shadow:0 1px 6px #071016,0 0 8px #071016;white-space:nowrap;pointer-events:none;";
        el.textContent = c.name.replace(" Canyon", "");
        return new maplibregl.Marker({ element: el, anchor: "left", offset: [12, -8] })
          .setLngLat([c.lon, c.lat])
          .addTo(map);
      });
      encLabelRefs.current.forEach((m) => m.remove());
      const encOn = Boolean(useAhanu.getState().layers.enc?.visible);
      encLabelRefs.current = encCatalogLabelPoints().map((c) => {
        const el = document.createElement("div");
        el.style.cssText =
          "font:600 10px Outfit,sans-serif;letter-spacing:.04em;color:#4ecdc4;text-shadow:0 1px 6px #071016,0 0 8px #071016;white-space:nowrap;pointer-events:none;";
        el.style.display = encOn ? "" : "none";
        el.textContent = c.id;
        return new maplibregl.Marker({ element: el, anchor: "center" })
          .setLngLat([c.lon, c.lat])
          .addTo(map);
      });
    });
  }, [hour, species, sens, packEpoch]);

  useEffect(() => {
    const map = mapRef.current;
    const src = map?.getSource("ais") as { setData?: (d: GeoJSON.GeoJSON) => void } | undefined;
    src?.setData?.(aisGeo(aisTargets(clock, hour)));
  }, [aisTick, hour]);

  useEffect(() => {
    const map = mapRef.current;
    const src = map?.getSource("track") as { setData?: (d: GeoJSON.GeoJSON) => void } | undefined;
    src?.setData?.(lineGeo(track));
  }, [track]);

  useEffect(() => {
    const map = mapRef.current;
    const src = map?.getSource("measure") as { setData?: (d: GeoJSON.GeoJSON) => void } | undefined;
    src?.setData?.(lineGeo(measure.points));
  }, [measure]);

  useEffect(() => {
    const map = mapRef.current;
    const src = map?.getSource("spots") as { setData?: (d: GeoJSON.GeoJSON) => void } | undefined;
    src?.setData?.({
      type: "FeatureCollection",
      features: waypoints.map((w) => ({
        type: "Feature",
        properties: { name: w.name, color: w.color ?? "#e4b56a" },
        geometry: { type: "Point", coordinates: [w.lon, w.lat] },
      })),
    });
  }, [waypoints]);

  useEffect(() => {
    const map = mapRef.current;
    const src = map?.getSource("catches") as { setData?: (d: GeoJSON.GeoJSON) => void } | undefined;
    src?.setData?.({
      type: "FeatureCollection",
      features: catches.map((c) => ({
        type: "Feature" as const,
        properties: { species: c.species },
        geometry: { type: "Point" as const, coordinates: [c.lon, c.lat] },
      })),
    });
  }, [catches]);

  useEffect(() => {
    const map = mapRef.current;
    shipRef.current?.setLngLat([vessel.lon, vessel.lat]);
    const el = shipRef.current?.getElement();
    if (el) el.style.transform = `rotate(${vessel.heading}deg)`;
    if (follow && map && replayT == null) {
      map.easeTo({ center: [vessel.lon, vessel.lat], duration: 400, essential: true });
    }
    const range = map?.getSource("range") as { setData?: (d: GeoJSON.GeoJSON) => void } | undefined;
    const nm = Math.max(4, (vessel.sog || boat.trollKt) * 2);
    range?.setData?.(circleRingGeo(vessel, nm, 64));
    const anc = map?.getSource("anchor") as { setData?: (d: GeoJSON.GeoJSON) => void } | undefined;
    if (vessel.anchor) {
      anc?.setData?.(circleRingGeo(vessel.anchor, vessel.anchorRadiusM / 1852, 48));
      if (map?.getLayer("anchor")) map.setPaintProperty("anchor", "line-opacity", 0.9);
    } else if (map?.getLayer("anchor")) {
      map.setPaintProperty("anchor", "line-opacity", 0);
    }
  }, [vessel, follow, boat, replayT]);

  useEffect(() => {
    const map = mapRef.current;
    if (replayT == null || !map) return;
    const frame = replayAt(track, catches, replayT);
    map.easeTo({ center: [frame.pos.lon, frame.pos.lat], duration: 200, essential: true });
    shipRef.current?.setLngLat([frame.pos.lon, frame.pos.lat]);
  }, [replayT, track, catches]);

  useEffect(() => {
    if (!ripple || !mapRef.current) return;
    let cancelled = false;
    (async () => {
      const maplibregl = await import("maplibre-gl");
      if (cancelled || !mapRef.current) return;
      rippleRef.current?.remove();
      const el = document.createElement("div");
      el.className = "ripple";
      el.style.cssText =
        "width:48px;height:48px;border-radius:999px;border:2px solid #e4b56a;pointer-events:none;";
      rippleRef.current = new maplibregl.Marker({ element: el })
        .setLngLat([ripple.lon, ripple.lat])
        .addTo(mapRef.current);
      window.setTimeout(() => {
        rippleRef.current?.remove();
        useAhanu.getState().setRipple(null);
      }, 900);
    })();
    return () => {
      cancelled = true;
    };
  }, [ripple]);

  return (
    <div ref={host} className="absolute inset-0 h-full w-full bg-abyss" data-map="ahanu" />
  );
}

export const MAP_REGION = REGION;
