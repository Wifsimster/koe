# Live chat

The README and the package description advertise "live chat". In the code at `1cbae34`, chat is **not wired**. The schema has `conversations` and `messages` tables. `WidgetConfig.features.chat` and the locale strings (`tabs.chat`, `chat.placeholder`, `chat.send`) exist "for forward compatibility". There is no widget screen (`Panel.tsx` renders only `bug`, `feature`, `vote` and `my-requests`), no API route, and no dashboard page. `AGENTS.md` says: do not document chat as an active feature.

## Sub-features

- `chat-tables`: the `conversations` (project, user, last_message_at) and `messages` (author_kind user/admin/system, body, read_at) tables. They exist and are always empty.
- `chat-config-flag`: `features.chat` is accepted by `Koe.init` and ignored.
- `chat-ui`: absent.
- `chat-api`: absent.

## How to get to it (user POV)

- Not reachable. The widget picker shows no chat card, whatever `features.chat` is set to.

## Driving it with control-koe

Preconditions:

- A fresh `$C launch` and `$C doctor` exits 0.

- **Prove its absence.** Run `$C widget open`. The `aria` output lists only "Report a bug", "Suggest an idea", "Browse ideas" and "My requests".
- **No backing data.** Run `docker exec koe-verify-pg psql -U koe -d koe -Atc "select count(*) from conversations"`. It returns `0`.
- **When chat ships:** add `widget chat` (open the chat screen, type into the message box, send) and a dashboard recipe. Check the rows in `messages` and the admin's view. Prove delivery in both directions.

## Gotchas

- `docs/integration-widget.md` says the chat tab "exists but stays local and without real time". No chat tab exists at all. Report chat as not drivable; never as verified.
