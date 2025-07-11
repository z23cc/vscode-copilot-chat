/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event, ExtensionTerminalOptions, Terminal, TerminalExecutedCommand, TerminalOptions, TerminalShellExecutionEndEvent, TerminalShellIntegrationChangeEvent, Uri, window, type TerminalDataWriteEvent } from 'vscode';
import { timeout } from '../../../util/vs/base/common/async';
import { Disposable } from '../../../util/vs/base/common/lifecycle';
import { IChatSessionService } from '../../chat/common/chatSessionService';
import { IVSCodeExtensionContext } from '../../extContext/common/extensionContext';
import { IKnownTerminal, ITerminalService, ShellIntegrationQuality } from '../common/terminalService';
import { getActiveTerminalBuffer, getActiveTerminalLastCommand, getActiveTerminalSelection, getActiveTerminalShellType, getBufferForTerminal, getLastCommandForTerminal, installTerminalBufferListeners } from './terminalBufferListener';

export const TerminalSessionStorageKey = 'runInTerminalTool.sessionTerminals';
export class TerminalServiceImpl extends Disposable implements ITerminalService {

	declare readonly _serviceBrand: undefined;

	constructor(
		@IChatSessionService chatSessionService: IChatSessionService,
		@IVSCodeExtensionContext private readonly extensionContext: IVSCodeExtensionContext) {
		super();
		for (const l of installTerminalBufferListeners()) {
			this._register(l);
		}
		this._register(chatSessionService.onDidDisposeChatSession?.(async sessionId => {
			const copilotTerminals = await this.getCopilotTerminals(sessionId);
			for (const terminal of copilotTerminals) {
				terminal.dispose();
			}
		}));
		this._register(this.onDidCloseTerminal(terminal => {
			terminal.processId.then(pid => {
				if (typeof pid === 'number') {
					this.removeTerminalAssociation(pid);
				}
			});
		}));
	}

	async getToolTerminalForSession(session_id: string): Promise<{ terminal: Terminal; sessionId: string; shellIntegrationQuality: ShellIntegrationQuality } | undefined> {
		const storedTerminalAssociations: Record<number, { sessionId: string; shellIntegrationQuality: ShellIntegrationQuality; isBackground?: boolean; isCopilotTerminal?: boolean }> = this.extensionContext.workspaceState.get(TerminalSessionStorageKey, {});
		for (const terminal of this.terminals) {
			try {
				const pid = await Promise.race([terminal.processId, timeout(5000)]);
				if (typeof pid === 'number') {
					const association = storedTerminalAssociations[pid];
					if (association && association.isCopilotTerminal) {
						const { sessionId, shellIntegrationQuality, isBackground } = association;
						if (!isBackground && sessionId === session_id) {
							return { terminal, shellIntegrationQuality, sessionId };
						}
					}
				}
			} catch { }
		}
		return undefined;
	}

	get terminals(): readonly Terminal[] {
		return window.terminals;
	}

	get onDidChangeTerminalShellIntegration(): Event<TerminalShellIntegrationChangeEvent> {
		return window.onDidChangeTerminalShellIntegration;
	}

	get onDidEndTerminalShellExecution(): Event<TerminalShellExecutionEndEvent> {
		return window.onDidEndTerminalShellExecution;
	}

	get onDidCloseTerminal(): Event<Terminal> {
		return window.onDidCloseTerminal;
	}
	get onDidWriteTerminalData(): Event<TerminalDataWriteEvent> {
		return window.onDidWriteTerminalData;
	}

	createTerminal(name?: string, shellPath?: string, shellArgs?: readonly string[] | string): Terminal;
	createTerminal(options: TerminalOptions): Terminal;
	createTerminal(options: ExtensionTerminalOptions): Terminal;
	createTerminal(name?: any, shellPath?: any, shellArgs?: any): Terminal {
		const terminal = window.createTerminal(name, shellPath, shellArgs);
		return terminal;
	}

	async associateTerminalWithSession(terminal: Terminal, sessionId: string, id: string, shellIntegrationQuality: ShellIntegrationQuality, isBackground?: boolean): Promise<void> {
		try {
			const pid = await Promise.race([terminal.processId, timeout(5000)]);
			if (typeof pid === 'number') {
				const associations: Record<number, { shellIntegrationQuality: ShellIntegrationQuality; sessionId: string; id: string; isBackground?: boolean; isCopilotTerminal: boolean }> = this.extensionContext.workspaceState.get(TerminalSessionStorageKey, {});
				const existingAssociation = associations[pid] || {};
				associations[pid] = {
					...existingAssociation,
					sessionId,
					shellIntegrationQuality,
					id,
					isBackground,
					isCopilotTerminal: true
				};

				await this.extensionContext.workspaceState.update(TerminalSessionStorageKey, associations);
			}
		} catch { }
	}

	async getCopilotTerminals(sessionId?: string, includeBackground?: boolean): Promise<IKnownTerminal[]> {
		const allTerminals = await this.getAllTerminals();
		const storedTerminalAssociations: Record<number, { sessionId?: string; shellIntegrationQuality?: ShellIntegrationQuality; id?: string; isBackground?: boolean; isCopilotTerminal?: boolean }> = this.extensionContext.workspaceState.get(TerminalSessionStorageKey, {});
		
		const copilotTerminals: IKnownTerminal[] = [];
		
		for (const terminal of allTerminals) {
			try {
				const pid = await Promise.race([terminal.processId, timeout(5000)]);
				if (typeof pid === 'number') {
					const association = storedTerminalAssociations[pid];
					if (association && association.isCopilotTerminal) {
						// Filter by session if specified
						if (sessionId && association.sessionId !== sessionId) {
							continue;
						}
						// Filter by background flag if specified
						if (!includeBackground && association.isBackground) {
							continue;
						}
						copilotTerminals.push(terminal);
					}
				}
			} catch { }
		}
		
		return copilotTerminals;
	}

	async getAllTerminals(): Promise<IKnownTerminal[]> {
		const terminals: IKnownTerminal[] = [];
		const storedTerminalAssociations: Record<number, { sessionId?: string; shellIntegrationQuality?: ShellIntegrationQuality; id?: string; isBackground?: boolean; isCopilotTerminal?: boolean }> = this.extensionContext.workspaceState.get(TerminalSessionStorageKey, {});

		// Track all terminals, ensuring they're stored in workspace state
		for (const terminal of this.terminals) {
			try {
				const pid = await Promise.race([terminal.processId, timeout(5000)]);
				if (typeof pid === 'number') {
					let association = storedTerminalAssociations[pid];
					if (!association) {
						// This is a user-created terminal that hasn't been tracked yet
						association = {
							id: `user-terminal-${pid}`,
							isCopilotTerminal: false
						};
						storedTerminalAssociations[pid] = association;
					}
					terminals.push({ ...terminal, id: association.id! });
				}
			} catch {
				// If we can't get the process ID, still include the terminal with a fallback ID
				const fallbackId = `terminal-${terminal.name || 'unknown'}-${Date.now()}`;
				terminals.push({ ...terminal, id: fallbackId });
			}
		}

		// Update workspace state to include any newly tracked user terminals
		await this.extensionContext.workspaceState.update(TerminalSessionStorageKey, storedTerminalAssociations);
		
		return terminals;
	}

	async removeTerminalAssociation(pid: number): Promise<void> {
		const storedTerminalAssociations: Record<number, { sessionId?: string; shellIntegrationQuality?: ShellIntegrationQuality; id?: string; isBackground?: boolean; isCopilotTerminal?: boolean }> = this.extensionContext.workspaceState.get(TerminalSessionStorageKey, {});
		for (const processId in storedTerminalAssociations) {
			if (pid === Number(processId)) {
				delete storedTerminalAssociations[processId];
			}
		}
		await this.extensionContext.workspaceState.update(TerminalSessionStorageKey, storedTerminalAssociations);
	}

	async getCwdForSession(sessionId: string): Promise<Uri | undefined> {
		const copilotTerminals = await this.getCopilotTerminals(sessionId);
		const activeTerminal = window.activeTerminal;
		if (activeTerminal) {
			// Check if the active terminal is one we created
			for (const terminal of copilotTerminals) {
				if (terminal === activeTerminal) {
					return terminal.shellIntegration?.cwd;
				}
			}
		}
		if (copilotTerminals.length === 1) {
			return copilotTerminals[0]?.shellIntegration?.cwd;
		}
	}

	getBufferForTerminal(terminal: Terminal, maxChars?: number): string {
		return getBufferForTerminal(terminal, maxChars);
	}

	getLastCommandForTerminal(terminal: Terminal): TerminalExecutedCommand | undefined {
		return getLastCommandForTerminal(terminal);
	}

	get terminalBuffer(): string {
		return getActiveTerminalBuffer();
	}

	get terminalLastCommand(): TerminalExecutedCommand | undefined {
		return getActiveTerminalLastCommand();
	}

	get terminalSelection(): string {
		return getActiveTerminalSelection();
	}

	get terminalShellType(): string {
		return getActiveTerminalShellType();
	}
}