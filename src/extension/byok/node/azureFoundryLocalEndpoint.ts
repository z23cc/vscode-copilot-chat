/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Raw } from '@vscode/prompt-tsx';
import type { CancellationToken } from 'vscode';
import { IAuthenticationService } from '../../../platform/authentication/common/authentication';
import { IChatMLFetcher, IntentParams, Source } from '../../../platform/chat/common/chatMLFetcher';
import { ChatFetchResponseType, ChatLocation, ChatResponse } from '../../../platform/chat/common/commonTypes';
import { IDomainService } from '../../../platform/endpoint/common/domainService';
import { IChatModelInformation } from '../../../platform/endpoint/common/endpointProvider';
import { ChatEndpoint } from '../../../platform/endpoint/node/chatEndpoint';
import { IEnvService } from '../../../platform/env/common/envService';
import { FinishedCallback, OptionalChatRequestParams } from '../../../platform/networking/common/fetch';
import { IFetcherService } from '../../../platform/networking/common/fetcherService';
import { IChatEndpoint, IEndpointBody } from '../../../platform/networking/common/networking';
import { ITelemetryService, TelemetryProperties } from '../../../platform/telemetry/common/telemetry';
import { IThinkingDataService } from '../../../platform/thinking/node/thinkingDataService';
import { ITokenizerProvider } from '../../../platform/tokenizer/node/tokenizer';
import { IInstantiationService } from '../../../util/vs/platform/instantiation/common/instantiation';

function hydrateBYOKErrorMessages(response: ChatResponse): ChatResponse {
	if (response.type === ChatFetchResponseType.Failed && response.streamError) {
		return {
			type: response.type,
			requestId: response.requestId,
			serverRequestId: response.serverRequestId,
			reason: JSON.stringify(response.streamError),
		};
	} else if (response.type === ChatFetchResponseType.RateLimited) {
		return {
			type: response.type,
			requestId: response.requestId,
			serverRequestId: response.serverRequestId,
			reason: response.capiError ? 'Rate limit exceeded\n\n' + JSON.stringify(response.capiError) : 'Rate limit exceeded',
			rateLimitKey: '',
			retryAfter: undefined,
			capiError: response.capiError
		};
	}
	return response;
}

/**
 * Custom endpoint for Azure Foundry Local that handles its specific streaming format
 * and ensures the stream parameter is correctly set.
 */
export class AzureFoundryLocalEndpoint extends ChatEndpoint {
	constructor(
		private readonly _modelInfo: IChatModelInformation,
		private readonly _apiKey: string,
		private readonly _modelUrl: string,
		@IFetcherService fetcherService: IFetcherService,
		@IDomainService domainService: IDomainService,
		@IEnvService envService: IEnvService,
		@ITelemetryService telemetryService: ITelemetryService,
		@IAuthenticationService authService: IAuthenticationService,
		@IChatMLFetcher chatMLFetcher: IChatMLFetcher,
		@ITokenizerProvider tokenizerProvider: ITokenizerProvider,
		@IInstantiationService private instantiationService: IInstantiationService,
		@IThinkingDataService thinkingDataService: IThinkingDataService
	) {
		super(
			_modelInfo,
			domainService,
			{ capiClientService: null } as any, // BYOK doesn't use CAPI
			fetcherService,
			envService,
			telemetryService,
			authService,
			chatMLFetcher,
			tokenizerProvider,
			instantiationService,
			thinkingDataService
		);
	}
	override interceptBody(body: IEndpointBody | undefined): void {
		super.interceptBody(body);

		if (body?.tools?.length === 0) {
			delete body.tools;
		}

		if (body) {
			// Removing max tokens defaults to the maximum which is what we want for BYOK
			delete body.max_tokens;

			// Temporarily disable streaming to test basic functionality
			body.stream = false;

			// Remove stream options when not streaming
			delete body['stream_options'];
		}
	}

	override get urlOrRequestMetadata(): string {
		return this._modelUrl;
	}
	getExtraHeaders(): Record<string, string> {
		const headers: Record<string, string> = {
			"Content-Type": "application/json",
			"Accept": "application/json"  // Changed from text/event-stream since we're not streaming
		};

		// Azure Foundry Local typically doesn't require authentication
		// but we'll include it just in case
		if (this._apiKey) {
			headers['Authorization'] = `Bearer ${this._apiKey}`;
		}

		return headers;
	}

	override async acceptChatPolicy(): Promise<boolean> {
		return true;
	}

	override cloneWithTokenOverride(modelMaxPromptTokens: number): IChatEndpoint {
		const newModelInfo = { ...this._modelInfo, maxInputTokens: modelMaxPromptTokens };
		return this.instantiationService.createInstance(AzureFoundryLocalEndpoint, newModelInfo, this._apiKey, this._modelUrl);
	}

	override async makeChatRequest(
		debugName: string,
		messages: Raw.ChatMessage[],
		finishedCb: FinishedCallback | undefined,
		token: CancellationToken,
		location: ChatLocation,
		source?: Source,
		requestOptions?: Omit<OptionalChatRequestParams, 'n'>,
		userInitiatedRequest?: boolean,
		telemetryProperties?: TelemetryProperties,
		intentParams?: IntentParams
	): Promise<ChatResponse> {
		try {
			// Convert VS Code messages to standard OpenAI format
			const openAIMessages = messages.map(msg => {
				console.log('Processing message:', JSON.stringify(msg, null, 2));

				// Handle different message types that VS Code might send
				if (typeof msg === 'object' && msg !== null) {
					// Cast to any to access properties safely
					const msgAny = msg as any;

					// Extract role and content from VS Code message format
					let role: string = 'user';
					let content: string = '';

					// Try different possible structures
					if (msgAny.role !== undefined && msgAny.content !== undefined) {
						role = String(msgAny.role);

						// Handle different content types
						if (typeof msgAny.content === 'string') {
							content = msgAny.content;
						} else if (Array.isArray(msgAny.content)) {
							// Handle VS Code's content array format: [{"type": 1, "text": "..."}]
							content = msgAny.content.map((item: any) => {
								if (item && typeof item === 'object' && item.text) {
									return item.text;
								} else if (typeof item === 'string') {
									return item;
								} else {
									return String(item);
								}
							}).join('');
						} else if (typeof msgAny.content === 'object' && msgAny.content !== null) {
							// If content is an object, try to extract text
							if (msgAny.content.text) {
								content = msgAny.content.text;
							} else if (msgAny.content.value) {
								content = msgAny.content.value;
							} else {
								content = JSON.stringify(msgAny.content);
							}
						} else {
							content = String(msgAny.content);
						}

						// Convert numeric role to string role
						if (role === '0') {
							role = 'system';
						} else if (role === '1') {
							role = 'user';
						} else if (role === '2') {
							role = 'assistant';
						}
					} else if (msgAny.role && msgAny.parts) {
						// Handle multi-part messages
						role = String(msgAny.role);
						if (Array.isArray(msgAny.parts)) {
							content = msgAny.parts.map((part: any) => {
								if (typeof part === 'string') {
									return part;
								} else if (part.text) {
									return part.text;
								} else if (part.value) {
									return part.value;
								} else {
									return String(part);
								}
							}).join('');
						} else {
							content = String(msgAny.parts);
						}
					} else if (msgAny.text) {
						content = String(msgAny.text);
					} else if (msgAny.value) {
						content = String(msgAny.value);
					} else {
						// Last resort - try to find any text-like property
						const possibleContentKeys = ['content', 'text', 'value', 'message'];
						for (const key of possibleContentKeys) {
							if (msgAny[key] && typeof msgAny[key] === 'string') {
								content = msgAny[key];
								break;
							}
						}
						if (!content) {
							// If all else fails, stringify but try to make it readable
							content = JSON.stringify(msgAny);
						}
					}

					// Ensure role is a valid OpenAI role
					const validRoles = ['system', 'user', 'assistant'];
					if (!validRoles.includes(role)) {
						role = 'user'; // Default to user if unknown role
					}

					// Clean up content to avoid JSON issues
					content = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

					// Truncate very long content to avoid issues
					if (content.length > 2000) {
						content = content.substring(0, 2000) + '... [truncated for debugging]';
						console.log('Content truncated due to length');
					}

					const result = {
						role: role,
						content: content
					};

					console.log('Converted message:', JSON.stringify(result, null, 2));
					return result;
				} else {
					// Handle string messages
					const result = {
						role: 'user',
						content: String(msg)
					};
					console.log('String message converted:', JSON.stringify(result, null, 2));
					return result;
				}
			});

			// Build the request body
			const body: any = {
				messages: openAIMessages,  // Use converted messages
				model: this._modelInfo.id,
				stream: true,
				stream_options: { include_usage: true }
			};

			// Add any additional request options
			if (requestOptions?.temperature !== undefined) {
				body.temperature = requestOptions.temperature;
			}
			if (requestOptions?.top_p !== undefined) {
				body.top_p = requestOptions.top_p;
			}

			// Apply body modifications
			this.interceptBody(body);

			// Log the exact request details for debugging
			const headers = this.getExtraHeaders();
			const requestBody = JSON.stringify(body);

			console.log('Azure Foundry Local Request Details:');
			console.log(`URL: ${this._modelUrl}`);
			console.log(`Method: POST`);
			console.log(`Headers:`, headers);
			console.log(`Body:`, requestBody);

			// Log curl command for easy testing (with simpler approach)
			const curlHeaders = Object.entries(headers)
				.map(([key, value]) => `-H "${key}: ${value}"`)
				.join(' ');

			console.log(`Equivalent curl command:`);
			console.log(`curl -X POST ${this._modelUrl} ${curlHeaders} \\`);
			console.log(`  -d '${requestBody.replace(/'/g, "'\"'\"'")}'`);

			// Also show a simple test command
			console.log(`\nSimple test command:`);
			console.log(`curl -X POST ${this._modelUrl} -H "Content-Type: application/json" -H "Accept: application/json" -d '{"messages":[{"role":"user","content":"Hello"}],"model":"${this._modelInfo.id}","stream":false}'`);

			// Create AbortSignal from CancellationToken
			const abortController = new AbortController();
			token.onCancellationRequested(() => abortController.abort());

			const response = await fetch(this._modelUrl, {
				method: 'POST',
				headers: headers,
				body: requestBody,
				signal: abortController.signal,
				// Add timeout and keep-alive settings
				keepalive: false
			});

			console.log(`Response status: ${response.status} ${response.statusText}`);
			console.log(`Response headers:`, Object.fromEntries(response.headers.entries()));

			if (!response.ok) {
				// Try to get response body for 500 errors
				let responseText = '';
				try {
					responseText = await response.text();
					console.log(`Response body: ${responseText}`);
				} catch (e) {
					console.log('Could not read response body');
				}

				return {
					type: ChatFetchResponseType.Failed,
					requestId: 'azure-foundry-local-request',
					serverRequestId: response.headers.get('x-request-id') || 'unknown',
					reason: `HTTP ${response.status}: ${response.statusText}${responseText ? '\nResponse: ' + responseText : ''}`
				};
			}

			// Handle non-streaming response
			console.log('Processing non-streaming response...');
			const responseData = await response.json() as any;
			console.log('Response data:', JSON.stringify(responseData, null, 2));

			// Extract the message content from the response
			let messageText = '';
			if (responseData.choices && responseData.choices[0] && responseData.choices[0].message) {
				messageText = responseData.choices[0].message.content || '';
			}

			console.log('Extracted message:', messageText);

			// Call finished callback
			if (finishedCb) {
				await finishedCb(messageText, 0, { text: messageText, copilotToolCalls: [] });
			}

			return {
				type: ChatFetchResponseType.Success,
				requestId: 'azure-foundry-local-request',
				serverRequestId: response.headers.get('x-request-id') || 'unknown',
				value: messageText,
				usage: responseData.usage || {
					prompt_tokens: 0,
					completion_tokens: 0,
					total_tokens: 0,
					prompt_tokens_details: { cached_tokens: 0 }
				}
			};

		} catch (error: any) {
			return hydrateBYOKErrorMessages({
				type: ChatFetchResponseType.Failed,
				requestId: 'azure-foundry-local-request',
				serverRequestId: 'unknown',
				reason: error.message || 'Unknown error',
				streamError: error
			});
		}
	}
}