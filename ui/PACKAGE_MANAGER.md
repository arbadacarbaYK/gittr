# Package Manager: Yarn vs npm

## Primary Package Manager: **Yarn**

This project uses **Yarn** as the primary package manager. The `yarn.lock` file is the source of truth for dependency versions.

### Why Yarn?

1. **Dependabot Integration**: GitHub Dependabot automatically updates `yarn.lock` when dependencies have security updates
2. **Smaller Lockfile**: `yarn.lock` is ~620KB vs `package-lock.json` at ~1.4MB
3. **Consistency**: All deployment scripts (Hetzner, GitHub Actions) use Yarn
4. **Reliability**: Yarn's lockfile format is more deterministic

### Installation

```bash
# Install dependencies (primary method)
yarn install

# Or with frozen lockfile (CI/production)
yarn install --frozen-lockfile
```

### Build Commands

```bash
# Development
yarn dev

# Production build
yarn build

# Start production server
yarn start
```

## npm Compatibility

**npm still works**, but `yarn.lock` takes precedence:

- `package-lock.json` is kept in the repo for npm users
- However, **Dependabot only updates `yarn.lock`**
- If you use `npm install`, it will update `package-lock.json` but this may cause conflicts
- **Recommendation**: Use Yarn to stay in sync with the project

### If You Must Use npm

```bash
# This will work, but may cause lockfile conflicts
npm install
npm run build
```

**⚠️ Warning**: If you use `npm install`, make sure to also run `yarn install` afterward to keep `yarn.lock` in sync, or your changes may conflict with Dependabot updates.

## Deployment

### Hetzner Server
- Uses: `yarn install --frozen-lockfile`
- Script: `upload_to_hetzner.sh`

### GitHub Actions (APK Build)
- Uses: `yarn install --frozen-lockfile`
- Workflow: `.github/workflows/build-apk.yml`

### Local Development
- Recommended: `yarn dev`
- Alternative: `npm run dev` (works but not recommended)

## Lockfile Status

- ✅ **yarn.lock** - Primary, updated by Dependabot, used in all deployments
- ⚠️ **package-lock.json** - Kept for npm compatibility, but not automatically updated

## Updating Dependencies

When Dependabot creates a PR:
- It updates `yarn.lock` automatically
- You should **NOT** manually update `package-lock.json`
- After merging, run `yarn install` locally to sync

If you manually add a dependency:
```bash
# Use yarn (recommended)
yarn add <package>

# This updates both yarn.lock AND package.json
# package-lock.json will be out of sync until someone runs npm install
```

## Summary

**Use Yarn** for all operations. npm works but may cause lockfile conflicts. The project is standardized on Yarn.

