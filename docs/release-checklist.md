# Release Checklist

Maintainer checklist for publishing Agent Action Runner packages.

## Local Verification

Run these before creating a release commit:

```bash
npm run build
npm run typecheck
npm test
npm run cli:smoke
npm run pack:check
npm run publish:workspaces -- --dry-run
npm audit --omit=dev
git diff --check
node examples/basic/dist/index.js
```

`npm run publish:workspaces` defaults to dry-run. Actual publish requires `-- --publish` or `DRY_RUN=false`.

## Release Commit

```bash
git status --short
git add .
git commit -m "Release 0.x.y"
git push origin main
```

## Publish

The preferred publish path is GitHub Actions with npm Trusted Publishing.

1. Run the `Publish` workflow for `main` in dry-run mode.
2. Confirm the expected packages would publish.
3. Run the `Publish` workflow again in publish mode.
4. Verify npm registry versions:

```bash
npm view @agent-action-runner/core version
npm view @agent-action-runner/http version
npm view @agent-action-runner/express version
npm view @agent-action-runner/fastify version
npm view @agent-action-runner/nestjs version
npm view @agent-action-runner/mcp version
npm view @agent-action-runner/cli version
```

## Tag And Release Notes

Create the annotated tag after successful publish:

```bash
git tag -a v0.x.y -m "v0.x.y"
git push origin v0.x.y
```

Then create or update the GitHub Release from the changelog section.

```bash
npm run release:notes -- 0.x.y
```

## Safety Checks

- Confirm package versions and internal peer ranges match the release.
- Confirm `CHANGELOG.md` calls out intentional safety-related breaking changes.
- Confirm package README files include new public API docs.
- Keep maintainer publish details out of the product README.
