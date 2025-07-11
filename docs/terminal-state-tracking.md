# Terminal State Tracking

This document explains how terminal state tracking works in the Copilot Chat extension.

## Overview

The extension tracks terminal state to provide better context to AI conversations. This includes information about commands run, terminal output, and the current terminal environment.

## Terminal Service Methods

### `getCopilotTerminals(sessionId?: string, includeBackground?: boolean)`

Returns terminals that are explicitly managed by Copilot for a specific chat session. These are terminals created by tools like:
- `RunInTerminalTool` 
- `RunTaskTool`
- Other Copilot automation features

**Use Cases:**
- Session cleanup when a chat conversation ends
- Getting the working directory for a specific conversation
- Tracking terminals created by Copilot tools

### `getAllTerminals()`

Returns ALL terminals in the workspace, including:
- Copilot-managed terminals (with session-based IDs)
- User-created terminals (with generated IDs based on process ID)

**Use Cases:**
- Workspace state collection for AI context
- General terminal visibility and management
- Debugging and development tools

## Current Terminal State Properties

These properties work with the **active terminal** (not limited to Copilot terminals):

- `terminalBuffer` - Content from the active terminal
- `terminalLastCommand` - Last command executed in the active terminal
- `terminalSelection` - Currently selected text in the active terminal  
- `terminalShellType` - Shell type of the active terminal

## Tools

### `GetAllTerminalsTool`

Provides visibility into all open terminals in the workspace:

```
All open terminals:
1. Copilot (ID: copilot-terminal-1)
2. bash (ID: user-terminal-123)
3. PowerShell (ID: user-terminal-456)
```

### `GetTerminalSelectionTool`

Returns the currently selected text in the active terminal.

### `GetTerminalLastCommandTool`

Returns information about the last command executed in the active terminal.

## Issue Resolution

**Previous Behavior:** Only terminals created by Copilot were included in terminal state tracking.

**Current Behavior:** All terminals are now tracked through the `getAllTerminals()` method, while maintaining backwards compatibility with `getCopilotTerminals()` for session-specific operations.

This ensures that AI conversations have full visibility into the user's terminal environment, not just terminals created by Copilot itself.