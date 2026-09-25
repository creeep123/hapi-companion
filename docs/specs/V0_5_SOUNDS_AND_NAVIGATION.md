# V0.5 sounds and smooth notification navigation

Status: implementation in progress. User authorized release on 2026-09-14.

## User outcome

- Add the accepted “像素金币 · 清脆” and “像素金币 · 双音” choices to the existing sound picker.
- Clicking a macOS notification must not flash the Companion settings window.
- When a current Edge HAPI PWA supports Launch Handler, focus that window and change to the exact session through HAPI's client router without a document reload.
- A closed PWA opens the exact session normally. Browsers without `focus-existing` fall back to one ordinary `navigate-existing` launch.

## Boundaries

- Companion sends one validated same-origin `/sessions/<UUID>` URL to the installed Edge PWA in one launch request.
- HAPI accepts only exact same-origin session URLs from `launchQueue`, including UUID v7 session IDs; malformed, external, query-bearing or non-session targets do nothing.
- Existing durable outbox, single SSE, explicit ACK, reminder rules, mobile Relay and credentials do not change.
- The HAPI integration patch changes only the PWA manifest and client launch consumer. There is no API, database schema or migration change.

## Acceptance

1. Both presets decode, appear once, persist, preview and pass the documented loudness/peak checks.
2. Swift tests and Release build pass; a real notification click does not expose the settings window.
3. HAPI launch-handler unit tests, full Web tests, full HAPI tests, typecheck and build pass against the pinned clean baseline.
4. On a supported production Edge PWA, a click focuses the existing app and switches to the exact session without a document reload; same-session clicks do not navigate.
5. Regenerate the cumulative patch, record its new SHA-256, obtain updater pin/gate acceptance, deploy Hub web assets with a verified rollback, then publish and validate the signed Mac update.

## UUID v7 routing regression

A real UUID v7 session such as `019ff3fa-2872-7443-a3cb-84a2b2b906ea` must reach the SPA router when a notification launches an existing PWA. The previous `[1-5]` UUID-version check rejected it after the PWA had opened. The launch handler now accepts RFC UUID versions 1–8 while retaining the same-origin, exact-path, no-query/no-fragment and UUID-variant checks. This changes embedded Web behavior only; there is no Hub API or database migration change. Production remains on the prior patch until the updater owner pins and accepts the new cumulative patch.
