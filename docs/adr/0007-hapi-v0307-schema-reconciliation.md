# ADR 0007: Reconcile the two schema-v26 lineages in schema v27

## Status

Accepted for the HAPI v0.30.7 candidate; production remains gated by the updater.

## Context

Upstream HAPI v0.30.7 and the earlier Companion-patched HAPI both identify their database as schema v26, but contain different additions. Upstream v26 adds `idx_messages_immediate_queued`; Companion v26 adds the device registry and durable notification outbox. A normal one-path migration cannot tell which lineage produced an existing database.

## Decision

The port raises the patched schema to v27. Its v26→v27 migration is idempotent and ensures the upstream index, Companion tables and Companion indexes all exist. It neither drops nor recreates existing Companion state. Tests cover both v26 starting shapes and prove preservation of an ACK cursor and queued event.

## Consequences

Fresh databases and older migrations end with the union of both schemas. An upgrade can accept either supported v26 lineage. Rollback uses the pre-upgrade database backup and prior binary because older binaries reject schema v27; changing only `user_version` is not an approved rollback.
