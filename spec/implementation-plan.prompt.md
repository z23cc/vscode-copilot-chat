# Implementation Plan: @vscode/chat-lib npm module extraction

## Overview
Extract a standalone npm module `@vscode/chat-lib` from the vscode-copilot-chat codebase that provides core chat and inline editing functionality as an SDK for external consumers.

## Goals
- Create a TypeScript-only library (no compiled JS files)
- Decouple from VS Code APIs (only `/common/` and `/node/` layers)
- Provide a clean SDK interface for external projects
- Enable consumers to provide their own service implementations
- Maintain type safety through hand-written `.d.ts` definitions

## File Structure

The generated npm module will have this structure:
```
tmp-chat-lib/
├── package.json
├── main.ts                    # Public entry point
├── chat-lib.d.ts             # Hand-written API definitions
├── README.md
├── LICENSE.txt
└── _internal/                # All implementation files
    ├── platform/
    │   ├── inlineEdits/
    │   ├── chat/
    │   ├── diff/
    │   └── networking/
    ├── util/
    │   ├── vs/
    │   └── node/
    ├── extension/
    │   ├── inlineEdits/
    │   └── xtab/
    └── vscodeTypes.ts
```

## Implementation Steps

### 1. Create API Definition File (`chat-lib.d.ts`)

**Location**: `src/chat-lib.d.ts`

Create a hand-written TypeScript definition file that defines the public API surface. For the demo, this will expose:
- `LineRange` class from VS Code utilities
- Core data types for inline edits
- Observable utilities
- String utilities

**Content**:
```typescript
// Basic demo API surface
export { LineRange } from './_internal/util/vs/editor/common/core/lineRange';
export { Position } from './_internal/util/vs/editor/common/core/position';
export { OffsetRange } from './_internal/util/vs/editor/common/core/offsetRange';

// Data types
export * from './_internal/platform/inlineEdits/common/dataTypes/edit';
export * from './_internal/platform/inlineEdits/common/dataTypes/languageId';
export * from './_internal/platform/inlineEdits/common/dataTypes/documentId';
export * from './_internal/platform/inlineEdits/common/dataTypes/stringValue';

// Observable utilities
export * from './_internal/platform/inlineEdits/common/utils/observable';

// Global utilities
export * from './_internal/platform/chat/common/globalStringUtils';

// Tokenizer utilities
export * from './_internal/util/node/tokenizer';
```

### 2. Create Module Extraction Script

**Location**: `script/build/extractChatLib.ts`

This script will be similar to `copySources.ts` but adapted for our use case:

**Features**:
- Parse TypeScript imports and dependencies
- Copy only `/common/` and `/node/` layer files
- Rewrite import paths to work within the `_internal` structure
- Filter out VS Code API dependencies
- Generate the complete module in `tmp-chat-lib/`

**Key differences from `copySources.ts`**:
- Target directory: `tmp-chat-lib/_internal/`
- Source filtering: Only include `/common/` and `/node/` paths
- Import rewriting: Adjust paths for the new `_internal` structure
- VS Code API filtering: Skip files that import from 'vscode' module

### 3. Create Main Entry Point

**Location**: `tmp-chat-lib/main.ts` (generated)

The main entry point will re-export the public API defined in `chat-lib.d.ts`:

```typescript
// Re-export everything from our public API
export * from './chat-lib';
```

### 4. Entry Points Processing

The script will process these entry points (cleaned and deduplicated):

```typescript
const entryPoints = [
  'src/platform/inlineEdits/common/observableWorkspace.ts',
  'src/util/vs/editor/common/core/position.ts',
  'src/util/vs/base/common/lifecycle.ts',
  'src/extension/inlineEdits/node/nearbyCursorInlineEditProvider.ts',
  'src/platform/inlineEdits/common/dataTypes/languageId.ts',
  'src/util/vs/editor/common/core/lineRange.ts',
  'src/extension/inlineEdits/node/ghNearbyNesProvider.ts',
  'src/extension/inlineEdits/node/nextEditResult.ts',
  'src/extension/xtab/node/xtabProvider.ts',
  'src/platform/inlineEdits/common/workspaceEditTracker/nesXtabHistoryTracker.ts',
  'src/vscodeTypes.ts',
  'src/platform/chat/common/globalStringUtils.ts',
  'src/util/node/tokenizer.ts',
  'src/platform/diff/common/diffService.ts',
  'src/platform/diff/common/diffWorker.ts',
  'src/platform/networking/common/openai.ts',
  'src/util/vs/base/common/uuid.ts',
  'src/platform/inlineEdits/common/dataTypes/documentId.ts',
  'src/platform/inlineEdits/common/dataTypes/edit.ts',
  'src/platform/inlineEdits/common/dataTypes/stringValue.ts',
  'src/platform/inlineEdits/common/utils/observable.ts',
  'src/util/vs/base/common/observableInternal.ts',
  'src/util/vs/editor/common/core/offsetRange.ts',
  'src/util/vs/base/common/charCode.ts'
];
```

### 5. Package.json Generation

The script will generate a `package.json` for the npm module:

```json
{
  "name": "@vscode/chat-lib",
  "version": "0.1.0",
  "description": "Chat and inline editing SDK extracted from VS Code Copilot Chat",
  "main": "main.ts",
  "types": "chat-lib.d.ts",
  "engines": {
    "node": ">=22.14.0"
  },
  "peerDependencies": {
    "typescript": "^5.0.0"
  },
  "keywords": ["chat", "ai", "sdk", "vscode", "copilot"],
  "license": "MIT",
  "files": [
    "main.ts",
    "chat-lib.d.ts",
    "_internal/**/*.ts",
    "README.md",
    "LICENSE.txt"
  ]
}
```

### 6. VS Code API Decoupling Strategy

For files that reference VS Code APIs, the script will:

1. **Skip VS Code imports**: Remove or comment out lines importing from 'vscode'
2. **Replace VS Code types**: Use minimal type definitions for required VS Code types
3. **Create compatibility layer**: Add basic type definitions in `_internal/vscodeCompat.ts`

Example transformations:
```typescript
// Before
import * as vscode from 'vscode';

// After (removed or replaced with compatible types)
// import * as vscode from 'vscode'; // Removed - VS Code API not available

// Before
const position: vscode.Position = ...;

// After
const position: IPosition = ...; // Use internal interface
```

### 7. Import Path Rewriting

The script will rewrite import paths to work within the `_internal` structure:

```typescript
// Before
import { LineRange } from '../../../util/vs/editor/common/core/lineRange';

// After (in _internal context)
import { LineRange } from '../../util/vs/editor/common/core/lineRange';
```

### 8. Build Script Integration

Add npm scripts to `package.json`:

```json
{
  "scripts": {
    "extract-chat-lib": "npx tsx script/build/extractChatLib.ts",
    "build-chat-lib": "npm run extract-chat-lib && cd tmp-chat-lib && tsc --noEmit"
  }
}
```

### 9. Type Checking

The extraction script will:
1. Generate the module
2. Run TypeScript compiler in `--noEmit` mode to verify compilation
3. Verify that `main.ts` satisfies the `chat-lib.d.ts` interface

### 10. Documentation and Examples

Generate basic documentation:
- `README.md` with usage examples
- API documentation extracted from TypeScript comments
- Examples showing how to implement required services

## Validation Steps

1. **Compilation Check**: Ensure all TypeScript files compile without errors
2. **API Compatibility**: Verify `main.ts` exports match `chat-lib.d.ts`
3. **Dependency Analysis**: Ensure no VS Code APIs leak into the public interface
4. **Import Resolution**: Verify all internal imports resolve correctly

## Usage Example

After extraction, consumers would use the library like:

```typescript
import { LineRange, Position, Observable } from '@vscode/chat-lib';

// Use the SDK with custom service implementations
const range = new LineRange(1, 10);
const position = new Position(5, 0);
```

## Deliverables

1. **`src/chat-lib.d.ts`** - Hand-written API definitions
2. **`script/build/extractChatLib.ts`** - Extraction and build script
3. **Documentation** - Updated build instructions and usage guide
4. **Generated Module** - Complete npm-ready module in `tmp-chat-lib/`

## Success Criteria

- ✅ Generated module compiles with TypeScript
- ✅ No VS Code API dependencies in public interface
- ✅ All entry point files and dependencies included
- ✅ Import paths resolve correctly within `_internal` structure
- ✅ API surface matches hand-written `.d.ts` file
- ✅ Module can be consumed as TypeScript-only SDK
