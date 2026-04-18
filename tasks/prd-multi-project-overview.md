# PRD: Multi-Project Overview Dashboard

## 1. Introduction / Overview

Today a dashboard user with access to several Koe projects lands on `/`
(the inbox), which is scoped to a single project. To check the health of
another project they must switch context and navigate in — there is no
cross-project view. This PRD introduces an **overview landing page** that
shows one KPI tile per project the signed-in admin belongs to, so
multi-project owners can triage across projects at a glance and drill in
from there.

The scope is intentionally small: a new read-only route, a new read-only
endpoint that aggregates counters already present in the schema, no new
tables, no new auth mechanism.

## 2. Goals

- Give multi-project admins a single landing view summarising every
  project they own or are a member of.
- Surface four KPIs per project — chosen so "what's on fire" is
  answerable in one glance: open bugs, open features, total votes on
  open features, and 7-day activity delta.
- Preserve current behaviour for single-project admins (they keep
  landing directly in the inbox).
- Ship in one MR against `main`, reusing existing admin auth,
  membership gating, and DB schema. No migration required.

## 3. User Stories

### US-001: Add `GET /admin/api/overview` endpoint
**Description:** As a dashboard consumer, I want a single endpoint that
returns all my projects plus their KPI counters so the overview page
renders in one round-trip.

**Acceptance Criteria:**
- [ ] New route registered in `packages/api/src/routes/adminApi.ts`:
      `api.get('/overview', async (c) => …)`
- [ ] Response shape (Zod-validated at boundary):
      `{ projects: Array<{ id, key, name, accentColor, kpis: { openBugs, openFeatures, openFeatureVotes, activityLast7d, activityPrev7d } }> }`
- [ ] Scoped to projects where `project_members.user_id = c.get('user').id`
      (defence in depth — no project leaks even if session is stale).
- [ ] Implemented as one SQL round-trip using `GROUP BY projects.id`
      with `FILTER` clauses for the four counters (no N+1 fan-out).
- [ ] Returns `{ projects: [] }` (not 404) when the user has no
      memberships.
- [ ] Typecheck and lint pass.

### US-002: Expose overview in dashboard API client
**Description:** As a frontend developer, I want a typed client method
so page components don't call `fetch` directly.

**Acceptance Criteria:**
- [ ] `packages/dashboard/src/api/client.ts` exports `fetchOverview()`
      returning the typed response from US-001.
- [ ] Error envelope (`fail()` shape) handled consistently with other
      admin calls.
- [ ] Typecheck passes.

### US-003: Add `/overview` route and `OverviewPage` component
**Description:** As a multi-project admin, I want a page that lists my
projects with their KPI tiles so I can see the state of every project
without clicking.

**Acceptance Criteria:**
- [ ] New route `/overview` registered under `authenticatedLayoutRoute`
      in `packages/dashboard/src/router.tsx`.
- [ ] New `OverviewPage.tsx` in `packages/dashboard/src/pages/`.
- [ ] Renders a responsive grid (1 col mobile, 2 col ≥ md, 3 col ≥ lg)
      of project tiles.
- [ ] Each tile shows: project name, accent-colour dot, 4 KPI values
      (open bugs, open features, open feature votes, 7d activity with
      up/down arrow vs. prior 7d).
- [ ] Tile body is a `<Link>` that navigates into that project's inbox
      (reuses `INBOX_DEFAULT_SEARCH`).
- [ ] Loading skeleton while `fetchOverview` is in flight.
- [ ] Empty state if `projects.length === 0`
      (should not happen given the onboarding guard, but defensive copy
      is cheap).
- [ ] Typecheck and lint pass.
- [ ] Verify in browser using dev-browser skill: seed 2+ projects,
      confirm tiles render, counts match, click-through works.

### US-004: Route multi-project admins to `/overview` as their landing page
**Description:** As an admin belonging to ≥ 2 projects, I want `/overview`
to be my default landing page so I don't have to pick a project blindly.

**Acceptance Criteria:**
- [ ] `authenticatedLayoutRoute.beforeLoad` guard: if
      `memberships.length >= 2` and the user navigates to `/`, redirect
      to `/overview`.
- [ ] Single-membership admins still land on `/` (current inbox
      behaviour preserved).
- [ ] Post-login `redirectTo` still wins over the auto-redirect
      (honour the explicit intent in the URL).
- [ ] Onboarding gate (`memberships.length === 0` → `/onboarding`)
      still fires first.
- [ ] Verify in browser using dev-browser skill: log in as
      single-project admin (lands on `/`), log in as multi-project admin
      (lands on `/overview`).

### US-005: Surface "Overview" in the app shell nav
**Description:** As a multi-project admin, I want a persistent nav entry
so I can get back to the overview from deep inside a project.

**Acceptance Criteria:**
- [ ] `AppShell` sidebar shows an "Overview" nav item when
      `memberships.length >= 2`, hidden otherwise.
- [ ] Active-state styling matches existing nav items.
- [ ] `RouteHeader` in `router.tsx` resolves a crumb for
      `/overview` ("Overview — Every project at a glance.").
- [ ] Typecheck and lint pass.
- [ ] Verify in browser using dev-browser skill.

## 4. Functional Requirements

- **FR-1:** The API must expose `GET /admin/api/overview` returning the
  signed-in admin's project list with per-project KPI counters.
- **FR-2:** The endpoint must filter projects through `project_members`
  keyed on the session user's `id`. Projects the user is not a member
  of must not appear, regardless of role.
- **FR-3:** Each project entry must include four KPIs:
  - `openBugs` — count of tickets where `kind='bug' AND status='open'`
  - `openFeatures` — count of tickets where `kind='feature' AND status='open'`
  - `openFeatureVotes` — sum of votes on tickets where `kind='feature' AND status='open'`
  - `activityLast7d` — count of tickets whose `updated_at >= now() - interval '7 days'`
  - `activityPrev7d` — count of tickets whose `updated_at` falls in the
    prior 7-day window (for delta arrow)
- **FR-4:** The endpoint must execute in a single SQL round-trip
  (`LEFT JOIN` + `GROUP BY` with `FILTER` / conditional `count()`).
- **FR-5:** The dashboard must add a `/overview` route that renders
  `OverviewPage`, behind the existing `_authenticated` guard.
- **FR-6:** When `memberships.length >= 2`, navigation to `/` must
  redirect to `/overview`. When `memberships.length === 1`, no redirect
  fires.
- **FR-7:** Each project tile must link to the project's inbox
  (preserving existing inbox search defaults).
- **FR-8:** An "Overview" entry must appear in the app-shell sidebar
  only when `memberships.length >= 2`.

## 5. Non-Goals (Out of Scope)

- **No new KPIs beyond the four listed.** No SLAs, no response-time
  histograms, no reporter-count, no critical-priority breakdown on the
  tile itself — those live on the per-project overview already.
- **No filtering, sorting, or search on the overview grid.** Grid is
  unordered-stable (alphabetical by project name is fine). Sort/filter
  can ship later if operators ask.
- **No cross-project activity feed.** The delta arrow is the only
  "recent activity" signal on v1.
- **No notifications, no unread badges.** Read state is a separate
  stream (widget conversations) and is out of scope.
- **No better-auth migration.** The endpoint uses whatever session
  `adminApi.ts` already uses. If `better-auth` lands later, it will
  replace the session check in one place.
- **No schema migration.** All KPIs derive from existing columns.
- **No caching layer.** Counters are cheap; add caching only if a real
  latency number justifies it.

## 6. Design Considerations

- **Grid layout:** Reuse the existing Tailwind breakpoints and the
  card primitives already used on `InboxPage`. No new component library
  additions.
- **Tile anatomy:** Name + accent dot in the header; 4 KPI rows
  (`label : value`, with 7d delta as a small arrow + signed number on
  the activity row); entire tile is a clickable `<Link>`.
- **Accent colour:** Use `projects.accent_color` (already in schema) for
  the dot. Gives visual differentiation between tiles without extra UI.
- **Empty-KPI styling:** "0" renders as muted text so non-zero values
  pop.
- **Accessibility:** Tiles are links (not buttons) — keyboard + screen
  reader navigation works without extra ARIA.

## 7. Technical Considerations

- **Single-query shape (indicative, not prescriptive):**
  ```sql
  SELECT
    p.id, p.key, p.name, p.accent_color,
    count(*) FILTER (WHERE t.kind = 'bug' AND t.status = 'open') AS open_bugs,
    count(*) FILTER (WHERE t.kind = 'feature' AND t.status = 'open') AS open_features,
    count(v.*) FILTER (WHERE t.kind = 'feature' AND t.status = 'open') AS open_feature_votes,
    count(*) FILTER (WHERE t.updated_at >= now() - interval '7 days') AS activity_last_7d,
    count(*) FILTER (
      WHERE t.updated_at >= now() - interval '14 days'
        AND t.updated_at <  now() - interval '7 days'
    ) AS activity_prev_7d
  FROM project_members pm
  JOIN projects p ON p.id = pm.project_id
  LEFT JOIN tickets t ON t.project_id = p.id
  LEFT JOIN ticket_votes v ON v.ticket_id = t.id
  WHERE pm.user_id = $1
  GROUP BY p.id
  ORDER BY p.name;
  ```
  Translate to Drizzle using `sql` template + `count(sql``…``).filterWhere`.
- **Zod boundary:** Validate the response with a Zod schema before
  returning via `ok()`. Keeps the widget-style discipline consistent.
- **Window convention mismatch:** The existing
  `/projects/:key/overview` uses a 14-day window. This PRD picks 7d to
  keep the tile readable ("this week at a glance"). Flagged as an open
  question — aligning both to one window is the cleaner long-term
  posture.
- **Pagination:** None. An admin with > 100 projects is an operator-scale
  problem we'll see long before we care; listing them all is acceptable.

## 8. Success Metrics

- Multi-project admins spend < 1 click to reach any project's inbox
  from login (measured qualitatively: click-through path from login to
  project inbox is `/login → /overview → /`).
- `/admin/api/overview` p50 latency < 100 ms on a realistic dataset
  (10 projects, 10 k tickets).
- No regression in single-project admin flow: time-to-inbox unchanged
  (landing remains `/`).
- Zero cross-project data leaks — unit test confirms the endpoint
  returns only projects where `project_members.user_id` matches the
  session user.

## 9. Open Questions

- **Window alignment:** Should we migrate the per-project overview
  from 14d to 7d, or switch this new tile to 14d for consistency? My
  recommendation: align on 7d for both — "this week" is the natural
  mental model. Needs a call before US-001.
- **KPI naming:** `openFeatureVotes` could instead be "top-voted open
  feature" (most popular single item) — that's more actionable but
  adds a `title` field to the KPI payload. Stick with the sum for v1?
- **Owner vs. member tile display:** Do members (role ≠ `owner`) see
  the same KPIs or a reduced set? Schema already supports
  `member` / `viewer` roles even if only `owner` is populated today. v1
  assumption: everyone sees the same tile (no per-role gating).
- **Tile order:** Alphabetical by name on v1. Worth adding a
  "recent activity first" sort later? Probably yes, behind a client-side
  toggle — but not blocking.
