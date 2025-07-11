/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { BasePromptElementProps, PromptElement } from '@vscode/prompt-tsx';
import { ITasksService } from '../../../../platform/tasks/common/tasksService';
import { ITerminalService } from '../../../../platform/terminal/common/terminalService';
import { ToolName } from '../../../tools/common/toolNames';

export interface TerminalAndTaskStateProps extends BasePromptElementProps {
	sessionId?: string;
}

/**
 * PromptElement that gets the current task and terminal state for the chat context.
 */
export class TerminalAndTaskStatePromptElement extends PromptElement<TerminalAndTaskStateProps> {
	constructor(
		props: TerminalAndTaskStateProps,
		@ITasksService private readonly tasksService: ITasksService,
		@ITerminalService private readonly terminalService: ITerminalService
	) {
		super(props);
	}
	async render() {
		const resultTasks: { name: string; isBackground: boolean; type?: string; command?: string; problemMatcher?: string; group?: { isDefault?: boolean; kind?: string }; script?: string; dependsOn?: string; isActive?: boolean }[] = [];
		const allTasks = this.tasksService.getTasks()?.[0]?.[1] ?? [];
		const tasks = Array.isArray(allTasks) ? allTasks : [];
		for (const exec of tasks.filter(t => this.tasksService.getTerminalForTask(t))) {
			if (exec.label) {
				resultTasks.push({
					name: exec.label,
					isBackground: exec.isBackground,
					type: exec?.type,
					command: exec?.command,
					script: exec.script,
					problemMatcher: Array.isArray(exec.problemMatcher) && exec.problemMatcher.length > 0 ? exec.problemMatcher.join(', ') : '',
					group: exec.group,
					dependsOn: exec.dependsOn,
					isActive: this.tasksService.isTaskActive(exec),
				});
			}
		}

		if (this.terminalService && Array.isArray(this.terminalService.terminals)) {
			const allTerminals = await this.terminalService.getAllTerminals();
			// Filter by session if specified for Copilot terminals only
			const filteredTerminals = allTerminals.filter(terminal => {
				// For Copilot terminals, filter by session if specified
				if (terminal.isCopilotTerminal && this.props.sessionId && terminal.sessionId !== this.props.sessionId) {
					return false;
				}
				return true;
			});
			const terminals = filteredTerminals.map((term) => {
				const lastCommand = this.terminalService.getLastCommandForTerminal(term);
				return {
					name: term.name,
					lastCommand,
					id: term.id,
					isCopilotTerminal: term.isCopilotTerminal || false,
				};
			});

			if (terminals.length === 0 && tasks.length === 0) {
				return 'No tasks or terminals found.';
			}

			const renderTasks = () =>
				resultTasks.length > 0 && (
					<>
						Tasks:<br />
						{resultTasks.map((t) => (
							<>
								Task: {t.name} ({t.isBackground && `is background: ${String(t.isBackground)}`}
								{t.isActive ? ', is running' : 'is inactive'}
								{t.type ? `, type: ${t.type}` : ''}
								{t.command ? `, command: ${t.command}` : ''}
								{t.script ? `, script: ${t.script}` : ''}
								{t.problemMatcher ? `Problem Matchers: ${t.problemMatcher}` : ''}
								{t.group?.kind ? `Group: ${t.group.isDefault ? 'isDefault ' + t.group.kind : t.group.kind} ` : ''}
								{t.dependsOn ? `Depends On: ${t.dependsOn}` : ''})
								<br />
							</>
						))}
					</>
				);

			const renderTerminals = () =>
				terminals.length > 0 && (
					<>
						Active Terminals:<br />
						{terminals.map((term) => (
							<>
								Terminal: {term.name} {term.isCopilotTerminal ? '(Created by Copilot)' : '(Created by User)'}<br />
								{term.lastCommand ? (
									<>
										Last Command: {term.lastCommand.commandLine ?? '(no last command)'}<br />
										Cwd: {term.lastCommand.cwd ?? '(unknown)'}<br />
										Exit Code: {term.lastCommand.exitCode ?? '(unknown)'}<br />
									</>
								) : ''}
								Output: {'{'}Use {ToolName.GetTerminalOutput} for terminal with ID: {term.id}.{'}'}<br />
							</>
						))}
					</>
				);

			return (
				<>
					{tasks.length > 0 ? renderTasks() : 'Tasks: No tasks found.'}
					{terminals.length > 0 ? renderTerminals() : 'Terminals: No active terminals found.'}
				</>
			);
		}
	}
}