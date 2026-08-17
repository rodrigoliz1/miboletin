"use client";

import { CaretDown, Check, MagnifyingGlass, X } from "@phosphor-icons/react";
import React, { useEffect, useMemo, useRef, useState } from "react";
import type { SearchableSelectOption } from "@/components/searchable-select";

function normalized(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

export function SearchableMultiSelect({
  name,
  label,
  options,
  defaultValues = [],
  searchPlaceholder = "Buscar dentro de las opciones…",
  hint,
  required = false,
}: {
  name: string;
  label: string;
  options: SearchableSelectOption[];
  defaultValues?: string[];
  searchPlaceholder?: string;
  hint?: string;
  required?: boolean;
}) {
  const generatedId = React.useId();
  const id = `${name}-${generatedId.replace(/:/g, "")}`;
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const validDefaults = defaultValues.filter((value) => options.some((option) => option.value === value));
  const [values, setValues] = useState<string[]>(validDefaults.length ? validDefaults : required && options[0] ? [options[0].value] : []);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const selected = options.filter((option) => values.includes(option.value));
  const visible = useMemo(() => {
    const terms = normalized(query.trim()).split(/\s+/).filter(Boolean);
    if (!terms.length) return options;
    return options.filter((option) => {
      const haystack = normalized(`${option.label} ${option.group ?? ""} ${option.description ?? ""} ${option.keywords ?? ""}`);
      return terms.every((term) => haystack.includes(term));
    });
  }, [options, query]);

  useEffect(() => {
    const close = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") { setOpen(false); trigger.current?.focus(); }
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("pointerdown", close); document.removeEventListener("keydown", escape); };
  }, []);

  const toggle = (value: string) => {
    setValues((current) => current.includes(value) ? current.filter((item) => item !== value) : [...current, value]);
  };

  return <div className="field searchable-select-field searchable-multi-field" ref={root}>
    <label id={`${id}-label`} htmlFor={`${id}-trigger`}>{label}</label>
    {values.map((value) => <input key={value} type="hidden" name={name} value={value} />)}
    <button
      ref={trigger}
      id={`${id}-trigger`}
      className="searchable-select-trigger searchable-multi-trigger"
      type="button"
      role="combobox"
      aria-labelledby={`${id}-label`}
      aria-controls={`${id}-options`}
      aria-expanded={open}
      aria-haspopup="listbox"
      onClick={() => { setOpen((current) => !current); setQuery(""); }}
    >
      <span><strong>{selected.length ? `${selected.length} ${selected.length === 1 ? "carpeta seleccionada" : "carpetas seleccionadas"}` : "Selecciona una o más carpetas"}</strong><small>{selected.map((item) => item.label).join(" · ") || "Organiza el asunto desde el alta"}</small></span>
      <CaretDown size={15} aria-hidden="true" />
    </button>
    {selected.length > 0 && <div className="multi-select-chips">{selected.map((option) => <button key={option.value} type="button" onClick={() => toggle(option.value)} aria-label={`Quitar carpeta ${option.label}`}>{option.label}<X size={11} /></button>)}</div>}
    {open && <div className="searchable-select-popover">
      <div className="searchable-select-search"><MagnifyingGlass size={16} aria-hidden="true" /><input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder={searchPlaceholder} aria-label={`Buscar ${label.toLowerCase()}`} /></div>
      <div className="searchable-select-results" id={`${id}-options`} role="listbox" aria-labelledby={`${id}-label`} aria-multiselectable="true">
        {!visible.length && <div className="searchable-select-empty">No hay opciones que coincidan con “{query}”.</div>}
        {visible.map((option) => <button key={option.value} type="button" role="option" aria-selected={values.includes(option.value)} onClick={() => toggle(option.value)}>
          <span><strong>{option.label}</strong>{option.description && <small>{option.description}</small>}</span>
          <span className="multi-option-check">{values.includes(option.value) && <Check size={14} weight="bold" />}</span>
        </button>)}
      </div>
      <footer><span>{values.length} seleccionadas</span><button type="button" onClick={() => setOpen(false)}>Listo</button></footer>
    </div>}
    {required && !values.length && <small className="field-error">Selecciona al menos una carpeta.</small>}
    {hint && <small>{hint}</small>}
  </div>;
}
