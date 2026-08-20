import { useEffect, useRef } from "react";
import { REGION } from "@/lib/ahanu/constants";
import { contourLines, landPolygon } from "@/lib/ahanu/bathymetry";
import { fieldUrl, habitatUrl, overlayBounds } from "@/lib/ahanu/rasters";
import { isTempBreak, sstC } from "@/lib/ahanu/ocean";
import { CANYONS } from "@/lib/data/canyons";
import { BUOYS } from "@/lib/data/buoys";
import { CLOSED_AREAS } from "@/lib/data/regs";
import { COMMUNITY_REPORTS } from "@/lib/data/community";
import { useAhanu } from "@/lib/ahanu/store";
import { formatCoord } from "@/lib/ahanu/geo";

const BOUNDS: [[number, number], [number, number], [number, number], [number, number]] =
  overlayBounds();

function canyonGeo(): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: CANYONS.flatMap((c) => [
      {
        type: "Feature" as const,
        properties: { name: c.name, kind: "axis" },
        geometry: {
          type: "LineString" as const,
          coordinates: c.axis.map((p) => [p.lon, p.lat] as [number, number]),
        },
      },
      {
        type: "Feature" as const,
        properties: { name: c.name, kind: "head" },
        geometry: { type: "Point" as const, coordinates: [c.head.lon, c.head.lat] },
      },
    ]),
  };
}

function closedGeo(): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: CLOSED_AREAS.map((a) => ({
      type: "Feature" as const,
      properties: { name: a.name },
      geometry: {
        type: "Polygon" as const,
        coordinates: [a.ring.map((p) => [p.lon, p.lat] as [number, number])],
      },
    })),
  };
}

function breaksGeo(hour: number, sensitivity: number): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = [];
  for (let lat = 37.4; lat <= 41.0; lat += 0.28) {
    for (let lon = -74.6; lon <= -67.4; lon += 0.28) {
      if (isTempBreak(lat, lon, hour, sensitivity)) {
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

export function ChartMap() {
  const host = useRef<HTMLDivElement>(null);
  const mapRef = useRef<import("maplibre-gl").Map | null>(null);
  const shipRef = useRef<import("maplibre-gl").Marker | null>(null);
  const labelRefs = useRef<import("maplibre-gl").Marker[]>([]);
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

        const bathy = fieldUrl("depth", 0, 280, 192);
        if (bathy) {
          map.addSource("bathy", { type: "image", url: bathy, coordinates: BOUNDS });
          map.addLayer({
            id: "bathy",
            type: "raster",
            source: "bathy",
            paint: { "raster-opacity": layers.bathymetry.opacity, "raster-fade-duration": 0 },
          });
        }

        for (const id of ["sst", "chl", "ssh", "habitat"] as const) {
          const url =
            id === "habitat"
              ? habitatUrl(species, hour, new Date(useAhanu.getState().clockMs), 120, 82)
              : fieldUrl(id === "chl" ? "chl" : id, hour, 220, 150);
          if (url) {
            map.addSource(id, { type: "image", url, coordinates: BOUNDS });
            map.addLayer({
              id,
              type: "raster",
              source: id,
              paint: { "raster-opacity": 0, "raster-fade-duration": 0 },
            });
          }
        }

        const contours = contourLines(183, 2);
        const c200 = contourLines(366, 3);
        map.addSource("c100", { type: "geojson", data: contours });
        map.addSource("c200", { type: "geojson", data: c200 });
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

        map.addSource("canyons", { type: "geojson", data: canyonGeo() });
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

        map.addSource("hms", { type: "geojson", data: closedGeo() });
        map.addLayer({
          id: "hms",
          type: "fill",
          source: "hms",
          paint: { "fill-color": "#e06b5a", "fill-opacity": 0 },
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

        const shipEl = document.createElement("div");
        shipEl.className = "ownship-mark";
        shipEl.style.cssText =
          "width:18px;height:18px;display:grid;place-items:center;transform-origin:50% 50%;";
        shipEl.innerHTML = `<svg width="18" height="18" viewBox="0 0 18 18"><polygon points="9,1 16,16 9,12 2,16" fill="#E4B56A" stroke="#071016" stroke-width="1"/></svg>`;
        shipRef.current = new maplibregl.Marker({ element: shipEl, rotationAlignment: "map" })
          .setLngLat([vessel.lon, vessel.lat])
          .addTo(map);
        shipEl.style.transform += "";

        const MAJOR = new Set([
          "hudson",
          "block",
          "atlantis",
          "veatch",
          "hydro",
          "hydrographer",
          "wilmington",
          "baltimore",
          "norfolk",
        ]);
        labelRefs.current.forEach((m) => m.remove());
        labelRefs.current = CANYONS.filter((c) => MAJOR.has(c.id) || MAJOR.has(c.name.toLowerCase().split(" ")[0]!)).map(
          (c) => {
          const el = document.createElement("div");
          el.style.cssText =
            "font:500 10px Outfit,sans-serif;letter-spacing:.12em;text-transform:uppercase;color:#e4b56a;text-shadow:0 1px 6px #071016,0 0 8px #071016;white-space:nowrap;pointer-events:none;";
          el.textContent = c.name.replace(" Canyon", "");
          return new maplibregl.Marker({ element: el, anchor: "left", offset: [12, -8] })
            .setLngLat([c.head.lon, c.head.lat])
            .addTo(map!);
        });
        BUOYS.forEach((b) => {
          const el = document.createElement("div");
          el.title = `${b.id} ${b.name}`;
          el.style.cssText =
            "width:7px;height:7px;border-radius:1px;background:#8aa0ab;box-shadow:0 0 0 1px #071016;transform:rotate(45deg);";
          labelRefs.current.push(
            new maplibregl.Marker({ element: el }).setLngLat([b.lon, b.lat]).addTo(map!),
          );
        });
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
    vis("hms", layers.hms_zones.visible, layers.hms_zones.opacity);
    vis("track", layers.tracks.visible, 0.8);
    vis("spots", layers.spots.visible, 1);
    if (map.getLayer("hms")) {
      map.setPaintProperty("hms", "fill-opacity", layers.hms_zones.visible ? layers.hms_zones.opacity : 0);
    }
  }, [layers]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const upd = (id: "sst" | "chl" | "ssh" | "habitat", url: string | null) => {
      const src = map.getSource(id) as { updateImage?: (a: { url: string; coordinates: typeof BOUNDS }) => void } | undefined;
      if (src?.updateImage && url) src.updateImage({ url, coordinates: BOUNDS });
    };
    upd("sst", fieldUrl("sst", hour, 220, 150));
    upd("chl", fieldUrl("chl", hour, 220, 150));
    upd("ssh", fieldUrl("ssh", hour, 180, 120));
    upd("habitat", habitatUrl(species, hour, new Date(useAhanu.getState().clockMs), 120, 82));
    const br = map.getSource("breaks") as { setData?: (d: GeoJSON.GeoJSON) => void } | undefined;
    br?.setData?.(breaksGeo(hour, sens));
  }, [hour, species, sens]);

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
    shipRef.current?.setLngLat([vessel.lon, vessel.lat]);
    const el = shipRef.current?.getElement();
    if (el) el.style.transform = `rotate(${vessel.heading}deg)`;
    if (follow && map) {
      map.easeTo({ center: [vessel.lon, vessel.lat], duration: 400, essential: true });
    }
    if (vessel.anchor && map && map.getSource("anchor") == null) {
      /* noop — circle handled visually via marker */
    }
  }, [vessel, follow]);

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
