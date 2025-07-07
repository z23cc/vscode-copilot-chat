/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import type tt from 'typescript/lib/tsserverlibrary';
import TS from './typescript';
const ts = TS();

import { CodeSnippetBuilder } from './code';
import {
	AbstractContextRunnable, CacheScopes, ComputeCost, ContextProvider, type ComputeContextSession,
	type ContextResult,
	type ContextRunnableCollector,
	type ProviderComputeContext, type RequestContext, type RunnableResult, type SymbolEmitData
} from './contextProvider';
import {
	CacheScopeKind, EmitMode, Priorities, SpeculativeKind, Trait, TraitKind, type CacheInfo, type CacheScope,
	type ContextItemKey
} from './protocol';
import tss, { Symbols } from './typescripts';

export class CompilerOptionsRunnable extends AbstractContextRunnable {

	public static VersionTraitKey: string = Trait.createContextItemKey(TraitKind.Version);

	// Traits to collect from the compiler options in the format of [trait kind, trait description, priority, context key, CompilerOptions.enumType (if applicable)]
	public static traitsToCollect: [TraitKind, string, number, ContextItemKey, any][] = [
		[TraitKind.Module, 'The TypeScript module system used in this project is ', Priorities.Traits, Trait.createContextItemKey(TraitKind.Module), ts.ModuleKind],
		[TraitKind.ModuleResolution, 'The TypeScript module resolution strategy used in this project is ', Priorities.Traits, Trait.createContextItemKey(TraitKind.ModuleResolution), ts.ModuleResolutionKind],
		[TraitKind.Target, 'The target version of JavaScript for this project is ', Priorities.Traits, Trait.createContextItemKey(TraitKind.Target), ts.ScriptTarget],
		[TraitKind.Lib, 'Library files that should be included in TypeScript compilation are ', Priorities.Traits, Trait.createContextItemKey(TraitKind.Lib), undefined],
	];

	constructor(session: ComputeContextSession, languageService: tt.LanguageService, context: RequestContext) {
		super(session, languageService, context, CompilerOptionsRunnable.name, Priorities.Traits, ComputeCost.Low);
	}

	protected override createRunnableResult(result: ContextResult): RunnableResult {
		const cacheInfo: CacheInfo = { emitMode: EmitMode.ClientBased, scope: { kind: CacheScopeKind.File } };
		return result.createRunnableResult(this.id, cacheInfo);
	}

	protected override run(result: RunnableResult, _token: tt.CancellationToken): void {
		const compilerOptions = this.getProgram().getCompilerOptions();
		if (!result.addFromKnownItems(CompilerOptionsRunnable.VersionTraitKey)) {
			result.addTrait(TraitKind.Version, Priorities.Traits, 'The TypeScript version used in this project is ', ts.version);
		}
		for (const [traitKind, trait, priority, key, enumType,] of CompilerOptionsRunnable.traitsToCollect) {
			if (result.addFromKnownItems(key)) {
				continue;
			}
			let traitValue = compilerOptions[traitKind as keyof tt.CompilerOptions];
			if (traitValue) {
				if (typeof traitValue === "number") {
					const enumName = CompilerOptionsRunnable.getEnumName(enumType, traitValue);
					if (enumName) {
						traitValue = enumName;
					}
				}
				result.addTrait(traitKind, priority, trait, traitValue.toString());
			}
		}
	}

	private static getEnumName(enumObj: any, value: any): string | undefined {
		return Object.keys(enumObj).find(key => enumObj[key] === value);
	}
}

export abstract class FunctionLikeContextRunnable<T extends tt.FunctionLikeDeclarationBase = tt.FunctionLikeDeclarationBase> extends AbstractContextRunnable {

	protected readonly declaration: T;
	protected readonly sourceFile: tt.SourceFile;

	constructor(session: ComputeContextSession, languageService: tt.LanguageService, context: RequestContext, id: string, declaration: T, priority: number, cost: ComputeCost) {
		super(session, languageService, context, id, priority, cost);
		this.declaration = declaration;
		this.sourceFile = declaration.getSourceFile();
	}


	protected getCacheScope(): CacheScope | undefined {
		const body = this.declaration.body;
		if (body === undefined || !ts.isBlock(body)) {
			return undefined;
		}
		return super.createCacheScope(body, this.sourceFile);
	}
}

export class SignatureRunnable extends FunctionLikeContextRunnable {

	constructor(session: ComputeContextSession, languageService: tt.LanguageService, context: RequestContext, declaration: tt.FunctionLikeDeclarationBase, priority: number = Priorities.Locals) {
		super(session, languageService, context, SignatureRunnable.computeId(session, declaration), declaration, priority, ComputeCost.Low);
	}

	protected override createRunnableResult(result: ContextResult): RunnableResult {
		const scope = this.getCacheScope();
		const cacheInfo: CacheInfo | undefined = scope !== undefined ? { emitMode: EmitMode.ClientBased, scope } : undefined;
		return result.createRunnableResult(this.id, cacheInfo);
	}

	protected override run(result: RunnableResult, token: tt.CancellationToken): void {
		const parameters = this.declaration.parameters;
		for (let i = 0; i < parameters.length; i++) {
			token.throwIfCancellationRequested();
			const parameter = this.declaration.parameters[i];
			const type = parameter.type;
			if (type === undefined) {
				continue;
			}
			this.processType(result, type);
		}
		const returnType = this.declaration.type;
		if (returnType !== undefined) {
			token.throwIfCancellationRequested();
			this.processType(result, returnType);
		}
	}

	private processType(result: RunnableResult, type: tt.TypeNode): void {
		const symbolsToEmit = this.getSymbolsToEmitForTypeNode(type);
		if (symbolsToEmit.length === 0) {
			return;
		}
		for (const symbolEmitData of symbolsToEmit) {
			const symbol = symbolEmitData.symbol;
			const [handled, key] = this.handleSymbolIfKnown(result, symbol);
			if (handled) {
				continue;
			}
			const snippetBuilder = new CodeSnippetBuilder(this.session, this.symbols, this.sourceFile);
			snippetBuilder.addTypeSymbol(symbol, symbolEmitData.name);
			result.addSnippet(snippetBuilder, key, this.priority, SpeculativeKind.emit);
		}
	}

	private static computeId(session: ComputeContextSession, declaration: tt.FunctionLikeDeclarationBase): string {
		const host = session.host;
		const startPos = declaration.parameters.pos;
		const endPos = declaration.type?.end ?? declaration.parameters.end;
		if (host.isDebugging()) {
			const sourceFile = declaration.getSourceFile();
			const start = ts.getLineAndCharacterOfPosition(sourceFile, startPos);
			const end = ts.getLineAndCharacterOfPosition(sourceFile, endPos);
			return `${SignatureRunnable.name}:${declaration.getSourceFile().fileName}:[${start.line},${start.character},${end.line},${end.character}]`;
		} else {
			const hash = session.host.createHash('md5'); // CodeQL [SM04514] The 'md5' algorithm is used to compute a shorter string to represent a symbol in a map. It has no security implications.
			const sourceFile = declaration.getSourceFile();
			hash.update(sourceFile.fileName);
			hash.update(`[${startPos},${endPos}]`);
			return `${SignatureRunnable.name}:${hash.digest('base64')}`;
		}
	}
}

export class TypeOfLocalsRunnable extends AbstractContextRunnable {

	private readonly tokenInfo: tss.TokenInfo;
	private readonly excludes: Set<tt.Symbol>;
	private readonly cacheScope: CacheScope | undefined;
	private runnableResult: RunnableResult | undefined;


	constructor(session: ComputeContextSession, languageService: tt.LanguageService, context: RequestContext, tokenInfo: tss.TokenInfo, excludes: Set<tt.Symbol>, cacheScope: CacheScope | undefined, priority: number = Priorities.Locals) {
		super(session, languageService, context, TypeOfLocalsRunnable.name, priority, ComputeCost.Medium);
		this.tokenInfo = tokenInfo;
		this.excludes = excludes;
		this.cacheScope = cacheScope;
		this.runnableResult = undefined;
	}

	protected override createRunnableResult(result: ContextResult): RunnableResult {
		const cacheInfo: CacheInfo | undefined = this.cacheScope !== undefined ? { emitMode: EmitMode.ClientBasedOnTimeout, scope: this.cacheScope } : undefined;
		this.runnableResult = result.createRunnableResult(this.id, cacheInfo);
		return this.runnableResult;
	}

	protected override run(result: RunnableResult, cancellationToken: tt.CancellationToken): void {
		const token = this.tokenInfo.previous ?? this.tokenInfo.token ?? this.tokenInfo.touching;
		const symbols = this.symbols;
		const typeChecker = symbols.getTypeChecker();
		const inScope = typeChecker.getSymbolsInScope(token, ts.SymbolFlags.BlockScopedVariable);
		if (inScope.length === 0) {
			return;
		}
		const sourceFile = token.getSourceFile();
		let variableDeclarations: Set<tt.VariableDeclarationList> | undefined = this.cacheScope === undefined ? new Set() : undefined;
		// The symbols are block scope variables. We try to find the type of the variable
		// to include it in the context.
		for (const symbol of inScope) {
			cancellationToken.throwIfCancellationRequested();
			if (this.excludes.has(symbol)) {
				continue;
			}
			const symbolSourceFile = Symbols.getPrimarySourceFile(symbol);
			// If the symbol is not defined in the current source file we skip it. It would otherwise
			// pollute with too many types from the global scope from other files.
			if (symbolSourceFile !== sourceFile || this.skipSourceFile(symbolSourceFile)) {
				continue;
			}
			const declaration: tt.VariableDeclaration | undefined = Symbols.getDeclaration(symbol, ts.SyntaxKind.VariableDeclaration);
			if (declaration === undefined) {
				continue;
			}
			let symbolsToEmit: SymbolEmitData[] | undefined = undefined;
			if (declaration.type !== undefined) {
				symbolsToEmit = this.getSymbolsToEmitForTypeNode(declaration.type);
			} else {
				const type = typeChecker.getTypeAtLocation(declaration.type ?? declaration);
				if (type !== undefined) {
					symbolsToEmit = this.getSymbolsToEmitForType(type);
				}
			}
			if (symbolsToEmit === undefined || symbolsToEmit.length === 0) {
				continue;
			}
			for (const symbolEmitData of symbolsToEmit) {
				cancellationToken.throwIfCancellationRequested();
				const symbol = symbolEmitData.symbol;
				const [handled, key] = this.handleSymbolIfKnown(result, symbol);
				if (handled) {
					continue;
				}
				const snippetBuilder = new CodeSnippetBuilder(this.session, this.symbols, sourceFile);
				snippetBuilder.addTypeSymbol(symbol, symbolEmitData.name);
				result.addSnippet(snippetBuilder, key, this.priority, SpeculativeKind.emit);
			}

			if (variableDeclarations !== undefined) {
				variableDeclarations = this.addScopeNode(variableDeclarations, symbol, ts.SyntaxKind.VariableDeclarationList, sourceFile);
			}
		}
		if (variableDeclarations !== undefined && variableDeclarations.size > 0 && this.runnableResult !== undefined) {
			this.runnableResult.setCacheInfo({ emitMode: EmitMode.ClientBasedOnTimeout, scope: CacheScopes.createOutsideCacheScope(variableDeclarations, sourceFile) });
		}
	}
}

export class TypesOfNeighborFilesRunnable extends AbstractContextRunnable {

	private readonly tokenInfo: tss.TokenInfo;

	constructor(session: ComputeContextSession, languageService: tt.LanguageService, context: RequestContext, tokenInfo: tss.TokenInfo, priority: number = Priorities.NeighborFiles) {
		super(session, languageService, context, TypesOfNeighborFilesRunnable.name, priority, ComputeCost.Medium);
		this.tokenInfo = tokenInfo;
	}

	protected override createRunnableResult(result: ContextResult): RunnableResult {
		const cacheInfo: CacheInfo = { emitMode: EmitMode.ClientBased, scope: { kind: CacheScopeKind.NeighborFiles } };
		return result.createRunnableResult(this.id, cacheInfo);
	}

	protected override run(result: RunnableResult, cancellationToken: tt.CancellationToken): void {
		const symbols = this.symbols;
		const token = this.tokenInfo.previous ?? this.tokenInfo.token ?? this.tokenInfo.touching;
		const sourceFile = token.getSourceFile();
		for (const neighborFile of this.context.neighborFiles) {
			cancellationToken.throwIfCancellationRequested();
			if (result.isTokenBudgetExhausted()) {
				return;
			}
			const neighborSourceFile = this.getProgram().getSourceFile(neighborFile);
			if (neighborSourceFile === undefined || this.skipSourceFile(neighborSourceFile)) {
				continue;
			}
			const sourceFileSymbol = symbols.getLeafSymbolAtLocation(neighborSourceFile);
			// The neighbor file might have been seen when importing a value module
			if (sourceFileSymbol === undefined) {
				continue;
			}
			if (sourceFileSymbol.exports !== undefined) {
				for (const member of sourceFileSymbol.exports) {
					cancellationToken.throwIfCancellationRequested();
					const memberSymbol = member[1];
					if ((memberSymbol.flags & (ts.SymbolFlags.Class | ts.SymbolFlags.Interface | ts.SymbolFlags.TypeAlias | ts.SymbolFlags.Enum | ts.SymbolFlags.Function)) === 0) {
						continue;
					}
					const [handled, key] = this.handleSymbolIfKnown(result, memberSymbol);
					if (handled) {
						continue;
					}

					const snippetBuilder = new CodeSnippetBuilder(this.session, this.symbols, sourceFile);
					snippetBuilder.addTypeSymbol(memberSymbol, member[0] as string);
					if (!result.addSnippet(snippetBuilder, key, Priorities.NeighborFiles, SpeculativeKind.emit, true)) {
						return;
					}
				}
			}
		}
	}
}

export class TypeOfImportsRunnable extends AbstractContextRunnable {

	private readonly tokenInfo: tss.TokenInfo;
	private readonly excludes: Set<tt.Symbol>;
	private readonly defaultCacheScope: CacheScope | undefined;
	private runnableResult: RunnableResult | undefined;

	constructor(session: ComputeContextSession, languageService: tt.LanguageService, context: RequestContext, tokenInfo: tss.TokenInfo, excludes: Set<tt.Symbol>, cacheScope: CacheScope | undefined, priority: number = Priorities.ImportedTypes) {
		super(session, languageService, context, TypeOfImportsRunnable.name, priority, ComputeCost.Medium);
		this.tokenInfo = tokenInfo;
		this.excludes = excludes;
		this.defaultCacheScope = cacheScope;
		this.runnableResult = undefined;
	}

	protected override createRunnableResult(result: ContextResult): RunnableResult {
		const cacheInfo: CacheInfo | undefined = this.defaultCacheScope !== undefined ? { emitMode: EmitMode.ClientBased, scope: this.defaultCacheScope } : undefined;
		this.runnableResult = result.createRunnableResult(this.id, cacheInfo);
		return this.runnableResult;
	}

	protected override run(result: RunnableResult, cancellationToken: tt.CancellationToken): void {
		const token = this.tokenInfo.previous ?? this.tokenInfo.token ?? this.tokenInfo.touching;
		const symbols = this.symbols;
		const typeChecker = symbols.getTypeChecker();

		// Find all symbols in scope the represent a type and the type comes from a source file
		// that should be considered for context.
		const typesInScope = typeChecker.getSymbolsInScope(token, ts.SymbolFlags.Class | ts.SymbolFlags.Interface | ts.SymbolFlags.TypeAlias | ts.SymbolFlags.Enum | ts.SymbolFlags.Alias);
		if (typesInScope.length === 0) {
			return;
		}
		const sourceFile = token.getSourceFile();
		let importDeclarations: Set<tt.ImportDeclaration> | undefined = new Set();
		for (const symbol of typesInScope) {
			cancellationToken.throwIfCancellationRequested();
			if (this.excludes.has(symbol)) {
				continue;
			}
			const symbolSourceFile = Symbols.getPrimarySourceFile(symbol);
			if (symbolSourceFile === undefined || this.skipSourceFile(symbolSourceFile)) {
				continue;
			}
			let contextSymbol: tt.Symbol | undefined = symbol;
			const name = symbol.name;
			if (Symbols.isAlias(symbol)) {
				const leaf = this.symbols.getLeafAliasedSymbol(symbol);
				if (leaf !== undefined && (leaf.flags & (ts.SymbolFlags.Class | ts.SymbolFlags.Interface | ts.SymbolFlags.TypeAlias | ts.SymbolFlags.Enum)) !== 0) {
					contextSymbol = leaf;
				} else {
					contextSymbol = undefined;
				}
			}
			if (contextSymbol === undefined || this.excludes.has(contextSymbol)) {
				continue;
			}
			if (contextSymbol !== symbol) {
				const symbolSourceFile = Symbols.getPrimarySourceFile(contextSymbol);
				if (symbolSourceFile === undefined || this.skipSourceFile(symbolSourceFile) || symbolSourceFile === sourceFile) {
					continue;
				}
			} else if (symbolSourceFile === sourceFile) {
				continue;
			}
			const [handled, key] = this.handleSymbolIfKnown(result, contextSymbol);
			if (handled) {
				continue;
			}

			const snippetBuilder = new CodeSnippetBuilder(this.session, this.symbols, sourceFile);
			snippetBuilder.addTypeSymbol(contextSymbol, name);
			const full = !result.addSnippet(snippetBuilder, key, this.priority, SpeculativeKind.emit, true);
			if (full) {
				break;
			}

			if (importDeclarations !== undefined) {
				importDeclarations = this.addScopeNode(importDeclarations, symbol, ts.SyntaxKind.ImportDeclaration, sourceFile);
			}
		}
		if (importDeclarations !== undefined && importDeclarations.size > 0 && this.runnableResult !== undefined) {
			this.runnableResult.setCacheInfo({ emitMode: EmitMode.ClientBased, scope: CacheScopes.createOutsideCacheScope(importDeclarations, sourceFile) });
		}
	}
}

export class TypeOfExpressionRunnable extends AbstractContextRunnable {

	private readonly expression: tt.Expression;

	constructor(session: ComputeContextSession, languageService: tt.LanguageService, context: RequestContext, expression: tt.Expression, priority: number = Priorities.Locals) {
		super(session, languageService, context, TypeOfExpressionRunnable.name, priority, ComputeCost.Low);
		this.expression = expression;
	}

	public static create(session: ComputeContextSession, languageService: tt.LanguageService, context: RequestContext, tokenInfo: tss.TokenInfo, _token: tt.CancellationToken): TypeOfExpressionRunnable | undefined {
		const previous = tokenInfo.previous;
		if (previous === undefined || previous.parent === undefined) {
			return;
		}
		if ((ts.isIdentifier(previous) || previous.kind === ts.SyntaxKind.DotToken) && ts.isPropertyAccessExpression(previous.parent)) {
			const identifier = this.getRightMostIdentifier(previous.parent.expression, 0);
			if (identifier !== undefined) {
				return new TypeOfExpressionRunnable(session, languageService, context, identifier);
			}
		}
		return undefined;
	}


	private static getRightMostIdentifier(node: tt.Node, count: number): tt.Identifier | undefined {
		if (count === 32) {
			return undefined;
		}
		switch (node.kind) {
			case ts.SyntaxKind.Identifier:
				return node as tt.Identifier;
			case ts.SyntaxKind.PropertyAccessExpression:
				return this.getRightMostIdentifier((node as tt.PropertyAccessExpression).name, count + 1);
			case ts.SyntaxKind.ElementAccessExpression:
				return this.getRightMostIdentifier((node as tt.ElementAccessExpression).argumentExpression, count + 1);
			case ts.SyntaxKind.CallExpression:
				return this.getRightMostIdentifier((node as tt.CallExpression).expression, count + 1);
			default:
				return undefined;
		}
	}

	protected override createRunnableResult(result: ContextResult): RunnableResult {
		return result.createRunnableResult(this.id);
	}

	protected override run(result: RunnableResult, token: tt.CancellationToken): void {
		const expSymbol = this.symbols.getLeafSymbolAtLocation(this.expression);
		if (expSymbol === undefined) {
			return;
		}
		const typeChecker = this.symbols.getTypeChecker();
		const type = typeChecker.getTypeOfSymbolAtLocation(expSymbol, this.expression);
		const signatures = type.getConstructSignatures().concat(type.getCallSignatures());
		const sourceFile = this.expression.getSourceFile();
		for (const signature of signatures) {
			token.throwIfCancellationRequested();
			const returnType = signature.getReturnType();
			const returnTypeSymbol = returnType.aliasSymbol ?? returnType.getSymbol();
			if (returnTypeSymbol === undefined) {
				continue;
			}
			const snippetBuilder = new CodeSnippetBuilder(this.session, this.symbols, sourceFile);
			snippetBuilder.addTypeSymbol(returnTypeSymbol, returnTypeSymbol.name);
			result.addSnippet(snippetBuilder, undefined, this.priority, SpeculativeKind.ignore);
		}
		const typeSymbol = type.getSymbol();
		if (typeSymbol === undefined) {
			return;
		}
		const snippetBuilder = new CodeSnippetBuilder(this.session, this.symbols, sourceFile);
		snippetBuilder.addTypeSymbol(typeSymbol, typeSymbol.name);
		result.addSnippet(snippetBuilder, undefined, this.priority, SpeculativeKind.ignore);
	}
}

export abstract class FunctionLikeContextProvider extends ContextProvider {

	protected readonly functionLikeDeclaration: tt.FunctionLikeDeclarationBase;
	protected readonly tokenInfo: tss.TokenInfo;
	protected readonly computeContext: ProviderComputeContext;

	public override readonly isCallableProvider: boolean;
	private readonly cacheScope: CacheScope | undefined;

	constructor(symbolsToQuery: tt.SymbolFlags | undefined, declaration: tt.FunctionLikeDeclarationBase, tokenInfo: tss.TokenInfo, computeContext: ProviderComputeContext) {
		super(symbolsToQuery);
		this.functionLikeDeclaration = declaration;
		this.tokenInfo = tokenInfo;
		this.computeContext = computeContext;
		this.isCallableProvider = true;
		this.cacheScope = CacheScopes.fromDeclaration(declaration);
	}

	public override getCallableCacheScope(): CacheScope | undefined {
		return this.cacheScope;
	}

	public override provide(result: ContextRunnableCollector, session: ComputeContextSession, languageService: tt.LanguageService, context: RequestContext, token: tt.CancellationToken): void {
		token.throwIfCancellationRequested();
		result.addPrimary(new SignatureRunnable(session, languageService, context, this.functionLikeDeclaration),);

		// If we already have a callable provider then we don't need to compute anything
		// around the cursor location.
		if (!this.computeContext.isFirstCallableProvider(this)) {
			return;
		}

		const excludes = this.getTypeExcludes(languageService, context);
		result.addPrimary(new TypeOfLocalsRunnable(session, languageService, context, this.tokenInfo, excludes, CacheScopes.fromDeclaration(this.functionLikeDeclaration)));
		const runnable = TypeOfExpressionRunnable.create(session, languageService, context, this.tokenInfo, token);
		if (runnable !== undefined) {
			result.addPrimary(runnable);
		}
		result.addSecondary(new TypeOfImportsRunnable(session, languageService, context, this.tokenInfo, excludes, this.cacheScope));
		if (context.neighborFiles.length > 0) {
			result.addTertiary(new TypesOfNeighborFilesRunnable(session, languageService, context, this.tokenInfo));
		}
	}

	protected abstract getTypeExcludes(languageService: tt.LanguageService, context: RequestContext): Set<tt.Symbol>;
}