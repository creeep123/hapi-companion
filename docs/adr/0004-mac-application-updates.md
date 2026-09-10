# Free Mac application updates

Status: accepted for implementation by user, 2026-09-10.

Use pinned Sparkle 2.9.6 with public GitHub Releases archives and a signed HTTPS repository appcast delivered by the free jsDelivr GitHub CDN. Framework and hosting require no paid subscription for this public project. Keep private Ed25519 signing material in the dedicated login Keychain account; commit only the verification key. Require signed feeds and validation before archive extraction. Do not implement a custom privileged installer.

User experience: daily optional checks and standard update reminder; user chooses installation/relaunch. Manual check always available from settings. No automatic background installation, telemetry or Hub changes. Tests and design previews do not instantiate Sparkle. Existing clients require one manual bootstrap.

Continue existing ad-hoc Mac distribution. A paid Developer ID membership/notarization is not required by this chosen scope and is not represented as present; normal macOS first-install approval may remain necessary. Upgrade testing must include nested helper execution, application replacement and Hub reconnection on the actual Mac. The existing scoped credential reset is applied only at the validated installation boundary; no Runner credentials or configuration are modified.

An app-version check is a separate public release check, not polling HAPI for completion events. The Hub remains durable outbox -> single SSE -> explicit ACK.

Sources checked: Sparkle official setup, programmatic setup, sandboxing/code-signing and generated API headers. Release tooling must upload immutable archives before publishing their signed appcast; changing feed bytes requires re-signing. Loss of the private key in this free ad-hoc distribution can require manual bootstrap again. No secrets may be exported by release scripts.

Native-network acceptance: raw.githubusercontent.com and github.com timed out while github.io and api.github.com worked. Sparkle overrides the feed Accept header, ruling out the Contents API. Use free jsDelivr GitHub delivery for XML and public Release Asset API with octet-stream Accept for archives.

Pages was rejected after detecting inherited unrelated blog-domain redirection to a missing route. Do not alter unrelated domains. jsDelivr needs no account or billing for public OSS delivery; it serves only the signed XML, not executable archives. Purge and verify CDN bytes after releases.
