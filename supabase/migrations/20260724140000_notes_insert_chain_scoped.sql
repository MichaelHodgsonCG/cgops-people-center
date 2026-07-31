-- ============================================================================
-- Notes: creation must respect the reporting chain.
--
-- Bug: the notes INSERT policy let ANY regional_leader/location_leader write a
-- leadership/development note on ANY person — including peers and people ABOVE
-- them in the org. Note VIEWING was already chain-gated (people_center_is_above
-- in the SELECT policy), but creation was not, so a manager could open a note
-- thread on a peer or a superior.
--
-- Fix: a manager-level role (regional_leader/location_leader) may only create a
-- note on someone STRICTLY BELOW them in the reporting chain
-- (people_center_is_above(viewer, subject)). Admin/executive remain unrestricted
-- — HQ/talent capturing leadership notes company-wide is the feature's purpose
-- (ADR 0008). The voluntary self "fun fact" path is unchanged.
--
-- Enforcement only tightens INSERT; SELECT already excludes peers/superiors.
-- ============================================================================

alter policy people_center_notes_insert
  on public.people_center_notes
  with check (
    author_auth_uid = auth.uid()
    and (
      -- HQ altitude: unrestricted (the talent function).
      people_center_current_role() = any (array['admin', 'executive'])
      -- Manager roles: only on people below them in the reporting chain.
      or (
        people_center_current_role() = any (array['regional_leader', 'location_leader'])
        and people_center_is_above(people_center_current_person_id(), person_id)
      )
      -- Anyone: their own voluntary, HQ-visibility fun fact (unchanged).
      or (
        people_center_has_app_access()
        and people_center_current_person_id() is not null
        and person_id = people_center_current_person_id()
        and category = 'relationship'
        and visibility = 'hq'
        and voluntarily_shared
      )
    )
  );
