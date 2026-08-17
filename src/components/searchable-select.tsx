"use client";

import { CaretDown, Check, MagnifyingGlass } from "@phosphor-icons/react";
import React, { useEffect, useMemo, useRef, useState } from "react";

export interface SearchableSelectOption {
  value: string;
  label: string;
  group?: string;
  description?: string;
  keywords?: string;
  token?: string;
}

function normalized(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

export function SearchableSelect({
  name,
  label,
  options,
  defaultValue,
  placeholder = "Selecciona una opción",
  searchPlaceholder = "Buscar dentro de las opciones…",
  hint,
  required = false,
  compact = false,
}: {
  name: string;
  label: string;
  options: SearchableSelectOption[];
  defaultValue?: string;
  placeholder?: string;
  searchPlaceholder?: string;
  hint?: string;
  required?: boolean;
  compact?: boolean;
}) {
  const generatedId = React.useId();
  const id = `${name}-${generatedId.replace(/:/g, "")}`;
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const initial = options.find((option) => option.value === defaultValue)?.value ?? (required ? options[0]?.value : defaultValue ?? "");
  const [value, setValue] = useState(initial ?? "");
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const selected = options.find((option) => option.value === value);
  const visible = useMemo(() => {
    const terms = normalized(query.trim()).split(/\s+/).filter(Boolean);
    if (!terms.length) return options;
    return options.filter((option) => {
      const haystack = normalized(`${option.label} ${option.group ?? ""} ${option.description ?? ""} ${option.keywords ?? ""} ${option.value}`);
      return terms.every((term) => haystack.includes(term));
    });
  }, [options, query]);
  const groups = useMemo(() => {
    const grouped = new Map<string, SearchableSelectOption[]>();
    for (const option of visible) {
      const group = option.group ?? "Opciones";
      grouped.set(group, [...(grouped.get(group) ?? []), option]);
    }
    return [...grouped.entries()];
  }, [visible]);

  useEffect(() => {
    const close = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        trigger.current?.focus();
      }
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", escape);
    };
  }, []);

  return <div className={`field searchable-select-field${compact ? " searchable-select-compact" : ""}`} ref={root}>
    <label id={`${id}-label`} htmlFor={`${id}-trigger`}>{label}</label>
    <input type="hidden" name={name} value={value} />
    <input type="hidden" name={`${name}Label`} value={selected?.label ?? ""} />
    {selected?.token && <input type="hidden" name={`${name}Token`} value={selected.token} />}
    <button
      ref={trigger}
      id={`${id}-trigger`}
      className="searchable-select-trigger"
      type="button"
      role="combobox"
      aria-labelledby={`${id}-label`}
      aria-controls={`${id}-options`}
      aria-expanded={open}
      aria-haspopup="listbox"
      onClick={() => { setOpen((current) => !current); setQuery(""); }}
    >
      <span><strong>{selected?.label ?? placeholder}</strong>{selected?.description && <small>{selected.description}</small>}</span>
      <CaretDown size={15} aria-hidden="true" />
    </button>
    {open && <div className="searchable-select-popover">
      <div className="searchable-select-search"><MagnifyingGlass size={16} aria-hidden="true" /><input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder={searchPlaceholder} aria-label={`Buscar ${label.toLowerCase()}`} /></div>
      <div className="searchable-select-results" id={`${id}-options`} role="listbox" aria-labelledby={`${id}-label`}>
        {!visible.length && <div className="searchable-select-empty">No hay opciones que coincidan con “{query}”.</div>}
        {groups.map(([group, items]) => <section key={group} aria-label={group}>
          {(groups.length > 1 || items[0]?.group) && <header><span>{group}</span><small>{items.length}</small></header>}
          {items.map((option) => <button
            key={`${option.group ?? ""}-${option.value}`}
            type="button"
            role="option"
            aria-selected={option.value === value}
            onClick={() => { setValue(option.value); setOpen(false); setQuery(""); trigger.current?.focus(); }}
          >
            <span><strong>{option.label}</strong>{option.description && <small>{option.description}</small>}</span>
            {option.value === value && <Check size={15} weight="bold" aria-hidden="true" />}
          </button>)}
        </section>)}
      </div>
      <footer>{visible.length} {visible.length === 1 ? "opción" : "opciones"}</footer>
    </div>}
    {hint && <small>{hint}</small>}
  </div>;
}
