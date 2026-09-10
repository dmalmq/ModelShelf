// Affected-object filters: source, discipline, storey, IFC type. Native selects
// keep the panel keyboard-operable; values are plain strings the viewer bridge
// consumes without knowing finding types.
"use client";

import { FILTER_COPY } from "@/lib/i18n";
import { useLocale } from "../locale-provider";
import type { ObjectFilterSet } from "./review-state";

export interface FilterOptions {
  sources: { value: string; label: string }[];
  disciplines: string[];
  storeys: string[];
  types: string[];
}

interface ObjectFiltersProps {
  readonly filters: ObjectFilterSet;
  readonly options: FilterOptions;
  readonly onChange: (filters: ObjectFilterSet) => void;
}

export function ObjectFilters({ filters, options, onChange }: ObjectFiltersProps): React.JSX.Element {
  const { locale } = useLocale();
  const copy = FILTER_COPY[locale];
  return (
    <div className="grid grid-cols-2 gap-1.5" role="group" aria-label={copy.group}>
      <FilterSelect
        name="source"
        label={copy.source}
        ariaLabel={copy.sourceFilter}
        value={filters.source}
        onChange={(value) => onChange({ ...filters, source: value })}
      >
        <option value="all">{copy.allSources}</option>
        {options.sources.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </FilterSelect>
      <FilterSelect
        name="discipline"
        label={copy.discipline}
        value={filters.discipline}
        ariaLabel={copy.disciplineFilter}
        onChange={(value) => onChange({ ...filters, discipline: value })}
      >
        <option value="all">{copy.all}</option>
        {options.disciplines.map((value) => (
          <option key={value} value={value}>
            {value}
          </option>
        ))}
      </FilterSelect>
      <FilterSelect
        name="storey"
        label={copy.storey}
        value={filters.storey}
        ariaLabel={copy.storeyFilter}
        onChange={(value) => onChange({ ...filters, storey: value })}
      >
        <option value="all">{copy.all}</option>
        {options.storeys.map((value) => (
          <option key={value} value={value}>
            {value}
          </option>
        ))}
      </FilterSelect>
      <FilterSelect
        name="ifcType"
        label={copy.ifcType}
        value={filters.ifcType}
        ariaLabel={copy.typeFilter}
        onChange={(value) => onChange({ ...filters, ifcType: value })}
      >
        <option value="all">{copy.all}</option>
        {options.types.map((value) => (
          <option key={value} value={value}>
            {value}
          </option>
        ))}
      </FilterSelect>
    </div>
  );
}

function FilterSelect({
  name,
  label,
  ariaLabel,
  value,
  onChange,
  children,
}: {
  name: string;
  label: string;
  ariaLabel: string;
  value: string;
  onChange: (value: string) => void;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <label className="block text-xs">
      <span className="mb-0.5 block text-muted-foreground">{label}</span>
      <select
        aria-label={ariaLabel}
        data-filter={name}
        className="min-h-11 w-full border border-border bg-card px-1.5 py-1 text-xs sm:min-h-8"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        {children}
      </select>
    </label>
  );
}
