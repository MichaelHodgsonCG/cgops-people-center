-- ============================================================================
-- The departed_on stamp trigger predates the 'departing' status and nulled
-- the date for every status except 'departed' — wiping a departing person's
-- scheduled last day on save. Let 'departing' carry the date too; everything
-- else still clears it. Flipping departing -> departed keeps the recorded
-- last day (already set), or stamps today if somehow absent. Idempotent.
-- ============================================================================

create or replace function public.people_center_stamp_departed_on()
returns trigger
language plpgsql
as $$
begin
  if new.status = 'departed' and old.status is distinct from 'departed' then
    new.departed_on = coalesce(new.departed_on, current_date);
  end if;
  if new.status not in ('departed', 'departing') then
    new.departed_on = null;
  end if;
  return new;
end;
$$;
