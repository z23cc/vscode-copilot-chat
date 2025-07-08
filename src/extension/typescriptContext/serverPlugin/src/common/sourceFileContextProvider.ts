/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import type tt from 'typescript/lib/tsserverlibrary';
import TS from './typescript';
const ts = TS();

import { ImportsRunnable, TypeOfExpressionRunnable, TypeOfLocalsRunnable, TypesOfNeighborFilesRunnable } from './baseContextProviders';
import { CodeSnippetBuilder } from './code';
import { AbstractContextRunnable, ComputeCost, ContextProvider, ContextResult, type ComputeContextSession, type ContextRunnableCollector, type ProviderComputeContext, type RequestContext, type RunnableResult } from './contextProvider';
import { EmitMode, Priorities, SpeculativeKind, type CacheInfo, type CacheScope } from './protocol';
import tss, { Symbols, type TokenInfo } from './typescripts';


export type SymbolsInScope = {
	functions: {
		real: tt.Symbol[];
		aliased: { alias: tt.Symbol; real: tt.Symbol }[];
	};
	modules: { alias: tt.Symbol; real: tt.Symbol }[];
};

export class GlobalsRunnable extends AbstractContextRunnable {

	private readonly tokenInfo: TokenInfo;
	private readonly symbolsToQuery: tt.SymbolFlags;
	private readonly cacheScope: CacheScope | undefined;

	constructor(session: ComputeContextSession, languageService: tt.LanguageService, context: RequestContext, tokenInfo: TokenInfo, symbolsToQuery: tt.SymbolFlags, cacheScope?: CacheScope) {
		super(session, languageService, context, GlobalsRunnable.name, Priorities.Globals, ComputeCost.Medium);
		this.tokenInfo = tokenInfo;
		this.symbolsToQuery = symbolsToQuery;
		this.cacheScope = cacheScope;
	}

	protected override createRunnableResult(result: ContextResult): RunnableResult {
		const cacheInfo: CacheInfo | undefined = this.cacheScope !== undefined ? { emitMode: EmitMode.ClientBasedOnTimeout, scope: this.cacheScope } : undefined;
		return result.createRunnableResult(this.id, cacheInfo);
	}

	protected override run(result: RunnableResult, token: tt.CancellationToken): void {
		const program = this.getProgram();
		const symbols = this.symbols;
		const sourceFile = this.tokenInfo.token.getSourceFile();

		const inScope = this.getModulesAndFunctionsInScope(program, symbols.getTypeChecker(), sourceFile);
		token.throwIfCancellationRequested();

		// Add functions in scope
		for (const func of inScope.functions.real) {
			token.throwIfCancellationRequested();
			const [handled, key] = this.handleSymbolIfKnown(result, func);
			if (handled) {
				continue;
			}
			const snippetBuilder = new CodeSnippetBuilder(this.session, this.symbols, sourceFile);
			snippetBuilder.addFunctionSymbol(func);
			result.addSnippet(snippetBuilder, key, this.priority, SpeculativeKind.emit);
		}

		if (result.isTokenBudgetExhausted()) {
			return;
		}

		// Add aliased functions in scope
		for (const { alias, real } of inScope.functions.aliased) {
			token.throwIfCancellationRequested();

			const [handled, key] = this.handleSymbolIfKnown(result, real);
			if (handled) {
				continue;
			}
			const snippetBuilder = new CodeSnippetBuilder(this.session, this.symbols, sourceFile);
			snippetBuilder.addFunctionSymbol(real, alias.getName());
			if (!result.addSnippet(snippetBuilder, key, this.priority, SpeculativeKind.emit, true)) {
				break;
			}
		}

		if (result.isTokenBudgetExhausted()) {
			return;
		}


		// Add modules in scope
		for (const { alias, real } of inScope.modules) {
			token.throwIfCancellationRequested();

			const [handled, key] = this.handleSymbolIfKnown(result, real);
			if (handled) {
				continue;
			}
			const snippetBuilder = new CodeSnippetBuilder(this.session, this.symbols, sourceFile);
			snippetBuilder.addModuleSymbol(real, alias.getName());
			if (!result.addSnippet(snippetBuilder, key, this.priority, SpeculativeKind.emit, true)) {
				break;
			}
		}
	}

	protected getModulesAndFunctionsInScope(program: tt.Program, typeChecker: tt.TypeChecker, sourceFile: tt.SourceFile): SymbolsInScope {
		const result: SymbolsInScope = {
			functions: {
				real: [],
				aliased: []
			},
			modules: []
		};

		const location = this.tokenInfo.previous ?? this.tokenInfo.token;
		const symbols = typeChecker.getSymbolsInScope(location, this.symbolsToQuery);
		for (const symbol of symbols) {
			const declarations = symbol.declarations;
			if (declarations === undefined) {
				continue;
			}
			for (const declaration of declarations) {
				const declarationSourceFile = declaration.getSourceFile();
				if (program.isSourceFileDefaultLibrary(declarationSourceFile) || program.isSourceFileFromExternalLibrary(declarationSourceFile)) {
					continue;
				}
				if (Symbols.isFunction(symbol) && this.includeFunctions() && declarationSourceFile !== sourceFile) {
					result.functions.real.push(symbol);
					break;
				} else if (Symbols.isAlias(symbol)) {
					const aliased = typeChecker.getAliasedSymbol(symbol);
					if (Symbols.isFunction(aliased) && this.includeFunctions()) {
						result.functions.aliased.push({ alias: symbol, real: aliased });
						break;
					} else if (aliased.flags === ts.SymbolFlags.ValueModule && this.includeValueModules()) {
						// Only include pure value modules. Classes, interfaces, ... are also value modules.
						result.modules.push({ alias: symbol, real: aliased });
						break;
					}
				}
			}
		}
		return result;
	}

	private includeFunctions(): boolean {
		return (this.symbolsToQuery & ts.SymbolFlags.Function) !== 0;
	}

	private includeValueModules(): boolean {
		return (this.symbolsToQuery & ts.SymbolFlags.ValueModule) !== 0;
	}
}

export class SourceFileContextProvider extends ContextProvider {

	private readonly tokenInfo: tss.TokenInfo;
	private readonly computeInfo: ProviderComputeContext;

	public override readonly isCallableProvider: boolean;

	constructor(tokenInfo: tss.TokenInfo, computeInfo: ProviderComputeContext) {
		super(ts.SymbolFlags.Function);
		this.tokenInfo = tokenInfo;
		this.computeInfo = computeInfo;
		this.isCallableProvider = true;
	}

	public provide(result: ContextRunnableCollector, session: ComputeContextSession, languageService: tt.LanguageService, context: RequestContext, token: tt.CancellationToken): void {
		token.throwIfCancellationRequested();
		const symbolsToQuery = this.computeInfo.getSymbolsToQuery();
		const cacheScope = this.computeInfo.getCallableCacheScope();
		if (symbolsToQuery !== undefined && symbolsToQuery !== ts.SymbolFlags.None) {
			result.addSecondary(new GlobalsRunnable(session, languageService, context, this.tokenInfo, symbolsToQuery, cacheScope));
		}
		if (!this.computeInfo.isFirstCallableProvider(this)) {
			return;
		}
		result.addPrimary(new TypeOfLocalsRunnable(session, languageService, context, this.tokenInfo, new Set(), undefined));
		const runnable = TypeOfExpressionRunnable.create(session, languageService, context, this.tokenInfo, token);
		if (runnable !== undefined) {
			result.addPrimary(runnable);
		}
		result.addSecondary(new ImportsRunnable(session, languageService, context, this.tokenInfo, new Set(), undefined));
		if (context.neighborFiles.length > 0) {
			result.addTertiary(new TypesOfNeighborFilesRunnable(session, languageService, context, this.tokenInfo));
		}
	}
}