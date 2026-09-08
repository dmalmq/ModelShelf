// Affected-object filters: source, discipline, storey, IFC type. Native selects
// keep the panel keyboard-operable; values are plain strings the viewer bridge
// consumes without knowing finding types.
"use client";

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
  return (
    <div className="grid grid-cols-2 gap-1.5" role="group" aria-label="Affected-object filters / 絞り込み">
      <FilterSelect
        label="Source / ソース"
        ariaLabel="Source filter"
        value={filters.source}
        onChange={(value) => onChange({ ...filters, source: value })}
      >
        <option value="all">All sources / 全て</option>
        {options.sources.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </FilterSelect>
      <FilterSelect
        label="Discipline / 分野"
        ariaLabel="Discipline filter"
        value={filters.discipline}
        onChange={(value) => onChange({ ...filters, discipline: value })}
      >
        <option value="all">All / 全て</option>
        {options.disciplines.map((value) => (
          <option key={value} value={value}>
            {value}
          </option>
        ))}
      </FilterSelect>
      <FilterSelect
        label="Storey / 階"
        ariaLabel="Storey filter"
        value={filters.storey}
        onChange={(value) => onChange({ ...filters, storey: value })}
      >
        <option value="all">All / 全て</option>
        {options.storeys.map((value) => (
          <option key={value} value={value}>
            {value}
          </option>
        ))}
      </FilterSelect>
      <FilterSelect
        label="IFC type / タイプ"
        ariaLabel="Type filter"
        value={filters.ifcType}
        onChange={(value) => onChange({ ...filters, ifcType: value })}
      >
        <option value="all">All / 全て</option>
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
  label,
  ariaLabel,
  value,
  onChange,
  children,
}: {
  label: string;
  ariaLabel: string;
  value: string;
  onChange: (value: string) => void;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <label className="block text-[11px]">
      <span className="mb-0.5 block text-muted-foreground">{label}</span>
      <select
        aria-label={ariaLabel}
        className="w-full border border-border bg-card px-1.5 py-1 text-xs"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        {children}
      </select>
    </label>
  );
}
