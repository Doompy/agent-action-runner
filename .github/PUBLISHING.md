# Publishing

Publishing is automated through a manually triggered GitHub Actions workflow.

## Local Dry Run

```bash
npm ci
npm run build
npm run typecheck
npm test
npm run cli:smoke
npm run pack:check
npm audit --omit=dev
DRY_RUN=true npm run publish:workspaces
```

The publish script checks npm for each package version and skips versions that already exist.

For actual publish runs, the script attaches `npm publish` to the current terminal so npm can complete OTP or browser-based authentication. If you prefer to provide an authenticator code explicitly:

```powershell
$env:DRY_RUN="false"
$env:NPM_CONFIG_OTP="123456"
npm run publish:workspaces
Remove-Item Env:DRY_RUN
Remove-Item Env:NPM_CONFIG_OTP
```

## GitHub Actions

Run the `Publish` workflow from the GitHub Actions tab.

- `dry_run: true` checks what would be published.
- `dry_run: false` publishes missing package versions.

The workflow uses npm Trusted Publishing through GitHub Actions OIDC. npm requires Node.js 22.14.0 or newer and npm 11.5.1 or newer for this flow, so the workflow uses Node.js 24.

## npm Trusted Publisher Setup

For each package, configure npm trusted publishing. The helper script prints the commands by default:

```bash
npm run trust:workspaces
```

After the packages exist on npm and you are logged in with npm 11.10.0 or newer, apply the settings:

```bash
APPLY=true npm run trust:workspaces
```

The trust script does not pre-check existing trusted publishers by default because `npm trust list` also requires 2FA. It runs `npm trust github ...` directly so npm can use its normal browser or OTP authentication flow.

If npm returns `409 Conflict` for a package, the script treats it as already configured and continues to the next package.

To enable a pre-check in an already authenticated shell:

```bash
APPLY=true NPM_TRUST_PRECHECK=true npm run trust:workspaces
```

On PowerShell:

```powershell
$env:APPLY="true"
npm run trust:workspaces
Remove-Item Env:APPLY
```

The script configures each public package with:

```txt
Publisher: GitHub Actions
Owner: Doompy
Repository: agent-action-runner
Workflow filename: publish.yml
```

The workflow filename must be exactly `publish.yml` in `.github/workflows/`.

The npm trust command requires the package to already exist on the registry. New packages may need a one-time manual publish or temporary token-based publish before trusted publishing can be configured.

Trusted Publishing automatically generates provenance attestations for public packages published from a public GitHub repository, so the publish script does not pass `--provenance` manually.

## Packages

The script publishes public packages under `packages/*` and ignores private example workspaces.

Current publish order is resolved from internal package dependencies, so packages such as `core` and `mcp` are published before packages that depend on them.
