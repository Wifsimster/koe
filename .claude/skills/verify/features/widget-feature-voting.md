# Feature requests, voting and My requests

From the widget, a user suggests an idea ("Suggest an idea", POST `/v1/widget/features`), browses all of the project's ideas sorted by votes ("Browse ideas", GET `/v1/widget/features?userId=`), and toggles an upvote (POST `/v1/widget/features/:id/vote`). The `(ticket_id, user_id)` primary key makes a vote idempotent. An identified user also sees "My requests" (GET `/v1/widget/my-requests`), which lists their own tickets and statuses, with a "View on roadmap" link when a ticket is public.

## Sub-features

- `idea-submit`: the "Title" and "Describe your idea" fields, then "Submit request". The success text is "Thanks for the suggestion!".
- `idea-browse`: a list sorted by vote count, then recency (at most 100 rows).
- `idea-vote`: an optimistic toggle on the button "Upvote" or "Remove upvote". It rolls back on error. Anonymous users see "Sign in to vote" and a disabled button.
- `my-requests`: shown only when `user.id` is set and is not `anonymous`. Status labels are Open, In progress, Planned, Shipped, Closed and Won't fix.
- `my-requests-roadmap-link`: "View on roadmap" appears for tickets with `is_public_roadmap=true` and links to `/r/<projectKey>#t-<id>`.

## How to get to it (user POV)

- From the widget launcher "Support": the cards "Suggest an idea", "Browse ideas" and "My requests".
- From the success state of a bug or idea submission: the "My requests" call to action.
- From the public roadmap page `http://localhost:38787/r/acme-verify`. It lists only tickets an admin published, and it is outside the widget.

## Driving it with control-koe

Preconditions:

- A fresh `$C launch` (default `--origins any`) and `$C doctor` exits 0.

- **Suggest.** Run `$C widget feature --title "Bulk archive projects" --description "Select many projects and archive them at once."`. The result has `response.status: 201`, `successShown: true` and `dbRow.kind: "feature"`.
- **Vote.** Run `$C widget vote --title "Export projects"`. The response is 200 with `data.hasVoted: true` and `data.voteCount: 1`. `dbVotes` contains `user-42`, and `hostUserHasVote` is true. Running it again removes the vote (toggle).
- **Browse.** Run `$C widget open`, then `$C click --role button --name "^Browse ideas"`, then `$C snapshot --selector dialog`. The rows are ordered by votes, so "Dark mode..." (3) comes first.
- **My requests.** After a submission, run `$C widget my-requests`. The `aria` output lists the submitted titles with "Open". `dbRowsForHostUser` is the DB view of the same list.
- **Roadmap link.** Toggle "Visibility" on the ticket in the dashboard (see dashboard-inbox-triage.md), then run `$C widget my-requests`. A "View on roadmap" link appears. Run `$C goto http://localhost:38787/r/acme-verify` to see the public page.

## Gotchas

- Same-origin GETs ("Browse ideas", "My requests") carry no `Origin` header. Under `launch --origins allowlist` they pass through `Sec-Fetch-Site: same-origin`; before the CORS fix they returned 403 `origin_not_allowed`.
- `GET /v1/widget/features` trusts the `userId` query string to compute `hasVoted`, and needs no identity header. The vote itself is HMAC-checked.
- The seeded ideas have `metadata = {}`. Widget-submitted ones carry full browser metadata.
- Votes are not shown in "My requests" for bugs. The `voteCount` column is the same aggregate as the inbox's.
