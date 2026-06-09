import "leaflet/dist/leaflet.css";
import { useEffect } from "react";
import { MapContainer, TileLayer, Marker, Popup, useMap } from "react-leaflet";
import L from "leaflet";
import markerIcon2x from "leaflet/dist/images/marker-icon-2x.png";
import markerIcon from "leaflet/dist/images/marker-icon.png";
import markerShadow from "leaflet/dist/images/marker-shadow.png";
import { Link } from "wouter";

L.Icon.Default.mergeOptions({
  iconRetinaUrl: markerIcon2x,
  iconUrl: markerIcon,
  shadowUrl: markerShadow,
});

export interface MapCenter {
  id: number;
  name: string;
  latitude: number;
  longitude: number;
  detail?: string;
}

const CANARIAS_CENTER: [number, number] = [28.3, -16.5];

function FitBounds({ points }: { points: [number, number][] }) {
  const map = useMap();
  useEffect(() => {
    if (points.length === 0) return;
    if (points.length === 1) {
      map.setView(points[0]!, 13);
    } else {
      map.fitBounds(points, { padding: [40, 40] });
    }
  }, [map, points]);
  return null;
}

interface CenterMapProps {
  centers: MapCenter[];
  height?: number;
  withLinks?: boolean;
  zoom?: number;
}

export function CenterMap({
  centers,
  height = 480,
  withLinks = true,
  zoom = 9,
}: CenterMapProps) {
  const points = centers.map(
    (c) => [c.latitude, c.longitude] as [number, number],
  );

  return (
    <div
      className="overflow-hidden rounded-lg border"
      style={{ height }}
    >
      <MapContainer
        center={points[0] ?? CANARIAS_CENTER}
        zoom={zoom}
        scrollWheelZoom
        style={{ height: "100%", width: "100%" }}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <FitBounds points={points} />
        {centers.map((c) => (
          <Marker key={c.id} position={[c.latitude, c.longitude]}>
            <Popup>
              <div className="space-y-1">
                <div className="font-semibold">{c.name}</div>
                {c.detail && (
                  <div className="text-xs text-muted-foreground">{c.detail}</div>
                )}
                {withLinks && (
                  <Link
                    href={`/centros/${c.id}`}
                    className="text-sm font-medium text-primary underline"
                  >
                    Ver ficha
                  </Link>
                )}
              </div>
            </Popup>
          </Marker>
        ))}
      </MapContainer>
    </div>
  );
}
