import { useMemo } from "react";
import {
  useListProvinces,
  useListIslands,
  useListCenters,
  useListModules,
  useListUsers,
  type AudienceType,
} from "@workspace/api-client-react";
import { useAuth } from "@/lib/auth";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";

export type AudienceValue = {
  audienceType: AudienceType;
  audienceIds: number[];
};

const TYPE_LABELS: Record<AudienceType, string> = {
  all: "Todos",
  province: "Provincia",
  island: "Isla",
  center: "Centro",
  module: "Módulo",
  users: "Profesores concretos",
};

// Determine whether the current user may create forms/surveys, and which
// modules they coordinate. Mirrors the backend rule: superadmin, provincial
// coordinator, or any user who coordinates at least one module.
export function useFormSurveyCreator() {
  const { user } = useAuth();
  const role = user?.role;
  const isSuperadmin = role === "superadmin";
  const isProvincialCoordinator = role === "coordinator";
  const { data: modules = [] } = useListModules({});
  const coordinatedModules = useMemo(
    () => modules.filter((m) => m.myRole === "coordinator"),
    [modules],
  );
  const canCreate =
    isSuperadmin || isProvincialCoordinator || coordinatedModules.length > 0;
  return {
    user,
    isSuperadmin,
    isProvincialCoordinator,
    coordinatedModules,
    canCreate,
  };
}

// The default audience for a new form/survey based on the creator's role.
export function defaultAudienceValue(opts: {
  isSuperadmin: boolean;
  isProvincialCoordinator: boolean;
  provinceId: number | null;
}): AudienceValue {
  if (opts.isSuperadmin) return { audienceType: "all", audienceIds: [] };
  if (opts.isProvincialCoordinator)
    return {
      audienceType: "province",
      audienceIds: opts.provinceId != null ? [opts.provinceId] : [],
    };
  return { audienceType: "module", audienceIds: [] };
}

export function AudiencePicker({
  value,
  onChange,
}: {
  value: AudienceValue;
  onChange: (v: AudienceValue) => void;
}) {
  const { user, isSuperadmin, isProvincialCoordinator, coordinatedModules } =
    useFormSurveyCreator();
  const provinceId = user?.provinceId ?? null;

  const { data: provinces = [] } = useListProvinces();
  const { data: islands = [] } = useListIslands();
  const { data: centers = [] } = useListCenters();
  const { data: modules = [] } = useListModules({});
  const { data: users = [] } = useListUsers();

  const centerProvince = useMemo(
    () => new Map(centers.map((c) => [c.id, c.provinceId ?? null])),
    [centers],
  );

  const allowedTypes: AudienceType[] = isSuperadmin
    ? ["all", "province", "island", "center", "module", "users"]
    : isProvincialCoordinator
      ? ["province", "island", "center", "module", "users"]
      : ["module"];

  const provinceOptions = isSuperadmin
    ? provinces
    : provinces.filter((p) => p.id === provinceId);
  const islandOptions = isSuperadmin
    ? islands
    : islands.filter((i) => i.provinceId === provinceId);
  const centerOptions = isSuperadmin
    ? centers
    : centers.filter((c) => c.provinceId === provinceId);
  const moduleOptions = isSuperadmin
    ? modules
    : isProvincialCoordinator
      ? modules.filter(
          (m) =>
            m.centerId != null && centerProvince.get(m.centerId) === provinceId,
        )
      : coordinatedModules;
  const userOptions = isSuperadmin
    ? users
    : isProvincialCoordinator
      ? users.filter(
          (u) =>
            u.provinceId === provinceId ||
            (u.centerId != null &&
              centerProvince.get(u.centerId) === provinceId),
        )
      : [];

  const setType = (t: AudienceType) => {
    if (t === "province" && isProvincialCoordinator && provinceId != null) {
      onChange({ audienceType: "province", audienceIds: [provinceId] });
    } else {
      onChange({ audienceType: t, audienceIds: [] });
    }
  };

  const toggleId = (id: number) => {
    const has = value.audienceIds.includes(id);
    onChange({
      ...value,
      audienceIds: has
        ? value.audienceIds.filter((x) => x !== id)
        : [...value.audienceIds, id],
    });
  };

  const renderOptions = (options: { id: number; label: string }[]) => (
    <div className="max-h-44 overflow-y-auto rounded-md border p-2 space-y-1.5">
      {options.length === 0 ? (
        <p className="text-xs text-muted-foreground px-1 py-2">
          No hay opciones disponibles.
        </p>
      ) : (
        options.map((o) => (
          <label
            key={o.id}
            className="flex items-center gap-2 text-sm cursor-pointer"
          >
            <Checkbox
              checked={value.audienceIds.includes(o.id)}
              onCheckedChange={() => toggleId(o.id)}
            />
            <span>{o.label}</span>
          </label>
        ))
      )}
    </div>
  );

  return (
    <div className="space-y-2">
      <Label>Destinatarios</Label>
      <Select
        value={value.audienceType}
        onValueChange={(v) => setType(v as AudienceType)}
      >
        <SelectTrigger>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {allowedTypes.map((t) => (
            <SelectItem key={t} value={t}>
              {TYPE_LABELS[t]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {value.audienceType === "province" &&
        (isProvincialCoordinator ? (
          <p className="text-xs text-muted-foreground">
            Se enviará a todo el profesorado de tu provincia.
          </p>
        ) : (
          renderOptions(provinceOptions.map((p) => ({ id: p.id, label: p.name })))
        ))}
      {value.audienceType === "island" &&
        renderOptions(islandOptions.map((i) => ({ id: i.id, label: i.name })))}
      {value.audienceType === "center" &&
        renderOptions(centerOptions.map((c) => ({ id: c.id, label: c.name })))}
      {value.audienceType === "module" &&
        renderOptions(
          moduleOptions.map((m) => ({ id: m.id, label: m.name })),
        )}
      {value.audienceType === "users" &&
        renderOptions(
          userOptions.map((u) => ({
            id: u.id,
            label: `${u.name} (${u.email})`,
          })),
        )}
    </div>
  );
}
