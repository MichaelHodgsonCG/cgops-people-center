-- ============================================================================
-- Quarterly development goals — the F27 "Quarterly Goals" sheets as UTL v1
-- conformant tasks (Michael's green light, 2026-08-29). One row per goal per
-- person per quarter: SMART title, baseline → target, key actions, a coach
-- (support), GM check-ins, and the standard task shape from the CG Universal
-- Task List Standard §1 (owner/support person-id + name snapshot, typed
-- due_date, canonical non-null status, completed_at/by, owner index).
--
-- 1. people_center_fiscal_quarters — VIEW over the CGOPS fiscal_calendar
--    (13 four-week periods/yr; readable by all authenticated). Michael's
--    quarter rule: Q1=P1-3, Q2=P4-6, Q3=P7-9, Q4=P10-13 (four periods).
-- 2. people_center_dev_goals — the goals themselves. The SUBJECT of the goal
--    is its owner (their development, their task); support = coach/GM.
-- 3. resolve_my_people_tasks() — the UTL §4 resolver for the reserved
--    `people` source: outstanding goals for auth.uid()'s person, owner OR
--    support, due-date order, empty (not error) when unlinked. Gap-seat
--    assignments stay OUT of the resolver until their derived-closure
--    materialization is decided (per the 2026-08-13 conformance review).
--
-- Visibility mirrors dev assessments + UTL §6.6: admin/executive, strict
-- ancestors of the subject, PLUS the owner and support themselves (a person
-- must see their own tasks). Writes: admin/executive + ancestors.
-- Idempotent.
-- ============================================================================

create or replace view public.people_center_fiscal_quarters as
select
  fiscal_year,
  case
    when period <= 3 then 1
    when period <= 6 then 2
    when period <= 9 then 3
    else 4
  end as quarter,
  min(start_date) as starts_on,
  max(end_date) as ends_on
from public.fiscal_calendar
group by fiscal_year, 2;

grant select on public.people_center_fiscal_quarters to authenticated;

create table if not exists public.people_center_dev_goals (
  id uuid primary key default gen_random_uuid(),
  owner_person_id uuid not null references public.people_center_people (id) on delete cascade,
  owner_name text not null default '',
  support_person_id uuid references public.people_center_people (id) on delete set null,
  support_name text not null default '',
  kind text not null default 'custom'
    check (kind in ('mission_impact', 'improve_kpi', 'improve_accountability', 'custom')),
  title text not null,
  detail text not null default '', -- key actions / context
  baseline text not null default '', -- current result
  target text not null default '',
  fiscal_year integer,
  quarter integer check (quarter between 1 and 4),
  due_date date,
  status text not null default 'open'
    check (status in ('open', 'in_progress', 'blocked', 'done', 'dropped', 'not_applicable')),
  completed_at timestamptz,
  completed_by_person_id uuid references public.people_center_people (id) on delete set null,
  completed_by_name text,
  checkin1_on date,
  checkin1_note text not null default '',
  checkin2_on date,
  checkin2_note text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid,
  updated_by_name text
);

create index if not exists people_center_dev_goals_owner
  on public.people_center_dev_goals (owner_person_id);
create index if not exists people_center_dev_goals_support
  on public.people_center_dev_goals (support_person_id);

alter table public.people_center_dev_goals enable row level security;

drop policy if exists people_center_dev_goals_select on public.people_center_dev_goals;
create policy people_center_dev_goals_select
  on public.people_center_dev_goals for select to authenticated
  using (
    public.people_center_current_role() = any (array['admin', 'executive'])
    or public.people_center_is_above(public.people_center_current_person_id(), owner_person_id)
    or (
      public.people_center_current_person_id() is not null
      and (
        owner_person_id = public.people_center_current_person_id()
        or support_person_id = public.people_center_current_person_id()
      )
    )
  );

drop policy if exists people_center_dev_goals_write on public.people_center_dev_goals;
create policy people_center_dev_goals_write
  on public.people_center_dev_goals for all to authenticated
  using (
    public.people_center_current_role() = any (array['admin', 'executive'])
    or public.people_center_is_above(public.people_center_current_person_id(), owner_person_id)
  )
  with check (
    public.people_center_current_role() = any (array['admin', 'executive'])
    or public.people_center_is_above(public.people_center_current_person_id(), owner_person_id)
  );

-- UTL §4 resolver for the `people` source. Definer so it can read the goals
-- regardless of caller role, but ONLY rows keyed to the caller's own person.
create or replace function public.resolve_my_people_tasks()
returns table (
  task_id uuid,
  title text,
  context_1 text,
  context_2 text,
  due_date date,
  status text,
  priority text,
  progress_done integer,
  progress_total integer,
  launch_path text
)
language sql
stable
security definer
set search_path = public
as $$
  select
    g.id,
    g.title,
    case g.kind
      when 'mission_impact' then 'Mission impact goal'
      when 'improve_kpi' then 'KPI goal'
      when 'improve_accountability' then 'Accountability goal'
      else 'Development goal'
    end
      || case when g.support_person_id = up.person_id then ' — you coach ' || g.owner_name else '' end,
    case
      when g.fiscal_year is not null and g.quarter is not null
        then 'F' || right(g.fiscal_year::text, 2) || ' Q' || g.quarter
      else null
    end,
    g.due_date,
    g.status,
    null::text,
    null::integer,
    null::integer,
    '?view=my-tasks'
  from public.people_center_dev_goals g
  join public.people_center_user_profiles up on up.auth_user_id = auth.uid()
  where up.person_id is not null
    and (g.owner_person_id = up.person_id or g.support_person_id = up.person_id)
    and g.status in ('open', 'in_progress', 'blocked')
  order by g.due_date asc nulls last, g.title;
$$;

revoke all on function public.resolve_my_people_tasks() from public;
grant execute on function public.resolve_my_people_tasks() to authenticated;
