# ADR 0006: Route notification launches inside the existing HAPI PWA

Status: accepted, 2026-09-14.

## Decision

The installed HAPI PWA declares `client_mode: ['focus-existing', 'navigate-existing']`. Its `launchQueue` consumer validates an exact same-origin session URL and calls TanStack Router for an in-place route change. Companion gives the target URL directly to the installed Edge PWA once.

## Why

The previous flow activated the PWA shim, waited, then changed Edge's active-tab URL with AppleScript. Users saw the Companion settings window briefly and the PWA could visibly navigate twice. Launch Handler is the browser-supported handoff for focusing an installed PWA while delivering the launch target; the app router can then switch sessions without recreating the document.

## Compatibility and safety

The ordered manifest value keeps `navigate-existing` as fallback when `focus-existing` is unavailable. A closed PWA opens normally. External origins, extra path components, query/fragment values and invalid session identifiers are ignored. This alters only embedded web behavior and adds no Hub API or migration.
