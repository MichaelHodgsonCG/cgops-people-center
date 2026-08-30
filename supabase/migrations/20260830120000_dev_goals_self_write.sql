-- ============================================================================
-- Quarterly development goals: people can author their OWN goals.
-- The F27 sheets are written in the first person — the person drafts their
-- goals and the GM checks in — so the digital version should let the subject
-- write too, not just HQ and their chain. Self-write covers create, edit,
-- and status changes on rows where they are the OWNER (not merely support).
-- HQ + strict-ancestor write is unchanged. Idempotent.
-- ============================================================================

drop policy if exists people_center_dev_goals_write on public.people_center_dev_goals;
create policy people_center_dev_goals_write
  on public.people_center_dev_goals for all to authenticated
  using (
    public.people_center_current_role() = any (array['admin', 'executive'])
    or public.people_center_is_above(public.people_center_current_person_id(), owner_person_id)
    or (
      public.people_center_current_person_id() is not null
      and owner_person_id = public.people_center_current_person_id()
    )
  )
  with check (
    public.people_center_current_role() = any (array['admin', 'executive'])
    or public.people_center_is_above(public.people_center_current_person_id(), owner_person_id)
    or (
      public.people_center_current_person_id() is not null
      and owner_person_id = public.people_center_current_person_id()
    )
  );
