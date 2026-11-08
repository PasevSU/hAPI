# hAPI Admin DevTools

An **independent, optional Home Assistant add-on** in the same repository as hAPI Enterprise. It exposes an administrator-only Ingress panel, reads the historical Guardian protocols, and checks the primary hAPI service without changing it.

**Installation vs activation:** Home Assistant installs add-ons before allowing their configuration. Installation cannot technically be gated by a fingerprint entered later. **Activation is gated:** no diagnostics, hAPI access or developer functionality is available until the correct GitHub-associated SSH public key is checked and a fresh challenge has a valid detached OpenPGP signature from the corresponding GPG signing key.

This is a separate Home Assistant sidebar panel titled **hAPI Admin DevTools**, not an unreviewed injection into the existing hAPI app. The primary hAPI add-on, SQLite database, portals and UI remain unchanged.

For setup, see [DOCS.md](DOCS.md). No autonomous changes or restarts are implemented.
