# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

## [0.1.0] - Unreleased

### Added

- `jsonforge types` — generate TypeScript interfaces from a JSON file, URL, or stdin.
- `jsonforge zod` — generate Zod 4 schemas with exported inferred types.
- `jsonforge generate` — generate both into one output directory.
- `jsonforge mock` — serve a JSON file or directory of fixtures as a read-only local REST API, with `--port`, `--host`, `--delay` and `?_status=` error responses.
- Multiple-sample inference from top-level arrays (optional keys, unions, nullable values).
- Warnings for values that cannot be typed precisely (empty arrays, empty objects, null-only values).
- URL input with request headers, timeout, 5 MB size limit, redirect handling and private-network blocking (`--allow-private-network` to opt in).
- Overwrite protection with `--force`, `--quiet`, and `--json` machine-readable output.
