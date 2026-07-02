# ADR 0002 — Role storage (`user_profiles` + `user_scopes`) and the actor-identity convention

- **Status:** Accepted (2026-07-01)
- **Contract refs:** ARCHITECTURE_REVIEW.md D2, C2, §5.1–5.2;
  CGOPS_FOUNDATIONS.md §3

## Context

The product brief named five app roles but defined no table to hold them,
and left the type of actor/author columns (`author_id`, `assessed_by`,
`actor_id`, …) unspecified. Auth identities are exactly what gets swapped
when CGOPS SSO lands, so attribution must not hang off `auth.users`.

## Decision

1. **Role storage:** `user_profiles (auth_user_id, email, display_name,
   role, person_id)` created by a `handle_new_user()` trigger, plus
   `user_scopes (auth_user_id, region_id?, location_id?)`. Roles are the
   five-value text CHECK `admin | executive | regional_leader |
   location_leader | viewer`; only `admin` is enforced before Phase 2.
   These two tables are the **local projection model**: when CGOPS becomes
   the permission authority, they become a synced projection of CGOPS
   grants; RLS remains the local enforcement layer and app code is
   unchanged because every check flows through the `permissions` module.
2. **Actor identity:** domain-level actor/author columns reference
   **`people.id`** (with a denormalized `*_name` where useful for display),
   resolved via the `current_person_id()` SECURITY DEFINER helper. Only
   `audit_log` additionally records the raw auth uuid (`actor_auth_uid`)
   for traceability.

## Consequences

- Attribution survives the future SSO identity swap.
- `person_id` on `user_profiles` and the `people.id` FKs on
  `audit_log`/`events` are bare uuids until Phase 1 creates `people`
  (FKs added then).
- `roles` (app access) and `positions` (jobs) remain strictly separate
  vocabularies, per the platform naming split.
