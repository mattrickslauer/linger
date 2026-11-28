// Leaflet + Mapbox Outdoors tiles (VITE_MAPBOX_TOKEN), or OpenStreetMap tiles without a token.
// Falls back to a clean SVG sketch if Leaflet or tiles can't load.
import { useEffect, useRef, useState } from "react";
import type * as Leaflet from "leaflet";
import { TrackSketch } from "../ui";

interface Props {
  track: [number, number][];
  cursor: [number, number] | null;
  frames: [number, number][];
}

const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN as string | undefined;

function addBaseLayer(L: typeof Leaflet, m: Leaflet.Map) {
  if (MAPBOX_TOKEN) {
    L.tileLayer(`https://api.mapbox.com/styles/v1/mapbox/outdoors-v12/tiles/512/{z}/{x}/{y}@2x?access_token=${MAPBOX_TOKEN}`, {
      tileSize: 512,
      zoomOffset: -1,
      maxZoom: 22,
      attribution:
        '&copy; <a href="https://www.mapbox.com/about/maps/">Mapbox</a> &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> <a href="https://www.mapbox.com/map-feedback/" target="_blank">Improve this map</a>',
    }).addTo(m);
    return;
  }
  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  }).addTo(m);
}

export default function TrackMap({ track, cursor, frames }: Props) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<{ L: typeof Leaflet; map: Leaflet.Map; cursor: Leaflet.CircleMarker } | null>(null);
  const [failed, setFailed] = useState(track.length < 2);

  useEffect(() => {
    if (track.length < 2 || !el.current) return;
    let disposed = false;
    let ro: ResizeObserver | null = null;
    Promise.all([import("leaflet"), import("leaflet/dist/leaflet.css")])
      .then(([mod]) => {
        if (disposed || !el.current) return;
        const L = (mod as unknown as { default: typeof Leaflet }).default ?? (mod as unknown as typeof Leaflet);
        const m = L.map(el.current, { zoomControl: true, attributionControl: true, scrollWheelZoom: false });
        addBaseLayer(L, m);
        const line = L.polyline(track, { className: "lf-track", weight: 4, opacity: 0.95, lineJoin: "round" }).addTo(m);
        L.circleMarker(track[0], { className: "lf-start", radius: 5, weight: 2, fillOpacity: 1 }).addTo(m).bindTooltip("Start");
        L.circleMarker(track[track.length - 1], { className: "lf-end", radius: 6, weight: 2, fillOpacity: 1 })
          .addTo(m)
          .bindTooltip("Finish");
        for (const f of frames) L.circleMarker(f, { className: "lf-frame", radius: 4, weight: 2, fillOpacity: 1 }).addTo(m);
        const cur = L.circleMarker(track[0], { className: "lf-cursor", radius: 7, weight: 3, fillOpacity: 1 }).addTo(m);
        m.fitBounds(line.getBounds(), { padding: [24, 24] });
        map.current = { L, map: m, cursor: cur };
        // Shown in a pop-out that can resize (rotation, window): keep the tiles filling the box.
        ro = new ResizeObserver(() => m.invalidateSize());
        ro.observe(el.current);
      })
      .catch((e) => {
        console.warn("map unavailable", e);
        setFailed(true);
      });
    return () => {
      disposed = true;
      ro?.disconnect();
      map.current?.map.remove();
      map.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [track]);

  useEffect(() => {
    if (cursor && map.current) map.current.cursor.setLatLng(cursor);
  }, [cursor]);

  if (failed)
    return (
      <div className="map map-fallback">
        {track.length > 1 ? <TrackSketch track={track} w={320} h={240} /> : <p>No location was recorded for this Moment.</p>}
      </div>
    );
  return <div className="map" ref={el} role="region" aria-label="Map of the recorded track" />;
}
