# Contributing

Thanks for helping out. Bug reports with a small JSON sample that reproduces the problem are the most useful contributions.

## Setup

Requires Node.js 22 or newer.

```bash
git clone https://github.com/Sameera-MHK/jsoncrafter.git
cd jsoncrafter
npm install
npm test
```

Run the CLI from the checkout:

```bash
node bin/jsoncrafter.js types fixtures/user.json --output /tmp/user.types.ts
node bin/jsoncrafter.js mock fixtures
```

## Project layout

```
bin/jsoncrafter.js            executable entry point
src/cli.js                  command dispatch, help, error reporting
src/commands/               one file per command + shared input/output flow
src/core/parse-json.js      JSON parsing and top-level validation
src/core/infer-types.js     shared inference model and type naming
src/core/generate-*.js      TypeScript and Zod code generators
src/core/fetch-json.js      URL fetching with safety checks
src/core/write-output.js    file writing with overwrite protection
src/mock/server.js          mock REST server
test/                       node:test test suite
fixtures/                   example fixtures
```

## Guidelines

- Keep runtime dependencies at zero unless there is a strong reason. TypeScript and Zod are dev dependencies used only in tests.
- Both generators must read from the same model in `infer-types.js`, so TypeScript and Zod output agree.
- Never interpolate input into generated code without escaping it.
- Generated output must be deterministic.
- Add a test for every bug fix and new behavior. Tests must not use the internet.
- Use [Conventional Commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`, `docs:`, `test:`, `chore:`).

## Release checklist

1. `npm ci && npm test` passes locally and CI is green on all supported Node.js versions.
2. Update `version` in `package.json` and move the `Unreleased` entries in `CHANGELOG.md` under the new version with today's date.
3. Check the npm name is still free: `npm view jsoncrafter` should return `404` before the first release.
4. Inspect the tarball: `npm pack --dry-run` — only `bin/`, `src/`, `README.md`, `LICENSE`, `CHANGELOG.md` and `package.json` should be listed.
5. `npm audit` reports no unresolved issues.
6. Commit (`chore(release): vX.Y.Z`), tag (`git tag vX.Y.Z`), push the commit and the tag.
7. `npm publish` (add `--access public` for a scoped name).
8. Create the GitHub release from the tag with the changelog notes.
