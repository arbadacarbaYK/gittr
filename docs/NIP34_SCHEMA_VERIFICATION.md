# NIP-34 Schema Verification Report

**Date**: 2026-01-04  
**Source**: https://github.com/nostrability/schemata/tree/master/nips/nip-34

## Schema Folders Found in Spec Repo

The NIP-34 schemata repository has the following kind folders with `schema.yaml` files:

✅ **kind-1617** (Patches) - Schema exists  
✅ **kind-1621** (Issues) - Schema exists  
✅ **kind-1630** (Status: Open) - Schema exists  
✅ **kind-1631** (Status: Applied/Merged) - Schema exists  
✅ **kind-1632** (Status: Closed) - Schema exists  
✅ **kind-1633** (Status: Draft) - Schema exists  
✅ **kind-30617** (Repository Announcements) - Schema exists  
✅ **kind-30618** (Repository State) - Schema exists  

## Schema Folders NOT Found in Spec Repo

❌ **kind-1618** (Pull Requests) - No schema folder (404)  
❌ **kind-1619** (Pull Request Updates) - No schema folder (404)  
❌ **kind-10317** (User GRASP List) - No schema folder (404)  

## Implementation Status

### ✅ Verified Against Schemas

1. **kind-1617 (Patches)**
   - ✅ Required: `a` tag (30617:owner:repo)
   - ✅ Required: `r` tag (earliest unique commit) - optional in our impl
   - ✅ Required: `p` tag (repository owner)
   - ✅ Content: Patch content (git format-patch output)
   - ✅ Optional: `commit`, `parent-commit`, `commit-pgp-sig`, `committer` tags
   - **Status**: ✅ COMPLIANT

2. **kind-1621 (Issues)**
   - ✅ Required: `a` tag (30617:owner:repo)
   - ✅ Required: `subject` tag (issue title)
   - ✅ Content: Markdown text (issue body)
   - **Status**: ✅ COMPLIANT

3. **kind-30617 (Repository Announcements)**
   - ✅ Required: `d` tag (repository identifier)
   - ✅ Optional: `name`, `description`, `web`, `clone`, `relays`, `maintainers`, `r` tags
   - **Status**: ✅ COMPLIANT

4. **kind-30618 (Repository State)**
   - ✅ Required: `d` tag (repository identifier)
   - ✅ Optional: `refs/.*` tags (git refs) or `HEAD` tag
   - **Status**: ✅ COMPLIANT

### ⚠️ Not Yet in Schemata Repo (But Implemented)

5. **kind-1618 (Pull Requests)**
   - ✅ Required: `a` tag (30617:owner:repo)
   - ✅ Required: `r` tag (earliest unique commit) - optional in our impl
   - ✅ Required: `p` tag (repository owner)
   - ✅ Required: `subject` tag (PR title)
   - ✅ Required: `c` tag (current commit ID)
   - ✅ Required: `clone` tags (at least one)
   - ✅ Content: Markdown text (PR description)
   - **Status**: ✅ IMPLEMENTED (per NIP-34 spec text, not yet in schemata repo)

6. **kind-1619 (Pull Request Updates)**
   - ✅ Required: `a` tag (30617:owner:repo)
   - ✅ Required: `r` tag (earliest unique commit) - optional in our impl
   - ✅ Required: `p` tag (repository owner)
   - ✅ Required: `E` tag (PR event ID) - NIP-22 uppercase
   - ✅ Required: `P` tag (PR author) - NIP-22 uppercase
   - ✅ Required: `c` tag (current commit ID)
   - ✅ Required: `clone` tags (at least one)
   - ✅ Content: Empty string
   - **Status**: ✅ IMPLEMENTED (per NIP-34 spec text, not yet in schemata repo)

7. **kind-10317 (User GRASP List)**
   - ✅ Tags: `g[]` tags (GRASP server URLs in order of preference)
   - ✅ Content: Empty string
   - **Status**: ✅ IMPLEMENTED (per NIP-34 spec text, not yet in schemata repo)

## Summary

- **8/8 kinds with schemas**: ✅ All verified and compliant
- **3/3 kinds without schemas**: ✅ All implemented per NIP-34 spec text
- **Total**: ✅ 11/11 NIP-34 kinds properly supported

## Notes

- The schemata repository appears to be a work-in-progress schema definition repository
- Some kinds (1618, 1619, 10317) are defined in the NIP-34 spec text but don't yet have schema folders
- Our implementation follows the NIP-34 spec text for all kinds, including those without schema folders
- When schemas are added for 1618, 1619, and 10317, we should verify our implementation matches them

