-- ============================================================================
-- Hiring lead times — how many days BEFORE OPENING each role must be hired
-- (Michael's backlog ask: GM ~90 days out, Chef de Cuisine ~60, …), so the
-- gap analysis "needed by" becomes role-aware instead of keying every role off
-- the site's handover date. Company-wide, per position; no row = no lead time
-- (that role keeps the site's staffing deadline). Editable in the Gap
-- Analysis "Required roster" settings panel.
--
-- Read: any authenticated user (not sensitive). Write: admin/executive, like
-- the other gap-planning config tables. Not seeded — the numbers are
-- Michael's call, set in the UI. Idempotent.
-- ============================================================================

create table if not exists public.people_center_hiring_lead_times (
  position_id uuid primary key references public.people_center_positions (id) on delete cascade,
  lead_days integer not null check (lead_days > 0),
  updated_at timestamptz not null default now(),
  updated_by uuid,
  updated_by_name text
);

alter table public.people_center_hiring_lead_times enable row level security;

drop policy if exists people_center_hiring_lead_times_select on public.people_center_hiring_lead_times;
create policy people_center_hiring_lead_times_select
  on public.people_center_hiring_lead_times for select to authenticated using (true);

drop policy if exists people_center_hiring_lead_times_write on public.people_center_hiring_lead_times;
create policy people_center_hiring_lead_times_write
  on public.people_center_hiring_lead_times for all to authenticated
  using (public.people_center_current_role() = any (array['admin', 'executive']))
  with check (public.people_center_current_role() = any (array['admin', 'executive']));
