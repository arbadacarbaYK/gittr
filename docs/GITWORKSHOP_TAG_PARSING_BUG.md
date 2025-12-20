# GitWorkshop.dev Tag Parsing Bug

## Problem

GitWorkshop.dev is only showing **one** clone URL and **one** relay, even though our events contain multiple separate tags for each.

## Root Cause

GitWorkshop.dev uses `getTagMultiValue()` function which has a bug:

```typescript
// /tmp/gitworkshop/src/lib/utils.ts:38-40
export function getTagMultiValue(tags: string[][], name: string): string[] | undefined {
	const foundTag = tags.find((t) => t[0] === name);  // ❌ Only finds FIRST tag!
	return foundTag ? foundTag.slice(1) : undefined;
}
```

**The bug**: `.find()` only returns the **first** tag with that name, ignoring all subsequent tags.

**What it should use**: `getValueOfEachTagOccurence()` which uses `.filter()`:

```typescript
// /tmp/gitworkshop/src/lib/utils.ts:33-35
export function getValueOfEachTagOccurence(tags: string[][], name: string): string[] {
	return tags.filter((t) => t[0] === name).map((t) => t[1]);  // ✅ Gets ALL tags!
}
```

## Where It's Used

In `/tmp/gitworkshop/src/lib/processors/Repo.ts`:

```typescript
// Line 172-174: Only gets first relay tag
getTagMultiValue(event.tags, 'relays')?.forEach((v) => {
	relays.push(v);
});

// Line 180-182: Only gets first clone tag
getTagMultiValue(event.tags, 'clone')?.forEach((v) => {
	clone.push(v);
});
```

## Our Event Format (Correct)

We're creating events correctly per NIP-34 spec:

```typescript
// Multiple separate tags (correct per NIP-34)
nip34Tags.push(["clone", "https://git.gittr.space/npub1.../repo.git"]);
nip34Tags.push(["clone", "https://relay.ngit.dev/npub1.../repo.git"]);
nip34Tags.push(["clone", "https://git.shakespeare.diy/npub1.../repo.git"]);

nip34Tags.push(["relays", "wss://relay.ngit.dev"]);
nip34Tags.push(["relays", "wss://git.shakespeare.diy"]);
```

## Impact

- ✅ Our events are **correct** per NIP-34 spec
- ❌ GitWorkshop.dev only shows the **first** clone URL and **first** relay
- ✅ Other NIP-34 clients (that parse correctly) will show all clone URLs and relays

## Workaround

**None** - This is a bug in GitWorkshop.dev that needs to be fixed upstream.

However, we can verify our events are correct by:
1. Checking on nostr.watch (shows all tags)
2. Inspecting the event JSON directly
3. Using other NIP-34 clients that parse correctly

## Fix Needed in GitWorkshop.dev

Change `/tmp/gitworkshop/src/lib/processors/Repo.ts`:

```typescript
// Before (buggy):
const relays: string[] = [];
getTagMultiValue(event.tags, 'relays')?.forEach((v) => {
	relays.push(v);
});

// After (correct):
const relays: string[] = [];
getValueOfEachTagOccurence(event.tags, 'relays').forEach((v) => {
	relays.push(v);
});

// Same for clone tags:
const clone: string[] = [];
getValueOfEachTagOccurence(event.tags, 'clone').forEach((v) => {
	clone.push(v);
});
```

## Verification

To verify our events have all tags, you can:

1. **Find your event ID** from:
   - The push confirmation dialog (shows event IDs after signing)
   - Browser console logs during push (look for `✅ [Push Repo] Event signed successfully. Event ID: ...`)
   - `localStorage` in browser dev tools (search for `gittr_repos` and find the repo's `eventId`)

2. **Check on nostr.watch**:
   ```
   https://nostr.watch/e/<YOUR_EVENT_ID>
   ```
   Replace `<YOUR_EVENT_ID>` with your actual event ID.

3. **Query via API** (requires `jq`):
   ```bash
   curl "https://api.nostr.watch/v1/event/<YOUR_EVENT_ID>" | jq '.tags[] | select(.[0] == "clone" or .[0] == "relays")'
   ```

4. **Or use Python** (no jq needed):
   ```bash
   curl -s "https://api.nostr.watch/v1/event/<YOUR_EVENT_ID>" | python3 -c "import sys, json; data=json.load(sys.stdin); tags=[t for t in data.get('tags',[]) if t[0] in ['clone','relays']]; print(f'Found {len(tags)} clone/relay tags:'); [print(f\"  {t[0]}: {t[1]}\") for t in tags]"
   ```

**Example**: If your event ID is `abc123...`, you would see multiple `clone` and `relays` tags in the output, proving our events are correct and the bug is in gitworkshop.dev's parsing.

