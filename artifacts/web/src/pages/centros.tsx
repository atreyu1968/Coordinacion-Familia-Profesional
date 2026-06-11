import { useMemo, useState } from "react";
import { Link } from "wouter";
import {
  useListCenters,
  useListCenterFacets,
  useListProvinces,
  useListIslands,
  useListMunicipalities,
  type ListCentersParams,
} from "@workspace/api-client-react";
import { useAuth } from "@/lib/auth";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { CenterMap, type MapCenter } from "@/components/center-map";
import { CenterFormDialog } from "@/components/center-form-dialog";
import {
  Building2,
  MapPin,
  Plus,
  Search,
  ChevronRight,
  Map as MapIcon,
  List,
} from "lucide-react";

const ALL = "all";

export default function CentrosPage() {
  const { user } = useAuth();
  const canManage =
    user?.role === "superadmin" || user?.role === "coordinator";

  const [search, setSearch] = useState("");
  const [provinceId, setProvinceId] = useState<number | null>(null);
  const [islandId, setIslandId] = useState<number | null>(null);
  const [municipalityId, setMunicipalityId] = useState<number | null>(null);
  const [family, setFamily] = useState<string | null>(null);
  const [nature, setNature] = useState<string | null>(null);
  const [centerType, setCenterType] = useState<string | null>(null);

  const { data: provinces = [] } = useListProvinces();
  const { data: islands = [] } = useListIslands();
  const { data: municipalities = [] } = useListMunicipalities();
  const { data: facets } = useListCenterFacets();
  const familyOptions = facets?.families ?? [];
  const natureOptions = facets?.natures ?? [];
  const centerTypeOptions = facets?.centerTypes ?? [];

  const islandOptions = islands.filter(
    (i) => provinceId == null || i.provinceId === provinceId,
  );
  const municipalityOptions = municipalities.filter(
    (m) => islandId == null || m.islandId === islandId,
  );

  const islandName = useMemo(
    () => new Map(islands.map((i) => [i.id, i.name])),
    [islands],
  );
  const municipalityName = useMemo(
    () => new Map(municipalities.map((m) => [m.id, m.name])),
    [municipalities],
  );

  const params: ListCentersParams = {};
  if (provinceId != null) params.provinceId = provinceId;
  if (islandId != null) params.islandId = islandId;
  if (municipalityId != null) params.municipalityId = municipalityId;
  if (search.trim()) params.search = search.trim();
  if (family) params.family = family;
  if (nature) params.nature = nature;
  if (centerType) params.centerType = centerType;

  const { data: centers = [], isLoading } = useListCenters(params);

  const mapCenters: MapCenter[] = centers
    .filter((c) => c.latitude != null && c.longitude != null)
    .map((c) => ({
      id: c.id,
      name: c.name,
      latitude: c.latitude as number,
      longitude: c.longitude as number,
      detail:
        [
          c.municipalityId ? municipalityName.get(c.municipalityId) : null,
          c.islandId ? islandName.get(c.islandId) : null,
        ]
          .filter(Boolean)
          .join(" · ") || undefined,
    }));

  const geoLabel = (c: (typeof centers)[number]) =>
    [
      c.municipalityId ? municipalityName.get(c.municipalityId) : null,
      c.islandId ? islandName.get(c.islandId) : null,
    ]
      .filter(Boolean)
      .join(" · ") || "Sin ubicación";

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Centros</h1>
          <p className="text-muted-foreground">
            Directorio de centros de Formación Profesional en Canarias.
          </p>
        </div>
        {canManage && (
          <CenterFormDialog
            trigger={
              <Button className="gap-2">
                <Plus className="h-4 w-4" />
                Nuevo centro
              </Button>
            }
          />
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Buscar por nombre..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>

        <Select
          value={provinceId ? String(provinceId) : ALL}
          onValueChange={(v) => {
            setProvinceId(v === ALL ? null : Number(v));
            setIslandId(null);
            setMunicipalityId(null);
          }}
        >
          <SelectTrigger>
            <SelectValue placeholder="Provincia" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Todas las provincias</SelectItem>
            {provinces.map((p) => (
              <SelectItem key={p.id} value={String(p.id)}>
                {p.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={islandId ? String(islandId) : ALL}
          onValueChange={(v) => {
            setIslandId(v === ALL ? null : Number(v));
            setMunicipalityId(null);
          }}
        >
          <SelectTrigger>
            <SelectValue placeholder="Isla" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Todas las islas</SelectItem>
            {islandOptions.map((i) => (
              <SelectItem key={i.id} value={String(i.id)}>
                {i.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={municipalityId ? String(municipalityId) : ALL}
          onValueChange={(v) =>
            setMunicipalityId(v === ALL ? null : Number(v))
          }
        >
          <SelectTrigger>
            <SelectValue placeholder="Municipio" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Todos los municipios</SelectItem>
            {municipalityOptions.map((m) => (
              <SelectItem key={m.id} value={String(m.id)}>
                {m.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={family ?? ALL}
          onValueChange={(v) => setFamily(v === ALL ? null : v)}
        >
          <SelectTrigger>
            <SelectValue placeholder="Familia profesional" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Todas las familias</SelectItem>
            {familyOptions.map((f) => (
              <SelectItem key={f} value={f}>
                {f}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={nature ?? ALL}
          onValueChange={(v) => setNature(v === ALL ? null : v)}
        >
          <SelectTrigger>
            <SelectValue placeholder="Naturaleza" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Todas las naturalezas</SelectItem>
            {natureOptions.map((n) => (
              <SelectItem key={n} value={n}>
                {n}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={centerType ?? ALL}
          onValueChange={(v) => setCenterType(v === ALL ? null : v)}
        >
          <SelectTrigger>
            <SelectValue placeholder="Tipo de centro" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Todos los tipos</SelectItem>
            {centerTypeOptions.map((t) => (
              <SelectItem key={t} value={t}>
                {t}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <Tabs defaultValue="list" className="space-y-4">
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            {isLoading
              ? "Cargando centros..."
              : `${centers.length} ${centers.length === 1 ? "centro" : "centros"}`}
          </p>
          <TabsList>
            <TabsTrigger value="list" className="gap-1.5">
              <List className="h-4 w-4" />
              Lista
            </TabsTrigger>
            <TabsTrigger value="map" className="gap-1.5">
              <MapIcon className="h-4 w-4" />
              Mapa
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="list" className="space-y-3">
          {!isLoading && centers.length === 0 && (
            <Card>
              <CardContent className="py-10 text-center text-sm text-muted-foreground">
                No se encontraron centros con los filtros aplicados.
              </CardContent>
            </Card>
          )}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {centers.map((c) => (
              <Link key={c.id} href={`/centros/${c.id}`}>
                <Card className="cursor-pointer transition-colors hover:border-primary">
                  <CardContent className="flex items-start gap-3 p-4">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                      <Building2 className="h-5 w-5" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <h3 className="truncate font-semibold">{c.name}</h3>
                        <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                      </div>
                      <div className="mt-1 flex items-center gap-1 text-sm text-muted-foreground">
                        <MapPin className="h-3.5 w-3.5 shrink-0" />
                        <span className="truncate">{geoLabel(c)}</span>
                      </div>
                      {c.code && (
                        <p className="mt-1 text-xs text-muted-foreground">
                          Código {c.code}
                        </p>
                      )}
                    </div>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="map">
          {mapCenters.length === 0 ? (
            <Card>
              <CardContent className="py-10 text-center text-sm text-muted-foreground">
                Ningún centro con coordenadas para mostrar en el mapa.
              </CardContent>
            </Card>
          ) : (
            <CenterMap centers={mapCenters} height={520} />
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
