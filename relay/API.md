# Relay management API v1

All responses set `Cache-Control: no-store`. Except for liveness and pairing, send `Authorization: Bearer <management token>`. JSON request bodies are limited to 64 KiB. Secret fields are write-only.

## Public endpoints

- `GET /health` → `{ "ok": true, "version": 1 }`. This is liveness only.
- `POST /v1/pair` with `{ "code": "one-time code" }` → `{ "managementToken": "returned once" }`.

The reverse proxy must overwrite `X-Forwarded-For`; the Relay uses its first value for per-source pairing failure limits.

## Authenticated endpoints

- `GET /v1/status?activationId=<uuid>` returns only non-secret state:

```json
{
  "revision": 1,
  "enabled": true,
  "paused": false,
  "capabilities": { "notificationContentModes": ["fixed", "eventPreview"] },
  "activation": { "status": "committed", "activationId": "uuid" },
  "health": { "stream": "connected", "lastAckSeq": 12, "latestNtfyAcceptanceAt": 1788800000000 }
}
```

An absent activation is returned as `null`; clients must retry the same activation after an unknown POST outcome and must never treat one transient absence as permission to compensate the Hub device.

- `PUT /v1/config` carries `expectedRevision` and a complete `config`. Success returns only the new revision; stale updates return 409 plus current revision.

```json
{
  "expectedRevision": 0,
  "config": {
    "receiverId": "stable-local-id",
    "revision": 1,
    "ntfyBaseUrl": "https://ntfy.sh",
    "topic": "at-least-128-bits-of-randomness",
    "hapiOrigin": "https://hapi.example",
    "contentMode": "fixed",
    "policy": {
      "scope": "all",
      "selectedSessionIds": [],
      "keywords": [],
      "durationEnabled": false,
      "minimumMinutes": 1,
      "quietEnabled": false,
      "quietStartMinutes": 1320,
      "quietEndMinutes": 480,
      "quietMode": "mute",
      "timeZone": "Asia/Shanghai"
    }
  }
}
```

`contentMode` is `fixed` or `eventPreview`. An omitted field from a legacy schema-v1 state/config is canonicalized to `fixed`; unknown values and wrong JSON types are rejected. Clients must observe `capabilities.notificationContentModes` before offering or claiming synchronization of preview mode. In `eventPreview`, only the validated event title and body are eligible for ntfy: title is sanitized and capped at 256 UTF-8 bytes, body normalizes newlines, removes other controls and is capped at 4096 UTF-8 bytes. Invalid surrogate code units are replaced and truncation never cuts a Unicode code point. Empty fields fall back independently to fixed product text. The click URL is always reconstructed from `hapiOrigin` and `sessionId`; event URL and all other event fields are excluded.

- `POST /v1/test` with `{ "sessionId": "an-id-from-the-Hub-catalog" }` posts one ntfy test with fixed safe product text, regardless of configured content mode, and returns `{ "accepted": true }` only after a valid ntfy acceptance response.
- `POST /v1/activate` with `{ "activationId", "installationId", "deviceId", "token", "revision" }`. IDs are UUIDs and the token is write-only. Success is `{ "status": "committed" }`; same-ID retries are idempotent and a competing activation returns 409.
- `POST /v1/repair` with `{ "activationId", "installationId", "deviceId", "token" }` explicitly replaces a rejected Hub device credential for the committed installation.
- `POST /v1/pause` with `{ "paused": true|false }`. Paused events are durably handled and ACKed without an ntfy post.
- `POST /v1/resume` explicitly restarts a stream stopped by a repaired provider or contract condition.
- `DELETE /v1/receiver` stops delivery and clears receiver, Hub credential, activation and ledger while retaining Relay pairing. It is internally idempotent.
- `POST /v1/unpair` performs receiver removal and revokes the management bearer. The response may be retried only after generating a new pairing code because the old bearer is no longer valid.

Errors use `{ "error": "non-secret description" }`; revision conflicts also include `revision`. Configuration revision must equal `expectedRevision + 1`, and `receiverId` is immutable until removal. `401` means an invalid management bearer, `404` an unknown route, and `409` a revision, activation-fingerprint or immutable-binding conflict. Validation/provider errors use `400`; persisted readiness contains only enumerated safe error codes.
