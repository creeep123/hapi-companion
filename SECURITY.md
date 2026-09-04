# Security policy

Please do not open public issues containing HAPI access tokens, device tokens, Hub databases, private domains, session content, or Keychain exports.

For a suspected vulnerability, use GitHub's private vulnerability reporting for this repository when available. Until a public security contact is published, report only a redacted reproduction in a GitHub issue and ask the maintainer to move the discussion to a private channel.

## Supported version

Before the first tagged release, only the latest `main` commit is supported. The Hub patch is tied to the exact HAPI baseline documented in `integrations/hapi/README.md`.

## Sensitive areas

Changes to pairing, token storage, namespace isolation, ACK validation, URL routing, Apple Events automation, or Hub database migrations require explicit security review and regression tests.
