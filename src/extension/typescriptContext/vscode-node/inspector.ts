/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

import type { ContextItem, SnippetContext, TraitContext } from '../../../platform/languageServer/common/languageContextService';
import * as protocol from '../common/serverProtocol';
import { ContextItemResultBuilder, type CachePopulatedEvent, type IInternalLanguageContextService, type ResolvedRunnableResult } from './types';

class TreePropertyItem {

	private readonly parent: TreeContextItem | TreeYieldedContextItem | TreeCacheInfo;
	private readonly name: string;
	private readonly value: string;

	constructor(parent: TreeContextItem | TreeYieldedContextItem | TreeCacheInfo, name: string, value: string) {
		this.parent = parent;
		this.name = name;
		this.value = value;
	}

	public toTreeItem(): vscode.TreeItem {
		const item = new vscode.TreeItem(`${this.name} = ${this.value}`, vscode.TreeItemCollapsibleState.None);
		item.tooltip = this.createTooltip();
		item.id = this.id;
		return item;
	}

	protected createTooltip(): vscode.MarkdownString {
		const markdown = new vscode.MarkdownString(`${this.value}`);
		return markdown;
	}

	private get id(): string | undefined {
		return this.parent instanceof TreeContextItem ? `${this.parent.id}.${this.name}` : undefined;
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
		const markdown = new vscode.MarkdownString(`**${this.getLabel()}**\n\n`);
		markdown.appendCodeblock(JSON.stringify(this.from, undefined, 2), 'json');
		return markdown;
	}

	protected abstract getLabel(): string;
}

class TreeTrait extends TreeContextItem {

	public readonly from: protocol.Trait;

	constructor(parent: TreeRunnableResult, from: protocol.Trait) {
		super(parent);
		this.from = from;
	}

	protected getLabel(): string {
		return 'Trait';
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
		const label = `Trait: ${this.from.value}`;
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

	protected getLabel(): string {
		return 'Snippet';
	}

	public get id(): string {
		return `${this.parent.id}.${this.from.key ?? Date.now().toString()}`;
	}

	public children(): TreePropertyItem[] {
		const properties: TreePropertyItem[] = [];
		properties.push(new TreePropertyItem(this, 'key', this.from.key ?? 'undefined'));
		properties.push(new TreePropertyItem(this, 'value', this.from.value));
		properties.push(new TreePropertyItem(this, 'priority', this.from.priority.toString()));
		properties.push(new TreePropertyItem(this, 'path', this.from.fileName));
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


class TreeCacheInfo {

	private readonly from: protocol.CacheInfo;

	constructor(from: protocol.CacheInfo) {
		this.from = from;
	}

	public toTreeItem(): vscode.TreeItem {
		const item = new vscode.TreeItem(this.getLabel());
		item.collapsibleState = this.from.scope.kind === protocol.CacheScopeKind.OutsideRange || this.from.scope.kind === protocol.CacheScopeKind.WithinRange ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None;
		return item;
	}

	public children(): TreePropertyItem[] {
		const properties: TreePropertyItem[] = [];
		const scope = this.from.scope;
		if (scope.kind === protocol.CacheScopeKind.WithinRange) {
			properties.push(new TreePropertyItem(this, 'range', this.getRangeString(scope.range)));
		} else if (scope.kind === protocol.CacheScopeKind.OutsideRange) {
			for (let i = 0; i < scope.ranges.length; i++) {
				properties.push(new TreePropertyItem(this, `${i}`, this.getRangeString(scope.ranges[i])));
			}
		}
		return properties;
	}

	private getLabel(): string {
		return `Cache Info: ${this.getEmitMode()} - ${this.getScope()}`;
	}

	private getEmitMode(): string {
		switch (this.from.emitMode) {
			case protocol.EmitMode.ClientBased:
				return 'Client Based';
			case protocol.EmitMode.ClientBasedOnTimeout:
				return 'On Timeout';
			default:
				return 'Unknown';
		}
	}

	private getScope(): string {
		switch (this.from.scope.kind) {
			case protocol.CacheScopeKind.File:
				return 'whole file';
			case protocol.CacheScopeKind.NeighborFiles:
				return 'neighbor files';
			case protocol.CacheScopeKind.OutsideRange:
				return 'outside ranges';
			case protocol.CacheScopeKind.WithinRange:
				return 'within range';
			default:
				return 'unknown scope';
		}
	}

	private getRangeString(range: protocol.Range): string {
		return `[${range.start.line + 1}:${range.start.character + 1} - ${range.end.line + 1}:${range.end.character + 1}]`;
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

	public children(): (TreeTrait | TreeSnippet | TreeCacheInfo)[] {
		const result: (TreeTrait | TreeSnippet | TreeCacheInfo)[] = this.items;
		if (this.from.cache !== undefined) {
			result.push(new TreeCacheInfo(this.from.cache));
		}
		return result;
	}

	public toTreeItem(): vscode.TreeItem {
		let id = this.from.id;
		if (id.startsWith('_')) {
			id = id.substring(1); // Remove leading underscore for display purposes
		}
		const cacheInfo = this.from.cache !== undefined ? 1 : 0;
		const item = new vscode.TreeItem(`${id} - ${this.items.length} items`, this.items.length + cacheInfo > 0 ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None);
		item.id = this.from.id;
		item.tooltip = this.createTooltip();
		return item;

	}

	private createTooltip(): vscode.MarkdownString {
		let id = this.from.id;
		if (id.startsWith('_')) {
			id = id.substring(1);
		}
		const markdown = new vscode.MarkdownString(`**${id}** - ${this.items.length} items\n\n`);
		markdown.appendCodeblock(JSON.stringify(this.from, undefined, 2), 'json');
		return markdown;
	}
}

class TreeYieldedSnippet {

	protected readonly from: SnippetContext;

	constructor(from: SnippetContext) {
		this.from = from;
	}

	public toTreeItem(): vscode.TreeItem {
		const item = new vscode.TreeItem(`${this.getLabel()}: ${this.from.value}`, vscode.TreeItemCollapsibleState.Collapsed);
		item.tooltip = this.createTooltip();
		return item;
	}

	protected getLabel(): string {
		return 'Snippet';
	}

	public children(): TreePropertyItem[] {
		return [
			new TreePropertyItem(this, 'kind', this.from.kind),
			new TreePropertyItem(this, 'value', this.from.value),
			new TreePropertyItem(this, 'priority', this.from.priority.toString()),
			new TreePropertyItem(this, 'uri', this.from.uri.toString())
		];
	}

	protected createTooltip(): vscode.MarkdownString {
		const markdown = new vscode.MarkdownString(`**${this.getLabel()}**\n\n`);
		const json = {
			kind: this.from.kind,
			priority: this.from.priority,
			uri: this.from.uri.toString(),
			value: this.from.value
		};
		markdown.appendCodeblock(JSON.stringify(json, undefined, 2), 'json');
		return markdown;
	}
}

class TreeYieldedTrait {

	protected readonly from: TraitContext;

	constructor(from: TraitContext) {
		this.from = from;
	}

	public toTreeItem(): vscode.TreeItem {
		const item = new vscode.TreeItem(`${this.getLabel()}: ${this.from.value}`, vscode.TreeItemCollapsibleState.Collapsed);
		item.tooltip = this.createTooltip();
		return item;
	}

	protected getLabel(): string {
		return 'Trait';
	}

	public children(): TreePropertyItem[] {
		return [
			new TreePropertyItem(this, 'kind', this.from.kind),
			new TreePropertyItem(this, 'name', this.from.name),
			new TreePropertyItem(this, 'value', this.from.value),
			new TreePropertyItem(this, 'priority', this.from.priority.toString())
		];
	}

	protected createTooltip(): vscode.MarkdownString {
		const markdown = new vscode.MarkdownString(`**${this.getLabel()}**\n\n`);
		const json = {
			kind: this.from.kind,
			priority: this.from.priority,
			name: this.from.name,
			value: this.from.value
		};
		markdown.appendCodeblock(JSON.stringify(json, undefined, 2), 'json');
		return markdown;
	}
}

type TreeYieldedContextItem = TreeYieldedSnippet | TreeYieldedTrait;

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

	public children(): TreeYieldedContextItem[] {
		const children: TreeYieldedContextItem[] = [];
		for (const item of this.items) {
			if (item.kind === protocol.ContextKind.Snippet) {
				children.push(new TreeYieldedSnippet(item as SnippetContext));
			} else if (item.kind === protocol.ContextKind.Trait) {
				children.push(new TreeYieldedTrait(item as TraitContext));
			}
		}
		return children;
	}

	public toTreeItem(): vscode.TreeItem {
		const label = `Yielded: ${this.items.length} from ${this.contextItemSummary.stats.total} items`;
		const item = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.Collapsed);
		return item;
	}
}

type InspectorItems = TreeRunnableResult | TreeTrait | TreeSnippet | TreePropertyItem | TreeYielded | TreeYieldedSnippet | TreeYieldedTrait | TreeCacheInfo;
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
		} else if (
			element instanceof TreeRunnableResult || element instanceof TreeTrait || element instanceof TreeSnippet || element instanceof TreeYielded ||
			element instanceof TreeYieldedSnippet || element instanceof TreeYieldedTrait || element instanceof TreeCacheInfo) {

			return element.children();
		}
		return [];
	}
}