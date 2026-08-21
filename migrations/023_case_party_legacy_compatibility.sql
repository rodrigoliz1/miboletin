CREATE OR REPLACE FUNCTION public.complete_case_party_search_fields()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.name_canonical := COALESCE(
    NULLIF(btrim(NEW.name_canonical), ''),
    NULLIF(btrim(NEW.name_raw), ''),
    NULLIF(btrim(NEW.name_normalized), '')
  );
  NEW.search_name := COALESCE(
    NULLIF(btrim(NEW.search_name), ''),
    NULLIF(btrim(NEW.name_normalized), ''),
    NEW.name_canonical
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS case_parties_complete_search_fields ON public.case_parties;

CREATE TRIGGER case_parties_complete_search_fields
BEFORE INSERT OR UPDATE OF name_raw, name_normalized, name_canonical, search_name
ON public.case_parties
FOR EACH ROW
EXECUTE FUNCTION public.complete_case_party_search_fields();

UPDATE public.case_parties
SET name_canonical = COALESCE(NULLIF(btrim(name_canonical), ''), NULLIF(btrim(name_raw), ''), name_normalized),
    search_name = COALESCE(NULLIF(btrim(search_name), ''), NULLIF(btrim(name_normalized), ''), name_raw),
    updated_at = now()
WHERE NULLIF(btrim(name_canonical), '') IS NULL
   OR NULLIF(btrim(search_name), '') IS NULL;
