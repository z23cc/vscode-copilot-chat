/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as crypto from 'crypto';
import * as http from 'http';
import * as vscode from 'vscode';

interface ServerRequest {
	nonce: string;
	modelId?: string;
	vendor?: string;
	family?: string;
	messages: Msg[];
	options?: vscode.LanguageModelChatRequestOptions;
}
interface Msg {
	role: 'user' | 'assistant' | 'system';
	content: string;
	name?: string;
}
export interface ServerTextLineResponse {
	type: 'text';
	content: string;
}
export interface ServerToolCallResponse {
	type: 'tool_call';
	callId: string;
	name: string;
	input: object;
}

interface ServerConfig {
	port: number;
	nonce: string;
}

// Anthropic API types
type AnthropicAPIUserMessageContent = (
	{ type: 'text'; text: string; cache_control?: { type: 'ephemeral' | 'persistent' } }
	| { type: 'tool_result'; content: string; tool_use_id: string; is_error: boolean; cache_control?: { type: 'ephemeral' | 'persistent' } }
);
interface AnthropicAPIUserMessage {
	role: 'user';
	content: string | Array<AnthropicAPIUserMessageContent>;
}
type AnthropicAPIAssistantMessageContent = (
	{ type: 'text'; text: string; cache_control?: { type: 'ephemeral' | 'persistent' } }
	| { type: 'tool_use'; id: string; name: string; input: Record<string, unknown>; cache_control?: { type: 'ephemeral' | 'persistent' } }
);
interface AnthropicAPIAssistantMessage {
	role: 'assistant';
	content: string | Array<AnthropicAPIAssistantMessageContent>;
}
interface AnthropicAPISystemMessage {
	role: 'system';
	content: string | Array<{ type: 'text'; text: string }>;
}
type AnthropicAPIMessage = AnthropicAPIUserMessage | AnthropicAPIAssistantMessage | AnthropicAPISystemMessage;
interface AnthropicAPIMessagesRequest {
	max_tokens?: number;
	messages: Array<AnthropicAPIMessage>;
	metadata?: Record<string, unknown>;
	model?: string;
	stream?: boolean;
	system?: Array<{ type: 'text'; text: string }>;
	temperature?: number;
	tools?: Array<{
		description: string;
		name: string;
		input_schema?: Record<string, unknown>;
	}>;
}

interface MessageStartResponseDataLine {
	type: 'message_start';
	message: {
		id: string;
		type: 'message';
		role: string;
		model: string;
		content: Array<{ type: string; text: string }>;
		stop_reason: string | null;
		stop_sequence: string | null;
		usage: {
			input_tokens: number;
			cache_creation_input_tokens: number;
			cache_read_input_tokens: number;
			output_tokens: number;
			service_tier: string;
		};
	};
}

interface ContentBlockStartResponseDataLine {
	type: 'content_block_start';
	index: number;
	content_block:
	{ type: 'text'; text: string }
	| { type: 'tool_use'; id: string; name: string; input: object };
}

interface ContentBlockDeltaResponseDataLine {
	type: 'content_block_delta';
	index: number;
	delta:
	{ type: string; text: string }
	| { type: "input_json_delta"; partial_json: string };
}

interface ContentBlockStopResponseDataLine {
	type: 'content_block_stop';
	index: number;
}

interface MessageDeltaResponseDataLine {
	type: 'message_delta';
	delta: { stop_reason: string | null; stop_sequence: string | null };
	usage: { output_tokens: number };
}

interface MessageStopResponseDataLine {
	type: 'message_stop';
}

type AnthropicAPIMessagesStreamingResponseDataLine =
	| MessageStartResponseDataLine
	| ContentBlockStartResponseDataLine
	| ContentBlockDeltaResponseDataLine
	| ContentBlockStopResponseDataLine
	| MessageDeltaResponseDataLine
	| MessageStopResponseDataLine;

class LanguageModelServer {
	private server: http.Server;
	private config: ServerConfig;

	constructor() {
		this.config = {
			port: 8001, // Will be set to random available port
			nonce: crypto.randomUUID()
		};
		this.server = this.createServer();
	}

	private createServer(): http.Server {
		return http.createServer(async (req, res) => {
			console.log(`Received request: ${req.method} ${req.url}`);

			// Set CORS headers
			res.setHeader('Access-Control-Allow-Origin', '*');
			res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
			res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Nonce');

			if (req.method === 'OPTIONS') {
				res.writeHead(200);
				res.end();
				return;
			}

			if (req.method === 'GET' && req.url === '/models') {
				await this.handleModelsRequest(req, res);
				return;
			}

			if (req.method === 'POST' && req.url?.startsWith('/v1/chat/completions')) {
				res.setHeader('Content-Type', 'application/json');
				try {
					const body = await this.readRequestBody(req);
					const request: ServerRequest = JSON.parse(body);

					// Verify nonce
					if (request.nonce !== this.config.nonce) {
						res.writeHead(401, { 'Content-Type': 'application/json' });
						res.end(JSON.stringify({ error: 'Invalid nonce' }));
						return;
					}

					await this.handleChatRequest(request, res);
				} catch (error) {
					res.writeHead(500, { 'Content-Type': 'application/json' });
					res.end(JSON.stringify({
						error: 'Internal server error',
						details: error instanceof Error ? error.message : String(error)
					}));
				}
				return;
			}

			if (req.method === 'POST' && req.url === '/anthropic-chat') {
				try {
					const body = await this.readRequestBody(req);
					await this.handleAnthropicChatRequest(body, res);
				} catch (error) {
					res.writeHead(500, { 'Content-Type': 'application/json' });
					res.end(JSON.stringify({
						error: 'Internal server error',
						details: error instanceof Error ? error.message : String(error)
					}));
				}
				return;
			}

			// Handle legacy root POST requests for backward compatibility
			if (req.method === 'POST' && req.url === '/') {
				res.setHeader('Content-Type', 'application/json');
				try {
					const body = await this.readRequestBody(req);
					const request: ServerRequest = JSON.parse(body);

					// Verify nonce
					if (request.nonce !== this.config.nonce) {
						res.writeHead(401, { 'Content-Type': 'application/json' });
						res.end(JSON.stringify({ error: 'Invalid nonce' }));
						return;
					}

					await this.handleChatRequest(request, res);
				} catch (error) {
					res.writeHead(500, { 'Content-Type': 'application/json' });
					res.end(JSON.stringify({
						error: 'Internal server error',
						details: error instanceof Error ? error.message : String(error)
					}));
				}
				return;
			}

			res.writeHead(404, { 'Content-Type': 'application/json' });
			res.end(JSON.stringify({ error: 'Not found' }));
		});
	}

	private async readRequestBody(req: http.IncomingMessage): Promise<string> {
		return new Promise((resolve, reject) => {
			let body = '';
			req.on('data', chunk => {
				body += chunk.toString();
			});
			req.on('end', () => {
				resolve(body);
			});
			req.on('error', reject);
		});
	}

	private async handleChatRequest(request: ServerRequest, res: http.ServerResponse): Promise<void> {
		try {
			// Get available language models
			const models = await vscode.lm.selectChatModels();

			if (models.length === 0) {
				res.writeHead(404, { 'Content-Type': 'application/json' });
				res.end(JSON.stringify({ error: 'No language models available' }));
				return;
			}

			// Select model based on request criteria
			let selectedModel: vscode.LanguageModelChat | undefined;

			if (request.modelId?.startsWith('claude-3-5-haiku')) {
				request.modelId = 'gpt-4o-mini';
			}
			if (request.modelId?.startsWith('claude-sonnet-4')) {
				request.modelId = 'claude-sonnet-4';
			}

			if (request.modelId) {
				selectedModel = models.find(m => m.id === request.modelId);
			} else if (request.vendor && request.family) {
				selectedModel = models.find(m => m.vendor === request.vendor && m.family === request.family);
			} else if (request.vendor) {
				selectedModel = models.find(m => m.vendor === request.vendor);
			} else if (request.family) {
				selectedModel = models.find(m => m.family === request.family);
			} else {
				// Use first available model if no criteria specified
				selectedModel = models[0];
			}

			if (!selectedModel) {
				res.writeHead(404, { 'Content-Type': 'application/json' });
				res.end(JSON.stringify({
					error: 'No model found matching criteria',
					availableModels: models.map(m => ({
						id: m.id,
						name: m.name,
						vendor: m.vendor,
						family: m.family,
						version: m.version
					}))
				}));
				return;
			}

			// Set up streaming response with JSONL format
			res.writeHead(200, {
				'Content-Type': 'application/x-ndjson',
				'Transfer-Encoding': 'chunked'
			});

			// Create cancellation token for the request
			const tokenSource = new vscode.CancellationTokenSource();

			// Handle client disconnect
			res.on('close', () => {
				tokenSource.cancel();
			});

			try {
				// Convert messages to VS Code format
				const vscodeMessages: vscode.LanguageModelChatMessage[] = request.messages
					.map(msg => {
						// Convert system messages to user role since VS Code doesn't support system messages
						return (msg.role === 'user' || msg.role === 'system')
							? vscode.LanguageModelChatMessage.User(msg.content, msg.name)
							: vscode.LanguageModelChatMessage.Assistant(msg.content, msg.name);
					});

				// Make the chat request
				const chatResponse = await selectedModel.sendRequest(
					vscodeMessages,
					request.options,
					tokenSource.token
				);

				// Stream the response - handle both text and tool call parts as JSONL
				for await (const part of chatResponse.stream) {
					if (tokenSource.token.isCancellationRequested) {
						break;
					}

					if (part instanceof vscode.LanguageModelTextPart) {
						// Stream text content as JSON line
						const textData: ServerTextLineResponse = {
							type: 'text',
							content: part.value
						};
						res.write(JSON.stringify(textData) + '\n');
					} else if (part instanceof vscode.LanguageModelToolCallPart) {
						// Stream tool call as JSON line
						const toolCallData: ServerToolCallResponse = {
							type: 'tool_call',
							callId: part.callId,
							name: part.name,
							input: part.input
						};
						res.write(JSON.stringify(toolCallData) + '\n');
					}
					// Ignore unknown part types for future compatibility
				}

				res.end();
			} catch (error) {
				if (error instanceof vscode.LanguageModelError) {
					res.write(JSON.stringify({
						error: 'Language model error',
						code: error.code,
						message: error.message,
						cause: error.cause
					}));
				} else {
					res.write(JSON.stringify({
						error: 'Request failed',
						message: error instanceof Error ? error.message : String(error)
					}));
				}
				res.end();
			} finally {
				tokenSource.dispose();
			}

		} catch (error) {
			res.writeHead(500, { 'Content-Type': 'application/json' });
			res.end(JSON.stringify({
				error: 'Failed to process chat request',
				details: error instanceof Error ? error.message : String(error)
			}));
		}
	}

	private async handleModelsRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
		try {
			// Verify nonce from X-Nonce header
			const nonce = req.headers['x-nonce'];
			if (nonce !== this.config.nonce) {
				res.writeHead(401, { 'Content-Type': 'application/json' });
				res.end(JSON.stringify({ error: 'Invalid nonce' }));
				return;
			}

			const models = await this.getAvailableModels();
			res.writeHead(200, { 'Content-Type': 'application/json' });
			res.end(JSON.stringify(models));
		} catch (error) {
			res.writeHead(500, { 'Content-Type': 'application/json' });
			res.end(JSON.stringify({
				error: 'Failed to get available models',
				details: error instanceof Error ? error.message : String(error)
			}));
		}
	}

	private async handleAnthropicChatRequest(body: string, res: http.ServerResponse): Promise<void> {
		try {
			const requestBody: AnthropicAPIMessagesRequest = JSON.parse(body);

			// Get available language models
			const models = await vscode.lm.selectChatModels();

			if (models.length === 0) {
				res.writeHead(404, { 'Content-Type': 'application/json' });
				res.end(JSON.stringify({ error: 'No language models available' }));
				return;
			}

			// Select model based on request criteria
			let selectedModel: vscode.LanguageModelChat | undefined;

			// Map Claude models to available models
			if (requestBody.model?.startsWith('claude-3-5-haiku')) {
				selectedModel = models.find(m => m.id.includes('gpt-4o-mini')) || models.find(m => m.vendor === 'copilot');
			} else if (requestBody.model?.startsWith('claude-sonnet-4')) {
				selectedModel = models.find(m => m.id.includes('claude-sonnet-4')) || models.find(m => m.vendor === 'copilot');
			} else {
				// Use first available model if no specific model requested
				selectedModel = models[0];
			}

			if (!selectedModel) {
				res.writeHead(404, { 'Content-Type': 'application/json' });
				res.end(JSON.stringify({ error: 'No suitable model found' }));
				return;
			}

			// Set up streaming response with SSE format
			res.writeHead(200, {
				'Content-Type': 'text/event-stream',
				'Cache-Control': 'no-cache',
				'Connection': 'keep-alive',
				'Access-Control-Allow-Origin': '*'
			});

			// Create cancellation token for the request
			const tokenSource = new vscode.CancellationTokenSource();

			// Handle client disconnect
			res.on('close', () => {
				tokenSource.cancel();
			});

			try {
				// Convert Anthropic messages to VS Code format
				const vscodeMessages: vscode.LanguageModelChatMessage[] = [];

				// Add system messages first
				if (requestBody.system && requestBody.system.length > 0) {
					const systemContent = requestBody.system.map(s => s.text).join('\n');
					vscodeMessages.push(vscode.LanguageModelChatMessage.User(systemContent));
				}

				// Add conversation messages
				requestBody.messages.forEach(msg => {

					if (msg.role === 'user') {
						const handleUserContent = (content: AnthropicAPIUserMessageContent) => {
							if (content.type === 'text') {
								vscodeMessages.push(vscode.LanguageModelChatMessage.User(content.text));
							} else if (content.type === 'tool_result') {
								vscodeMessages.push(vscode.LanguageModelChatMessage.User(
									[new vscode.LanguageModelToolResultPart(
										content.tool_use_id,
										[new vscode.LanguageModelTextPart(content.content)]
									)]
								));
							} else {
								throw new Error(`Unsupported user message content type: ${JSON.stringify(content)}`);
							}
						};
						if (Array.isArray(msg.content)) {
							msg.content.forEach(handleUserContent);
						} else {
							handleUserContent({ type: 'text', text: msg.content });
						}
					} else if (msg.role === 'assistant') {
						const handleAssistantContent = (content: AnthropicAPIAssistantMessageContent) => {
							if (content.type === 'text') {
								vscodeMessages.push(vscode.LanguageModelChatMessage.Assistant(content.text));
							} else if (content.type === 'tool_use') {
								const toolCall = new vscode.LanguageModelToolCallPart(
									content.id,
									content.name,
									content.input || {}
								);
								vscodeMessages.push(vscode.LanguageModelChatMessage.Assistant([toolCall]));
							} else {
								throw new Error(`Unsupported assistant message content type: ${JSON.stringify(content)}`);
							}
						};
						if (Array.isArray(msg.content)) {
							msg.content.forEach(handleAssistantContent);
						} else {
							handleAssistantContent({ type: 'text', text: msg.content });
						}
					} else if (msg.role === 'system') {
						const content = Array.isArray(msg.content)
							? msg.content.map(c => c.text).join('\n')
							: msg.content;
						vscodeMessages.push(vscode.LanguageModelChatMessage.User(content));
					}
				});

				// Prepare request options
				const options: vscode.LanguageModelChatRequestOptions = {
					justification: 'Anthropic-compatible chat request'
				};

				if (requestBody.tools && requestBody.tools.length > 0) {
					// Convert Anthropic tools to VS Code tools
					options.tools = requestBody.tools.map(tool => ({
						name: tool.name,
						description: tool.description,
						inputSchema: tool.input_schema || {}
					}));
				}

				// Generate unique IDs
				const messageId = `msg_${Math.random().toString(36).substr(2, 20)}`;

				// Helper function to send SSE events
				const sendSSEEvent = (data: AnthropicAPIMessagesStreamingResponseDataLine) => {
					const encodedData = JSON.stringify(data).replace(/\n/g, '\\n');
					res.write(`event: ${data.type}\ndata: ${encodedData}\n\n`);
					console.log(`event: ${data.type}\ndata: ${encodedData}\n\n`);
				};

				// Calculate input tokens (rough estimate)
				const inputText = vscodeMessages.map(m => m.content).join(' '); // TODO THIS IS WRONG
				const inputTokens = inputText.split(/\s+/).filter(Boolean).length;

				// Send message_start event
				const messageStart: MessageStartResponseDataLine = {
					type: 'message_start',
					message: {
						id: messageId,
						type: 'message',
						role: 'assistant',
						model: requestBody.model || selectedModel.id,
						content: [],
						stop_reason: null,
						stop_sequence: null,
						usage: {
							input_tokens: inputTokens,
							cache_creation_input_tokens: 0,
							cache_read_input_tokens: 0,
							output_tokens: 1,
							service_tier: 'vscode'
						}
					}
				};
				sendSSEEvent(messageStart);

				// Make the chat request
				const chatResponse = await selectedModel.sendRequest(
					vscodeMessages,
					options,
					tokenSource.token
				);

				let outputTokens = 0;
				let hasTextContentBlock = false;
				let currentContentBlockIndex = 0;
				let hadTool = false;

				// Stream the response
				for await (const part of chatResponse.stream) {
					if (tokenSource.token.isCancellationRequested) {
						break;
					}

					if (part instanceof vscode.LanguageModelTextPart) {
						if (!hasTextContentBlock) {
							// Send content_block_start for text
							const contentBlockStart: ContentBlockStartResponseDataLine = {
								type: 'content_block_start',
								index: currentContentBlockIndex,
								content_block: {
									type: 'text',
									text: ''
								}
							};
							sendSSEEvent(contentBlockStart);
							hasTextContentBlock = true;
						}

						// Send content_block_delta for text
						const contentDelta: ContentBlockDeltaResponseDataLine = {
							type: 'content_block_delta',
							index: currentContentBlockIndex,
							delta: {
								type: 'text_delta',
								text: part.value
							}
						};
						sendSSEEvent(contentDelta);

						// Count tokens
						outputTokens += part.value.split(/\s+/).filter(Boolean).length;

					} else if (part instanceof vscode.LanguageModelToolCallPart) {
						// End current text block if it exists
						if (hasTextContentBlock) {
							const contentBlockStop: ContentBlockStopResponseDataLine = {
								type: 'content_block_stop',
								index: currentContentBlockIndex
							};
							sendSSEEvent(contentBlockStop);
							currentContentBlockIndex++;
							hasTextContentBlock = false;
						}

						hadTool = true;

						// Send tool use block
						const toolBlockStart: ContentBlockStartResponseDataLine = {
							type: 'content_block_start',
							index: currentContentBlockIndex,
							content_block: {
								type: 'tool_use',
								id: part.callId,
								name: part.name,
								input: {},
							}
						};
						sendSSEEvent(toolBlockStart);

						// Send tool use block
						const toolBlockContent: ContentBlockDeltaResponseDataLine = {
							type: 'content_block_delta',
							index: currentContentBlockIndex,
							delta: {
								type: "input_json_delta",
								partial_json: JSON.stringify(part.input || {})
							}
						};
						sendSSEEvent(toolBlockContent);

						const toolBlockStop: ContentBlockStopResponseDataLine = {
							type: 'content_block_stop',
							index: currentContentBlockIndex
						};
						sendSSEEvent(toolBlockStop);

						currentContentBlockIndex++;
					}
				}

				// Send final events
				if (hasTextContentBlock) {
					const contentBlockStop: ContentBlockStopResponseDataLine = {
						type: 'content_block_stop',
						index: currentContentBlockIndex
					};
					sendSSEEvent(contentBlockStop);
				}

				const messageDelta: MessageDeltaResponseDataLine = {
					type: 'message_delta',
					delta: {
						stop_reason: hadTool ? 'tool_use' : 'end_turn',
						stop_sequence: null
					},
					usage: {
						output_tokens: Math.max(outputTokens, 1)
					}
				};
				sendSSEEvent(messageDelta);

				const messageStop: MessageStopResponseDataLine = {
					type: 'message_stop'
				};
				sendSSEEvent(messageStop);

				res.end();

			} catch (error) {
				if (error instanceof vscode.LanguageModelError) {
					const errorData = {
						error: 'Language model error',
						code: error.code,
						message: error.message,
						cause: error.cause
					};
					res.write(`event: error\ndata: ${JSON.stringify(errorData)}\n\n`);
				} else {
					const errorData = {
						error: 'Request failed',
						message: error instanceof Error ? error.message : String(error)
					};
					res.write(`event: error\ndata: ${JSON.stringify(errorData)}\n\n`);
				}
				res.end();
			} finally {
				tokenSource.dispose();
			}

		} catch (error) {
			res.writeHead(500, { 'Content-Type': 'application/json' });
			res.end(JSON.stringify({
				error: 'Failed to process Anthropic chat request',
				details: error instanceof Error ? error.message : String(error)
			}));
		}
	}

	public async start(): Promise<void> {
		return new Promise((resolve) => {
			this.server.listen('/tmp/foo4.sock', () => {
				const address = this.server.address();
				if (address && typeof address === 'string') {
					// this.config.port = address.port;
					console.log(`Language Model Server started on http://localhost:${this.config.port}`);
					console.log(`Server nonce: ${this.config.nonce}`);
					resolve();
				}
			});
		});
	}

	public stop(): void {
		this.server.close();
	}

	public getConfig(): ServerConfig {
		return { ...this.config };
	}

	public async getAvailableModels(): Promise<Array<{
		id: string;
		name: string;
		vendor: string;
		family: string;
		version: string;
		maxInputTokens: number;
	}>> {
		try {
			const models = await vscode.lm.selectChatModels();
			return models.map(m => ({
				id: m.id,
				name: m.name,
				vendor: m.vendor,
				family: m.family,
				version: m.version,
				maxInputTokens: m.maxInputTokens
			}));
		} catch (error) {
			console.error('Failed to get available models:', error);
			return [];
		}
	}
}

export { LanguageModelServer, ServerConfig, ServerRequest };
