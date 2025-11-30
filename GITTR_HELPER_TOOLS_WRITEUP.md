# gittr-helper-tools Repository Update

## Overview

The `gittr-helper-tools` repository contains reusable components and utilities extracted from the main `gittr` codebase. This writeup documents the latest updates and how to integrate them.

## Recent Updates

### NIP-C0 Code Snippets Support

The main `gittr` repository now includes full NIP-C0 (Code Snippets) support. The following components can be extracted to `gittr-helper-tools`:

#### 1. Code Snippet Event Creation (`lib/nostr/events.ts`)

**Function**: `createCodeSnippetEvent()`

Creates NIP-C0 compliant `kind:1337` events for sharing code snippets.

**Usage**:
```typescript
import { createCodeSnippetEvent, KIND_CODE_SNIPPET } from '@gittr/helper-tools/nostr/events';

const snippetEvent = createCodeSnippetEvent({
  content: "console.log('Hello, Nostr!');",
  language: "javascript",
  extension: "js",
  name: "example.js",
  description: "A simple example",
  repo: "30617:<pubkey>:<repo-name>", // NIP-34 format
}, privateKey);
```

**Tags Supported**:
- `l`: Language (lowercase)
- `extension`: File extension (without dot)
- `name`: Filename
- `description`: Description
- `runtime`: Runtime environment
- `license[]`: License(s) - multiple supported
- `dep[]`: Dependencies - multiple supported
- `repo`: Repository reference (URL or NIP-34 format)

#### 2. Code Snippet Renderer Component (`components/ui/code-snippet-renderer.tsx`)

**Component**: `CodeSnippetRenderer`

Renders `kind:1337` events with syntax highlighting and metadata.

**Features**:
- Syntax highlighting using `react-syntax-highlighter`
- Language detection from tags
- Copy code button
- Download as file button
- Repository link (if `repo` tag present)
- Author metadata display

**Usage**:
```typescript
import { CodeSnippetRenderer } from '@gittr/helper-tools/components/code-snippet-renderer';

<CodeSnippetRenderer 
  event={snippetEvent} 
  showAuthor={true} 
/>
```

**Dependencies**:
- `react-syntax-highlighter` (with language registrations)
- `lucide-react` (for icons)
- `nostr-tools` (for NIP-19 encoding)

#### 3. Code Viewer Selection UX (`components/ui/code-viewer.tsx`)

**Component**: `CodeViewer`

Enhanced code viewer with improved selection UX and permalink support.

**Key Features**:
- **Drag Selection**: Click and drag to select code ranges
- **Range Mode**: Two-click selection for precise range selection
- **Permalink Support**: URL hash-based line highlighting (`#L5-L17`)
- **Mobile Support**: Touch gestures for selection
- **Share as Snippet**: Direct integration with NIP-C0 snippet creation

**Selection Methods**:
1. **Single Click**: Select a single line
2. **Drag**: Click and drag across lines
3. **Range Mode**: Click "Select Range", then click first and last lines
4. **Keyboard**: Shift/Ctrl+click to extend selection
5. **Mobile**: Tap for single, two-tap for range, long-press for permalink

**Permalink Format**:
- Single line: `#L5`
- Range: `#L5-L17`

**Usage**:
```typescript
import { CodeViewer } from '@gittr/helper-tools/components/code-viewer';

<CodeViewer
  content={fileContent}
  filePath="src/example.ts"
  entity="npub1..."
  repo="my-repo"
  branch="main"
/>
```

### YouTube Embed Support

Updated markdown media handling to support YouTube embeds with proper CSP configuration.

**File**: `snippets/markdown-media-handling/markdown-media.tsx`

**Changes**:
- Added `referrerPolicy="no-referrer-when-downgrade"` to iframes
- Added responsive styling with `aspectRatio: '16/9'`
- Updated CSP documentation

**CSP Configuration Required**:
```javascript
// next.config.js
frame-src 'self' https://www.youtube.com https://youtube.com https://youtu.be
```

## Integration Guide

### For New Projects

1. **Install Dependencies**:
```bash
npm install react-syntax-highlighter lucide-react nostr-tools
```

2. **Copy Components**:
- `components/ui/code-snippet-renderer.tsx`
- `components/ui/code-viewer.tsx` (if needed)
- `lib/nostr/events.ts` (NIP-C0 functions)

3. **Register Syntax Highlighter Languages**:
```typescript
import javascript from 'react-syntax-highlighter/dist/cjs/languages/hljs/javascript';
import python from 'react-syntax-highlighter/dist/cjs/languages/hljs/python';
// ... other languages

SyntaxHighlighter.registerLanguage('javascript', javascript);
SyntaxHighlighter.registerLanguage('python', python);
// ... register other languages
```

4. **Configure CSP** (if using YouTube embeds):
Update your `next.config.js` or security headers to allow YouTube domains in `frame-src`.

### For Existing Projects

1. **Update Code Snippet Renderer**:
   - Ensure `react-syntax-highlighter` is installed
   - Update language registrations if needed
   - Verify NIP-34 repo reference parsing

2. **Update Code Viewer** (if using):
   - The new selection UX is backwards compatible
   - Permalink highlighting works automatically
   - No breaking changes to existing code

3. **Update Markdown Media Handler**:
   - Add `referrerPolicy` to YouTube iframes
   - Update CSP configuration

## NIP-C0 Compliance

All implementations are fully NIP-C0 compliant:

✅ **Event Structure**:
- `kind: 1337` ✓
- `content`: Actual code (string) ✓
- Tags: All optional tags supported ✓

✅ **Tag Formats**:
- `l`: Lowercase language ✓
- `extension`: Without leading dot ✓
- `repo`: Supports URL and NIP-34 format ✓
- Multiple `license` and `dep` tags ✓

✅ **Parser**:
- Correctly parses all NIP-C0 tags
- Handles NIP-34 repo references
- Displays metadata correctly

## Testing

To test NIP-C0 snippets:

1. **Create a Snippet**:
   - Select code in code viewer
   - Click "Share as Snippet"
   - Add description (optional)
   - Publish to Nostr

2. **View a Snippet**:
   - Reference snippet event ID in comments
   - Snippet should render inline with syntax highlighting

3. **Verify Permalink**:
   - Select code lines
   - Copy permalink
   - Open in new tab/window
   - Lines should be highlighted correctly

## Documentation

- **NIP-C0 Specification**: https://github.com/nostr-protocol/nips/blob/master/C0.md
- **Main Repository Docs**: `docs/NIPS_AND_EVENT_KINDS.md`
- **Integration Plan**: `docs/NIP_C0_INTEGRATION_PLAN.md`
- **Compliance Check**: `NIP_C0_COMPLIANCE_CHECK.md`

## Breaking Changes

**None** - All updates are backwards compatible.

## Future Enhancements

Potential additions to `gittr-helper-tools`:

1. **Snippet Discovery Component**: Browse/search snippets by language, author, etc.
2. **Snippet Embed Widget**: Embed snippets in external websites
3. **Snippet Analytics**: Track views, copies, downloads
4. **Batch Snippet Operations**: Share multiple snippets at once

## Support

For issues or questions:
- Main Repository: https://github.com/arbadacarbaYK/gittr
- Helper Tools: https://github.com/arbadacarbaYK/gittr-helper-tools

