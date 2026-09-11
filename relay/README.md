# HAPI Companion Mobile Relay

The Relay is the VM-side Android notification worker for Companion V0.4. It consumes one durable Hub SSE as an independent device, evaluates the shared reminder policy, posts fixed metadata to ntfy, persists a handled ledger and ACKs only afterward.

```bash
bun install --frozen-lockfile
bun run typecheck
bun test
../scripts/package-mobile-relay.sh bun-linux-x64
```

The listener defaults to `127.0.0.1:8789`; expose it only through an HTTPS reverse proxy. State defaults to `/var/lib/hapi-mobile-relay/state.json`. Never print that file. See `docs/deployments/V0_4_MOBILE_RELAY_RUNBOOK.md`.
