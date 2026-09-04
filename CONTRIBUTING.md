# Contributing

Read `AGENTS.md` and `docs/management/CONTROL_PANEL.md` before changing code. Keep the macOS client and HAPI Hub integration separable: client changes belong in this repository's Swift sources; generic Hub changes belong in `integrations/hapi` and must remain applicable to a documented upstream baseline.

## Development

```bash
./scripts/doctor.sh
xcodegen generate
xcodebuild -project HapiCompanion.xcodeproj -scheme HapiCompanion \
  -destination 'platform=macOS' -derivedDataPath .build \
  CODE_SIGNING_ALLOWED=NO test
```

Do not commit credentials, `~/.hapi/settings.json`, Keychain exports, Hub databases, derived data, or generated `.app` bundles. Any change to pairing, device isolation, ACK semantics, or database migration requires a security and rollback review.
