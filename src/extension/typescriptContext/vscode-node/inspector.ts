/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

import type { ContextItem } from '../../../platform/languageServer/common/languageContextService';
import * as protocol from '../common/serverProtocol';
import { ContextItemResultBuilder, type CachePopulatedEvent, type IInternalLanguageContextService, type ResolvedRunnableResult } from './types';

class TreePropertyItem {

	private readonly parent: TreeContextItem;
	private readonly name: string;
	private readonly value: string;

	constructor(parent: TreeContextItem, name: string, value: string) {
		this.parent = parent;
		this.name = name;
		this.value = value;
	}

	public get id(): string {
		return `${this.parent.id}.${this.name}`;
	}

	toTreeItem(): vscode.TreeItem {
		const item = new vscode.TreeItem(`${this.name} = ${this.value}`, vscode.TreeItemCollapsibleState.None);
		item.tooltip = this.createTooltip();
		item.id = this.id;
		return item;
	}

	protected createTooltip(): vscode.MarkdownString {
		const markdown = new vscode.MarkdownString(`this.value`);
		return markdown;
	}
}

abstract class TreeContextItem {

	protected parent: TreeRunnableResult;
	protected abstract from: protocol.FullContextItem;
	public abstract id: string;

	constructor(parent: TreeRunnableResult) {
		this.parent = parent;
	}

	protected createTooltip(): vscode.MarkdownString {
		const markdown = new vscode.MarkdownString(`**Context Item:** ${this.from.kind}\n\n`);
		markdown.appendCodeblock(JSON.stringify(this.from, undefined, 2), 'json');
		return markdown;
	}
}

class TreeTrait extends TreeContextItem {

	public readonly from: protocol.Trait;

	constructor(parent: TreeRunnableResult, from: protocol.Trait) {
		super(parent);
		this.from = from;
	}

	public get id(): string {
		return `${this.parent.id}.${this.from.key}`;
	}

	public children(): TreePropertyItem[] {
		const properties: TreePropertyItem[] = [];
		properties.push(new TreePropertyItem(this, 'key', this.from.key));
		properties.push(new TreePropertyItem(this, 'name', this.from.name));
		properties.push(new TreePropertyItem(this, 'value', this.from.value));
		properties.push(new TreePropertyItem(this, 'priority', this.from.priority.toString()));
		return properties;
	}

	public toTreeItem(): vscode.TreeItem {
		const label = `Trait}: ${this.from.value}`;
		const item = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.Collapsed);
		item.tooltip = this.createTooltip();
		item.id = this.id;
		return item;
	}
}

class TreeSnippet extends TreeContextItem {

	public readonly from: protocol.CodeSnippet;

	constructor(parent: TreeRunnableResult, from: protocol.CodeSnippet) {
		super(parent);
		this.from = from;
	}

	public get id(): string {
		return `${this.parent.id}.${this.from.key ?? Date.now().toString()}`;
	}

	public children(): TreePropertyItem[] {
		const properties: TreePropertyItem[] = [];
		properties.push(new TreePropertyItem(this, 'key', this.from.key ?? 'undefined'));
		properties.push(new TreePropertyItem(this, 'value', this.from.value));
		properties.push(new TreePropertyItem(this, 'priority', this.from.priority.toString()));
		return properties;
	}

	public toTreeItem(): vscode.TreeItem {
		const label = `Snippet: ${this.from.value}`;
		const item = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.Collapsed);
		item.tooltip = this.createTooltip();
		item.id = this.id;
		return item;
	}
}


class TreeRunnableResult {

	private from: ResolvedRunnableResult;
	private items: (TreeTrait | TreeSnippet)[];

	constructor(from: ResolvedRunnableResult) {
		this.from = from;
		this.items = from.items.map(item => {
			if (item.kind === protocol.ContextKind.Trait) {
				return new TreeTrait(this, item);
			} else if (item.kind === protocol.ContextKind.Snippet) {
				return new TreeSnippet(this, item);
			} else {
				throw new Error(`Unknown context item kind: ${item.kind}`);
			}
		});
	}

	public get id(): string {
		return this.from.id;
	}

	public children(): (TreeTrait | TreeSnippet)[] {
		return this.items;
	}

	public toTreeItem(): vscode.TreeItem {
		let id = this.from.id;
		if (id.startsWith('_')) {
			id = id.substring(1); // Remove leading underscore for display purposes
		}
		const item = new vscode.TreeItem(`${id} - ${this.items.length} items`, this.items.length > 0 ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None);
		item.id = this.from.id;
		item.tooltip = this.createHover();
		return item;

	}

	private createHover(): vscode.MarkdownString {
		let id = this.from.id;
		if (id.startsWith('_')) {
			id = id.substring(1);
		}
		const markdown = new vscode.MarkdownString(`**${id}** - ${this.items.length} items\n\n`);
		markdown.appendCodeblock(JSON.stringify(this.from, undefined, 2), 'json');
		return markdown;
	}
}

class TreeYielded {

	private readonly items: ContextItem[];
	private readonly contextItemSummary: ContextItemResultBuilder;

	constructor(runnables: ResolvedRunnableResult[]) {
		const items: ContextItem[] = [];
		this.contextItemSummary = new ContextItemResultBuilder();
		for (const runnable of runnables) {
			for (const converted of this.contextItemSummary.update(runnable)) {
				items.push(converted);
			}
		}
		this.items = items;
	}

	toTreeItem(): vscode.TreeItem {
		const label = `Yielded: ${this.items.length} from ${this.contextItemSummary.stats.total} items`;
		const item = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.None);
		item.collapsibleState = vscode.TreeItemCollapsibleState.None;
		return item;
	}
}

type InspectorItems = TreeRunnableResult | TreeTrait | TreeSnippet | TreePropertyItem | TreeYielded;
export class InspectorDataProvider implements vscode.TreeDataProvider<InspectorItems> {

	private readonly languageContextService: IInternalLanguageContextService;

	private readonly _onDidChangeTreeData: vscode.EventEmitter<InspectorItems | InspectorItems[] | undefined | null | void>;
	public readonly onDidChangeTreeData: vscode.Event<InspectorItems | InspectorItems[] | undefined | null | void>;

	private current: CachePopulatedEvent | undefined;

	constructor(languageContextService: IInternalLanguageContextService) {
		this.languageContextService = languageContextService;
		this._onDidChangeTreeData = new vscode.EventEmitter<InspectorItems | InspectorItems[] | undefined | null | void>();
		this.onDidChangeTreeData = this._onDidChangeTreeData.event;
		this.languageContextService.onCachePopulated((data) => {
			// This event is fired when the cache is populated with context items.
			// We can use this to refresh the tree view.
			this.current = data;
			this._onDidChangeTreeData.fire(undefined);
		});
		this.current = undefined;
	}

	getTreeItem(element: InspectorItems): vscode.TreeItem | Thenable<vscode.TreeItem> {
		return element.toTreeItem();
	}

	async getChildren(element?: InspectorItems | undefined): Promise<InspectorItems[]> {
		if (this.current === undefined) {
			return [];
		}

		if (element === undefined) {
			try {
				const result: InspectorItems[] = [];
				for (const item of this.current.results) {
					const runnableResult = new TreeRunnableResult(item);
					result.push(runnableResult);
				}
				result.push(new TreeYielded(this.current.results));
				return result;
			} catch (error) {
				return [];
			}
		} else if (element instanceof TreeRunnableResult || element instanceof TreeTrait || element instanceof TreeSnippet) {
			return element.children();
		}
		return [];
	}
}