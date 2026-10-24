# Publishing RadCode Hermes

Two registries matter, and they are unrelated:

| Registry | Serves | Command |
|---|---|---|
| **Visual Studio Marketplace** | VS Code | `npx vsce publish` |
| **Open VSX** | VSCodium, Gitpod, Theia (VS Code's marketplace is not reachable from VSCodium) | `npx ovsx publish` |

Everything below is already prepared in `package.json`: `publisher`, `icon`, `repository`, `bugs`,
`homepage`, `author`, valid `categories`, `keywords`, `galleryBanner`. `CHANGELOG.md`, `LICENSE` and
`README.md` are bundled and rendered on the listing. `npx vsce package` currently reports no warnings.

## 1. Claim the publisher id (one time, only you can do this)

1. Open <https://marketplace.visualstudio.com/manage> and sign in — this creates an Azure DevOps
   organisation on first visit.
2. **Create publisher** with id **`lainiceanuraduc`** (it must match `package.json`; pick another id and
   change the field too — the id is permanent once created).
3. Note the publisher id, not the display name.

## 2. Create a Personal Access Token

<https://dev.azure.com> → user settings → **Personal access tokens** → *New token*:

- **Organization:** *All accessible organizations* (a single org silently fails to publish)
- **Scopes:** *Custom defined* → **Marketplace → Manage**
- Short expiry (30 days) is fine; regenerate when it lapses.

## 3. Package and test the exact artifact

```bash
export PATH=/data/usr/bin:$PATH      # this machine: node is not on PATH
npm run compile
npm test && npm run test:ui
npm run package                       # → radcode-hermes-agent-<version>.vsix
```

Install the VSIX once by hand and click through it before a first public release — the Marketplace
listing is the same bytes.

## 4. Publish

```bash
npx vsce login lainiceanuraduc        # paste the PAT when prompted (stored in the OS keychain)
npm run publish                       # = vsce publish --no-dependencies
```

Or non-interactively, without storing anything:

```bash
VSCE_PAT=<token> npm run publish
```

Listing appears at
<https://marketplace.visualstudio.com/items?itemName=lainiceanuraduc.radcode-hermes-agent>
and the install id is `lainiceanuraduc.radcode-hermes-agent`.  The name `radcode-hermes` is reserved
by a deleted listing and cannot be reused, so the id carries the `-agent` suffix. Renaming the id
means a **new** listing: existing installs of the old id do not auto-update.

Publish a specific increment with `npx vsce publish minor` (or `patch`, `major`) — it bumps
`package.json`, commits and tags for you.

## 5. Open VSX (for VSCodium)

```bash
npx ovsx create-namespace lainiceanuraduc   # one time, needs an Eclipse account token
npx ovsx publish radcode-hermes-agent-<version>.vsix -p <openvsx-token>
```

Open VSX namespaces are separate from Marketplace publisher ids, even when they read the same.

## 6. Every release after this one

```bash
npm version patch --no-git-tag-version    # or edit package.json + the four version strings
#   package.json · src/infrastructure/AcpClient.ts · media/view.html (header + badge) · README.md
npm run compile && npm test && npm run test:ui
npm run package
git add -A && git commit -m "Release vX.Y.Z" && git tag vX.Y.Z && git push --tags
VSCE_PAT=<token> npm run publish
```

The four version strings drift silently otherwise; the badge in `media/view.html` is what users see
in the view header, so check it before shipping.

## What must never be committed

- `.env` files and any API key — the extension reads `~/.hermes/.env` at runtime, never from the repo.
- The PAT. Use `vsce login`, the OS keychain, or an environment variable.
- `*.vsix` and `dist/` are already in `.gitignore`; `media/fonts/*.zip` and `media/icon@2x.png` are
  excluded from the package by `.vscodeignore`.

## Font licences

Only one font ships: `media/fonts/PublicPixel.ttf`, by GGBotNet, **CC0 1.0 (public domain)** —
redistribution inside a published extension is permitted, and provenance is recorded in
`media/fonts/PublicPixel.LICENSE.txt`.

This section used to say "Pixelzone and Valve ship under their own licences from 1001fonts". That was
wrong in the way that matters: the host site labelled Valve "free for commercial use", but the package
delivered a **Desktop EULA** whose §4 forbids use in "an app, game, desktop application, plug-in,
extension, mod, or other software". Shipping it inside the VSIX (0.1.21, 0.1.22) was a licence
violation; it was removed in 0.1.23 and purged from git history.

Before bundling any binary, read the licence file that arrives **inside the download** — not the badge
on the page it came from — and check it against distribution, not just use.
