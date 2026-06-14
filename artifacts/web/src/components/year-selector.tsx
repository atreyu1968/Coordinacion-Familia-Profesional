import { useListAcademicYears } from "@workspace/api-client-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export const ALL_YEARS = "all";

export function useAcademicYears() {
  const { data, isLoading } = useListAcademicYears();
  return {
    years: data?.years ?? [],
    activeYear: data?.activeYear ?? null,
    isLoading,
  };
}

type YearFilterProps = {
  value: string;
  onChange: (value: string) => void;
  className?: string;
  includeAll?: boolean;
};

/** Page-level filter selector. Value is the school year name or ALL_YEARS. */
export function YearFilter({
  value,
  onChange,
  className,
  includeAll = true,
}: YearFilterProps) {
  const { years, activeYear } = useAcademicYears();
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className={className}>
        <SelectValue placeholder="Curso académico" />
      </SelectTrigger>
      <SelectContent>
        {includeAll && <SelectItem value={ALL_YEARS}>Todos los cursos</SelectItem>}
        {years.map((y) => (
          <SelectItem key={y.id} value={y.name}>
            {y.name}
            {y.name === activeYear ? " (activo)" : ""}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

type YearPickerProps = {
  value: string;
  onChange: (value: string) => void;
  id?: string;
  placeholder?: string;
};

/** Dialog field selector. Value is the school year name. */
export function YearPicker({
  value,
  onChange,
  id,
  placeholder = "Selecciona un curso",
}: YearPickerProps) {
  const { years, activeYear } = useAcademicYears();
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger id={id}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {years.map((y) => (
          <SelectItem key={y.id} value={y.name}>
            {y.name}
            {y.name === activeYear ? " (activo)" : ""}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
