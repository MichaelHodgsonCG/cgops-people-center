-- Watch list access change (Michael, 2026-09-03): "Move full watch list to
-- admin. Allow users add new names to the watch list. Do not expose the
-- watch list."
--
-- READING (and editing/removing) the list becomes ADMIN ONLY — executives
-- lose the read they had; like everyone else they now get the anonymous
-- match flag via the security-definer people_center_watchlist_check(), which
-- is unchanged. ADDING a name opens to the hiring roles (admin, executive,
-- regional_leader, location_leader): a manager can report someone without
-- ever being able to read a single row back.

drop policy if exists people_center_hiring_watchlist_all
  on public.people_center_hiring_watchlist;

create policy people_center_hiring_watchlist_select
  on public.people_center_hiring_watchlist for select
  using (public.people_center_current_role() = 'admin');

create policy people_center_hiring_watchlist_insert
  on public.people_center_hiring_watchlist for insert
  with check (
    public.people_center_current_role()
      in ('admin', 'executive', 'regional_leader', 'location_leader')
  );

create policy people_center_hiring_watchlist_update
  on public.people_center_hiring_watchlist for update
  using (public.people_center_current_role() = 'admin')
  with check (public.people_center_current_role() = 'admin');

create policy people_center_hiring_watchlist_delete
  on public.people_center_hiring_watchlist for delete
  using (public.people_center_current_role() = 'admin');
