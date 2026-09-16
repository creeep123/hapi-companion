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

## Official-HAPI Sidecar candidate

V0.6 adds a second runtime mode that reads unmodified HAPI through official REST and one SSE connection, persists canonical events in a Companion-owned SQLite outbox, and delivers to Mac and ntfy through independent consumers:

```bash
hapi-mobile-relay serve-sidecar
```

The required HAPI access token is read only from `HAPI_SIDECAR_ACCESS_TOKEN_FILE` or systemd credential `hapi-access-token`; it cannot be set or read through HTTP. Required non-secret origins are `HAPI_SIDECAR_HAPI_ORIGIN`, `HAPI_SIDECAR_PUBLIC_ORIGIN`, and `HAPI_SIDECAR_API_ORIGIN`. `HAPI_SIDECAR_DELIVERY_MODE` defaults to `shadow`. The explicit value `active` is only an operational ceiling: delivery remains off until authenticated v2 activation verifies a live official source and commits its cutover timestamp. A restart or environment edit cannot activate delivery by itself. Run `../scripts/test-official-hapi-v0307.sh` and `../scripts/package-sidecar.sh bun-linux-x64` for the clean-official and package gates. See [V0.6 runbook](../docs/deployments/V0_6_OFFICIAL_HAPI_SIDECAR_RUNBOOK.md).
