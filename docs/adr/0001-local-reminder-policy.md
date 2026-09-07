# ADR 0001 — Local reminder policy over durable delivery

Date: 2026-09-08. Status: accepted after independent V0.2 review.

## Context

The approved V0.2 window lets a Mac user choose actual HAPI sessions or title keywords, filter short turns and schedule quiet hours. Notification delivery remains Hub durable outbox → single SSE → explicit ACK. The Hub currently lacks a minimal Companion session catalog and durable turn duration.

## Decision

Keep personal reminder rules local, scoped to Hub origin, using versioned UserDefaults. The Hub supplies facts (minimal authenticated session snapshot and optional measured turn duration), not personal policy. Catalog requests occur only on settings open or explicit refresh. No second stream or polling.

Distinguish intentional suppression from failure: suppressions are recorded before ACK, silent banners require only banner submission, audible notifications require banner submission and sound start. Required side-effect failures retain replay semantics. The processed-event ledger applies before policy reevaluation, so changing rules cannot resurrect an ACK retry.

Use AppKit-owned retained status item and single settings window with SwiftUI contents. A fallback symbol and application reopen path make settings accessible even if the menu bar is crowded. Test and visual-preview runtimes are isolated from credentials, login items and real Hub traffic.

## Consequences

Existing clients ignore optional duration data; new clients continue notifying for unknown durations and explain that limitation. Full session selection and measured-duration filtering require the versioned repository Hub patch. No auth model or store schema migration is needed. The production Hub stays unchanged until explicit operator approval.

This adds a small scoped read-only device route. Namespace comes from the existing device authentication; returned fields exclude messages, credentials, paths and agent state. Boundary tests are required before the patch is reviewable.
