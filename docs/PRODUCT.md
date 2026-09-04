# Product and architecture

## Product definition

HAPI Companion is the native attention layer for HAPI on macOS. Its job is deliberately narrow: tell a person when a coding-agent task needs attention, make that signal audible, and take the person back to the precise conversation with one click.

### Audience

- self-hosted HAPI users working across several coding-agent sessions;
- developers who keep HAPI installed as an Edge PWA;
- operators who value a low-resource, inspectable local component.

### Promise

**Finish elsewhere. Return exactly where the work happened.**

### Non-goals

- replacing the HAPI UI;
- implementing another agent runner;
- polling HAPI's SQLite database;
- becoming a general-purpose notification center;
- copying long-lived HAPI credentials outside the existing CLI configuration.

## Runtime architecture

The Hub composes completion events into a durable outbox. Each registered Companion installation has an isolated ACK cursor. The menu-bar app keeps one authenticated SSE stream open, submits a native notification, starts its bundled sound, records the event ID locally, then ACKs it. If delivery or sound start fails, the event is not ACKed and can be replayed.

Notification click handling uses the event URL as authority. Companion derives the Hub origin from that URL, discovers the matching Edge PWA from its application metadata, raises it, and only then updates the matching Edge window. This ordering avoids Edge restoring the PWA start route over the target conversation.

## Reliability model

| Failure | Behavior |
|---|---|
| network interruption | exponential reconnect backoff, then durable replay |
| expired device token | delete only the device token and re-pair |
| invalid CLI token | wait 60 seconds; no hot auth loop |
| denied notification permission | do not ACK; show corrective status |
| sound cannot start | do not ACK |
| duplicate replay | local event-ID deduplication, then ACK |
| PWA unavailable | Edge app-mode fallback, then default browser |

## Trust boundaries

The normal CLI token is used only with the configured Hub's existing auth endpoint during pairing. The server returns a dedicated device token. Keychain stores that token. The app does not read the Hub database, spawn an HTTP polling process, or expose a local network listener.
