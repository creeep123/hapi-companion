# HAPI Companion Mobile Relay

The Relay is the VM-side Android notification worker for Companion V0.4. It consumes one durable Hub SSE as an independent device, evaluates the shared reminder policy, posts bounded notification content to ntfy, persists a handled ledger and ACKs only afterward.

Relay 0.4.1 supports `fixed` notification content by default and the explicitly selected `eventPreview` mode. Preview mode forwards only the validated HAPI event title and body after control-character cleanup and UTF-8 byte limits; it never forwards the event URL or other event fields. Public-provider preview use requires an explicit privacy opt-in in the controlling client.

```bash
bun install --frozen-lockfile
bun run typecheck
bun test
../scripts/package-mobile-relay.sh bun-linux-x64
```

The listener defaults to `127.0.0.1:8789`; expose it only through an HTTPS reverse proxy. State defaults to `/var/lib/hapi-mobile-relay/state.json`. Never print that file. See `docs/deployments/V0_4_MOBILE_RELAY_RUNBOOK.md`.
