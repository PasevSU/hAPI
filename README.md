# hAPI ENTERPRICE — Home Assistant add-on

[![License](https://img.shields.io/badge/License-Apache%202.0-ff00d8.svg)](https://www.apache.org/licenses/LICENSE-2.0)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D22.13-blue?logo=nodedotjs)](https://nodejs.org)
[![Home Assistant](https://img.shields.io/badge/.-HOME_ASSISTANT-blue?logo=homeassistant)](https://www.home-assistant.io/)

**hAPI ENTERPRICE** (Home Assistant Portal Enterprise) is an enterprise document- and
portal-management platform that runs on the edge between **Home Assistant** and
**Windows**. One shared Node.js backend, one admin console, two environments — the Home
Assistant add-on and a self-contained Windows desktop runtime.

## Repository layout

| Path                                  | Purpose                                                            |
| ------------------------------------- | ------------------------------------------------------------------ |
| `portal_enterprise/`                  | The Home Assistant add-on (source, ready to build and run)         |
| `custom_components/portal_enterprise/`| Optional HA custom integration (public API bridge)                 |
| `tests/`                              | Automated integration test suite (`node tests/*.cjs`)              |
| `docs/`                               | Documentation and architecture plans                               |
| `.dev/`                               | In-progress development (merged into the add-on before a release)  |

## Requirements

- Node.js `>= 22.13` (required for the built-in `node:sqlite` `DatabaseSync` API)
- Home Assistant Supervisor for the add-on, or Windows for the desktop runtime

## Quick links

- [Documentation](docs/)
- [Security policy](SECURITY.md)
- [Contributing](CONTRIBUTING.md)
- [Release qualification](RELEASE_QUALIFICATION.md)
- [Български](BG.md) · [Deutsch](DE.md)

## License

[Apache 2.0](LICENSE)
