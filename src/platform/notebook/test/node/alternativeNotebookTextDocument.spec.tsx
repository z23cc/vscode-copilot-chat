/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { afterAll, beforeEach, describe, expect, test } from 'vitest';
import type { NotebookDocument, NotebookDocumentContentChange, TextDocumentChangeEvent } from 'vscode';
import { ExtHostNotebookDocumentData } from '../../../../util/common/test/shims/notebookDocument';
import { DisposableStore } from '../../../../util/vs/base/common/lifecycle';
import { URI } from '../../../../util/vs/base/common/uri';
import { OffsetRange } from '../../../../util/vs/editor/common/core/ranges/offsetRange';
import { NotebookCellData, NotebookCellKind, NotebookData, NotebookRange, Range } from '../../../../vscodeTypes';
import { AlternativeNotebookTextDocument } from '../../common/alternativeNotebookTextDocument';

describe('Edit Notebook Tool', () => {
	const disposables = new DisposableStore();

	afterAll(() => {
		disposables.clear();
	});

	function createNotebook(cells: NotebookCellData[]) {
		const notebook = ExtHostNotebookDocumentData.fromNotebookData(URI.file('notebook.ipynb'), new NotebookData(cells), 'jupyter-notebook');
		const altDoc = AlternativeNotebookTextDocument.withoutMDCells(notebook.document);
		return { notebookData: notebook, notebook: notebook.document, altDoc };
	}
	describe('Alt Content', () => {
		test(`Generate Alt Content`, async () => {
			const cells = [
				new NotebookCellData(NotebookCellKind.Code, 'print("Hello World")', 'python'),
			];
			const { altDoc } = createNotebook(cells);
			expect(altDoc.getAltText()).toMatchSnapshot();
		});
		test(`No Content`, async () => {
			const { altDoc } = createNotebook([]);
			expect(altDoc.getAltText()).toMatchSnapshot();
		});
		test(`No Content without code cells`, async () => {
			const cells = [
				new NotebookCellData(NotebookCellKind.Markup, '# This is a sample notebook', 'markdown'),
			];
			const { altDoc } = createNotebook(cells);
			expect(altDoc.getAltText()).toMatchSnapshot();
		});
		test(`Exclude Markdown Cells`, async () => {
			const cells = [
				new NotebookCellData(NotebookCellKind.Markup, '# This is a sample notebook', 'markdown'),
				new NotebookCellData(NotebookCellKind.Markup, '## Header', 'markdown'),
				new NotebookCellData(NotebookCellKind.Code, 'print("Hello World")', 'python'),
				new NotebookCellData(NotebookCellKind.Markup, 'Comments', 'markdown'),
				new NotebookCellData(NotebookCellKind.Code, 'print("Foo Bar")', 'python'),
			];
			const { altDoc } = createNotebook(cells);
			expect(altDoc.getAltText()).toMatchSnapshot();
		});
		test(`EOLs`, async () => {
			const cells = [
				new NotebookCellData(NotebookCellKind.Code, 'import sys\nimport os', 'python'),
				new NotebookCellData(NotebookCellKind.Code, 'import pandas\r\nimport requests', 'python'),
				new NotebookCellData(NotebookCellKind.Code, 'print("Hello World")\r\nprint("Foo Bar")\r\nprint("Bar Baz")', 'python'),
				new NotebookCellData(NotebookCellKind.Code, 'print(sys.executable)\nprint(sys.version)', 'python'),
			];
			const { altDoc } = createNotebook(cells);
			expect(altDoc.getAltText()).toMatchSnapshot();
			expect(altDoc.getAltText()).not.toContain('\r\n'); // Ensure no CRLF, only LF
			expect(altDoc.getAltText()).toContain('\n'); // Ensure no CRLF, only LF
		});
	});
	describe('Position Mapping', () => {
		test(`All cells have same EOL`, async () => {
			const cells = [
				new NotebookCellData(NotebookCellKind.Code, 'import sys\nimport os', 'python'),
				new NotebookCellData(NotebookCellKind.Code, 'import pandas\nimport requests', 'python'),
				new NotebookCellData(NotebookCellKind.Code, 'print("Hello World")\nprint("Foo Bar")\nprint("Bar Baz")', 'python'),
				new NotebookCellData(NotebookCellKind.Code, 'print(sys.executable)\nprint(sys.version)', 'python'),
			];
			const { notebook, altDoc } = createNotebook(cells);

			expect(altDoc.getAltText(new OffsetRange(53, 59))).toBe('import');
			expect(altDoc.fromAltOffsetRange(new OffsetRange(53, 59))).toEqual([[notebook.cellAt(0), new Range(0, 0, 0, 6)]]);
			expect(altDoc.toAltOffsetRange(notebook.cellAt(0), [new Range(0, 0, 0, 6)])).toEqual([new OffsetRange(53, 59)]);

			expect(altDoc.getAltText(new OffsetRange(53, 64))).toBe('import sys\n');
			expect(altDoc.fromAltOffsetRange(new OffsetRange(53, 64))).toEqual([[notebook.cellAt(0), new Range(0, 0, 1, 0)]]);
			expect(altDoc.toAltOffsetRange(notebook.cellAt(0), [new Range(0, 0, 1, 0)])).toEqual([new OffsetRange(53, 64)]);

			expect(altDoc.getAltText(new OffsetRange(53, 74))).toBe('import sys\nimport os\n');
			expect(altDoc.fromAltOffsetRange(new OffsetRange(53, 74))).toEqual([[notebook.cellAt(0), new Range(0, 0, 1, 9)]]);
			expect(altDoc.toAltOffsetRange(notebook.cellAt(0), [new Range(0, 0, 1, 9)])).toEqual([new OffsetRange(53, 73)]);

			// Translating alt text range across cells will only return contents of one cell.
			expect(altDoc.getAltText(new OffsetRange(53, 140))).toBe('import sys\nimport os\n#%% vscode.cell [id=#VSC-bdb3864a] [language=python]\nimport pandas');
			expect(altDoc.fromAltOffsetRange(new OffsetRange(53, 140))).toEqual([[notebook.cellAt(0), new Range(0, 0, 1, 9)], [notebook.cellAt(1), new Range(0, 0, 0, 13)]]);

			expect(altDoc.getAltText(new OffsetRange(71, 73))).toBe('os');
			expect(altDoc.fromAltOffsetRange(new OffsetRange(71, 73))).toEqual([[notebook.cellAt(0), new Range(1, 7, 1, 9)]]);
			expect(altDoc.toAltOffsetRange(notebook.cellAt(0), [new Range(1, 7, 1, 9)])).toEqual([new OffsetRange(71, 73)]);

			expect(altDoc.getAltText(new OffsetRange(134, 258))).toBe('pandas\nimport requests\n#%% vscode.cell [id=#VSC-8862d4f3] [language=python]\nprint("Hello World")\nprint("Foo Bar")\nprint("Bar');
			expect(altDoc.fromAltOffsetRange(new OffsetRange(134, 258))).toEqual([
				[notebook.cellAt(1), new Range(0, 7, 1, 15)],
				[notebook.cellAt(2), new Range(0, 0, 2, 10)],
			]);

			expect(altDoc.getAltText(new OffsetRange(134, 156))).toBe('pandas\nimport requests');
			expect(notebook.cellAt(1).document.getText(new Range(0, 7, 1, 15))).toBe('pandas\nimport requests');
			expect(altDoc.toAltOffsetRange(notebook.cellAt(1), [new Range(0, 7, 1, 15)])).toEqual([new OffsetRange(134, 156)]);
			expect(altDoc.getAltText(new OffsetRange(210, 258))).toBe('print("Hello World")\nprint("Foo Bar")\nprint("Bar');
			expect(notebook.cellAt(2).document.getText(new Range(0, 0, 2, 10))).toBe('print("Hello World")\nprint("Foo Bar")\nprint("Bar');
			expect(altDoc.toAltOffsetRange(notebook.cellAt(2), [new Range(0, 0, 2, 10)])).toEqual([new OffsetRange(210, 258)]);

			expect(altDoc.getAltText(new OffsetRange(210, 265))).toBe('print("Hello World")\nprint("Foo Bar")\nprint("Bar Baz")\n');
			expect(altDoc.fromAltOffsetRange(new OffsetRange(210, 265))).toEqual([[notebook.cellAt(2), new Range(0, 0, 2, 16)]]);
			expect(altDoc.toAltOffsetRange(notebook.cellAt(2), [new Range(0, 0, 2, 16)])).toEqual([new OffsetRange(210, 264)]);

			expect(altDoc.getAltText(new OffsetRange(318, 358))).toBe('print(sys.executable)\nprint(sys.version)');
			expect(altDoc.fromAltOffsetRange(new OffsetRange(318, 358))).toEqual([[notebook.cellAt(3), new Range(0, 0, 1, 18)]]);
			expect(altDoc.toAltOffsetRange(notebook.cellAt(3), [new Range(0, 0, 1, 18)])).toEqual([new OffsetRange(318, 358)]);

			expect(altDoc.getAltText(new OffsetRange(60, 349))).toBe('sys\nimport os\n#%% vscode.cell [id=#VSC-bdb3864a] [language=python]\nimport pandas\nimport requests\n#%% vscode.cell [id=#VSC-8862d4f3] [language=python]\nprint("Hello World")\nprint("Foo Bar")\nprint("Bar Baz")\n#%% vscode.cell [id=#VSC-e07487cb] [language=python]\nprint(sys.executable)\nprint(sys');
			expect(altDoc.fromAltOffsetRange(new OffsetRange(60, 349))).toEqual([
				[notebook.cellAt(0), new Range(0, 7, 1, 9)],
				[notebook.cellAt(1), new Range(0, 0, 1, 15)],
				[notebook.cellAt(2), new Range(0, 0, 2, 16)],
				[notebook.cellAt(3), new Range(0, 0, 1, 9)]
			]);
		});
		test(`All Cells have different EOLs`, async () => {
			const cells = [
				new NotebookCellData(NotebookCellKind.Code, 'import sys\nimport os', 'python'),
				new NotebookCellData(NotebookCellKind.Code, 'import pandas\r\nimport requests', 'python'),
				new NotebookCellData(NotebookCellKind.Code, 'print("Hello World")\r\nprint("Foo Bar")\r\nprint("Bar Baz")', 'python'),
				new NotebookCellData(NotebookCellKind.Code, 'print(sys.executable)\nprint(sys.version)', 'python'),
			];
			const { notebook, altDoc } = createNotebook(cells);


			expect(altDoc.getAltText(new OffsetRange(53, 59))).toBe('import');
			expect(altDoc.fromAltOffsetRange(new OffsetRange(53, 59))).toEqual([[notebook.cellAt(0), new Range(0, 0, 0, 6)]]);
			expect(altDoc.toAltOffsetRange(notebook.cellAt(0), [new Range(0, 0, 0, 6)])).toEqual([new OffsetRange(53, 59)]);

			expect(altDoc.getAltText(new OffsetRange(53, 64))).toBe('import sys\n');
			expect(altDoc.fromAltOffsetRange(new OffsetRange(53, 64))).toEqual([[notebook.cellAt(0), new Range(0, 0, 1, 0)]]);
			expect(altDoc.toAltOffsetRange(notebook.cellAt(0), [new Range(0, 0, 1, 0)])).toEqual([new OffsetRange(53, 64)]);

			expect(altDoc.getAltText(new OffsetRange(53, 74))).toBe('import sys\nimport os\n');
			expect(altDoc.fromAltOffsetRange(new OffsetRange(53, 74))).toEqual([[notebook.cellAt(0), new Range(0, 0, 1, 9)]]);
			expect(altDoc.toAltOffsetRange(notebook.cellAt(0), [new Range(0, 0, 1, 9)])).toEqual([new OffsetRange(53, 73)]);

			// Translating alt text range across cells will only return contents of one cell.
			expect(altDoc.getAltText(new OffsetRange(53, 140))).toBe('import sys\nimport os\n#%% vscode.cell [id=#VSC-bdb3864a] [language=python]\nimport pandas');
			expect(altDoc.fromAltOffsetRange(new OffsetRange(53, 140))).toEqual([[notebook.cellAt(0), new Range(0, 0, 1, 9)], [notebook.cellAt(1), new Range(0, 0, 0, 13)]]);

			expect(altDoc.getAltText(new OffsetRange(71, 73))).toBe('os');
			expect(altDoc.fromAltOffsetRange(new OffsetRange(71, 73))).toEqual([[notebook.cellAt(0), new Range(1, 7, 1, 9)]]);
			expect(altDoc.toAltOffsetRange(notebook.cellAt(0), [new Range(1, 7, 1, 9)])).toEqual([new OffsetRange(71, 73)]);

			expect(altDoc.getAltText(new OffsetRange(134, 258))).toBe('pandas\nimport requests\n#%% vscode.cell [id=#VSC-8862d4f3] [language=python]\nprint("Hello World")\nprint("Foo Bar")\nprint("Bar');
			expect(altDoc.fromAltOffsetRange(new OffsetRange(134, 258))).toEqual([
				[notebook.cellAt(1), new Range(0, 7, 1, 15)],
				[notebook.cellAt(2), new Range(0, 0, 2, 10)],
			]);

			expect(altDoc.getAltText(new OffsetRange(134, 156))).toBe('pandas\nimport requests');
			expect(notebook.cellAt(1).document.getText(new Range(0, 7, 1, 15))).toBe('pandas\r\nimport requests');
			expect(altDoc.toAltOffsetRange(notebook.cellAt(1), [new Range(0, 7, 1, 15)])).toEqual([new OffsetRange(134, 156)]);
			expect(altDoc.getAltText(new OffsetRange(210, 258))).toBe('print("Hello World")\nprint("Foo Bar")\nprint("Bar');
			expect(notebook.cellAt(2).document.getText(new Range(0, 0, 2, 10))).toBe('print("Hello World")\r\nprint("Foo Bar")\r\nprint("Bar');
			expect(altDoc.toAltOffsetRange(notebook.cellAt(2), [new Range(0, 0, 2, 10)])).toEqual([new OffsetRange(210, 258)]);

			expect(altDoc.getAltText(new OffsetRange(210, 265))).toBe('print("Hello World")\nprint("Foo Bar")\nprint("Bar Baz")\n');
			expect(altDoc.fromAltOffsetRange(new OffsetRange(210, 265))).toEqual([[notebook.cellAt(2), new Range(0, 0, 2, 16)]]);
			expect(altDoc.toAltOffsetRange(notebook.cellAt(2), [new Range(0, 0, 2, 16)])).toEqual([new OffsetRange(210, 264)]);

			expect(altDoc.getAltText(new OffsetRange(318, 358))).toBe('print(sys.executable)\nprint(sys.version)');
			expect(altDoc.fromAltOffsetRange(new OffsetRange(318, 358))).toEqual([[notebook.cellAt(3), new Range(0, 0, 1, 18)]]);
			expect(altDoc.toAltOffsetRange(notebook.cellAt(3), [new Range(0, 0, 1, 18)])).toEqual([new OffsetRange(318, 358)]);

			expect(altDoc.getAltText(new OffsetRange(60, 349))).toBe('sys\nimport os\n#%% vscode.cell [id=#VSC-bdb3864a] [language=python]\nimport pandas\nimport requests\n#%% vscode.cell [id=#VSC-8862d4f3] [language=python]\nprint("Hello World")\nprint("Foo Bar")\nprint("Bar Baz")\n#%% vscode.cell [id=#VSC-e07487cb] [language=python]\nprint(sys.executable)\nprint(sys');
			expect(altDoc.fromAltOffsetRange(new OffsetRange(60, 349))).toEqual([
				[notebook.cellAt(0), new Range(0, 7, 1, 9)],
				[notebook.cellAt(1), new Range(0, 0, 1, 15)],
				[notebook.cellAt(2), new Range(0, 0, 2, 16)],
				[notebook.cellAt(3), new Range(0, 0, 1, 9)]
			]);

		});
	});
	describe('Cell Content Changes', () => {
		describe('Cell with 1 line', () => {
			const cells = [
				new NotebookCellData(NotebookCellKind.Code, 'print("Hello World")', 'python'),
			];
			let altDoc: AlternativeNotebookTextDocument;
			let notebook: NotebookDocument;
			beforeEach(() => {
				({ altDoc, notebook } = createNotebook(cells));
			});
			function getUpdatedAltText(e: TextDocumentChangeEvent): string {
				const [newDoc, edit] = altDoc.withCellChangesAndEdit(e.document, e.contentChanges);
				const updatedAltText = newDoc.getAltText();

				// Verify the alt text is updated correctly
				expect(updatedAltText).toBe(edit!.apply(altDoc.getAltText()));

				return updatedAltText;
			}
			test(`replace line`, async () => {
				expect(getUpdatedAltText({
					document: notebook.cellAt(0).document,
					reason: undefined,
					detailedReason: {
						source: 'cursor',
						metadata: {}
					},
					contentChanges: [{
						range: new Range(0, 0, 0, 20),
						rangeOffset: 0,
						rangeLength: 20,
						text: '# Top level imports',
					}]
				})).toMatchSnapshot();
			});
			test(`replace text with smaller text`, async () => {
				expect(getUpdatedAltText({
					document: notebook.cellAt(0).document,
					reason: undefined,
					detailedReason: {
						source: 'cursor',
						metadata: {}
					},
					contentChanges: [{
						range: new Range(0, 7, 0, 18),
						rangeOffset: 7,
						rangeLength: 11,
						text: 'Foo Bar',
					}]
				})).toMatchSnapshot();
			});
			test(`replace text with larger text`, async () => {
				expect(getUpdatedAltText({
					document: notebook.cellAt(0).document,
					reason: undefined,
					detailedReason: {
						source: 'cursor',
						metadata: {}
					},
					contentChanges: [{
						range: new Range(0, 7, 0, 18),
						rangeOffset: 7,
						rangeLength: 11,
						text: 'This is a longer piece of text',
					}]
				})).toMatchSnapshot();
			});
			test(`replace while inserting a few lines`, async () => {
				expect(getUpdatedAltText({
					document: notebook.cellAt(0).document,
					reason: undefined,
					detailedReason: {
						source: 'cursor',
						metadata: {}
					},
					contentChanges: [{
						range: new Range(0, 7, 0, 20),
						rangeOffset: 7,
						rangeLength: 13,
						text: 'Foo Bar")\nprint("Another line")\nprint("Yet another line")',
					}]
				})).toMatchSnapshot();
			});
			test(`insert a few lines`, async () => {
				expect(getUpdatedAltText({
					document: notebook.cellAt(0).document,
					reason: undefined,
					detailedReason: {
						source: 'cursor',
						metadata: {}
					},
					contentChanges: [{
						range: new Range(0, 20, 0, 20),
						rangeOffset: 20,
						rangeLength: 0,
						text: '\nprint("Another line")\nprint("Yet another line")',
					}]
				})).toMatchSnapshot();
			});
		});
		describe('Cell with multiple line (crlf)', () => {
			const cells = [
				new NotebookCellData(NotebookCellKind.Code, 'print("Hello World")\r\nprint("Foo Bar")\r\nprint("Bar Baz")\r\nprint("Something Else")', 'python'),
			];
			let altDoc: AlternativeNotebookTextDocument;
			let notebook: NotebookDocument;
			beforeEach(() => {
				({ altDoc, notebook } = createNotebook(cells));
			});
			function getUpdatedAltText(e: TextDocumentChangeEvent): string {
				const [newDoc, edit] = altDoc.withCellChangesAndEdit(e.document, e.contentChanges);
				const updatedAltText = newDoc.getAltText();

				// Verify the alt text is updated correctly
				expect(updatedAltText).toBe(edit!.apply(altDoc.getAltText()));

				return updatedAltText;
			}
			test(`replace line`, async () => {
				expect(getUpdatedAltText({
					document: notebook.cellAt(0).document,
					reason: undefined,
					detailedReason: {
						source: 'cursor',
						metadata: {}
					},
					contentChanges: [{
						range: new Range(0, 0, 0, 20),
						rangeOffset: 0,
						rangeLength: 20,
						text: '# Top level imports',
					}]
				})).toMatchSnapshot();
			});
			test(`replace multiple lines`, async () => {
				expect(getUpdatedAltText({
					document: notebook.cellAt(0).document,
					reason: undefined,
					detailedReason: {
						source: 'cursor',
						metadata: {}
					},
					contentChanges: [{
						range: new Range(1, 7, 1, 14),
						rangeOffset: 29,
						rangeLength: 7,
						text: 'Say Something',
					}, {
						range: new Range(0, 0, 0, 20),
						rangeOffset: 0,
						rangeLength: 20,
						text: '# Top level print statements',
					}]
				})).toMatchSnapshot();
			});
			test(`replace text with smaller text`, async () => {
				expect(getUpdatedAltText({
					document: notebook.cellAt(0).document,
					reason: undefined,
					detailedReason: {
						source: 'cursor',
						metadata: {}
					},
					contentChanges: [{
						range: new Range(0, 7, 0, 18),
						rangeOffset: 7,
						rangeLength: 11,
						text: 'Foo Bar',
					}]
				})).toMatchSnapshot();
			});
			test(`replace text with larger text`, async () => {
				expect(getUpdatedAltText({
					document: notebook.cellAt(0).document,
					reason: undefined,
					detailedReason: {
						source: 'cursor',
						metadata: {}
					},
					contentChanges: [{
						range: new Range(0, 7, 0, 18),
						rangeOffset: 7,
						rangeLength: 11,
						text: 'This is a longer piece of text',
					}]
				})).toMatchSnapshot();
			});
			test(`replace while inserting a few lines`, async () => {
				expect(getUpdatedAltText({
					document: notebook.cellAt(0).document,
					reason: undefined,
					detailedReason: {
						source: 'cursor',
						metadata: {}
					},
					contentChanges: [{
						range: new Range(0, 7, 0, 20),
						rangeOffset: 7,
						rangeLength: 13,
						text: 'Foo Bar")\r\nprint("Another line")\r\nprint("Yet another line")',
					}]
				})).toMatchSnapshot();
			});
			test(`insert a few lines`, async () => {
				expect(getUpdatedAltText({
					document: notebook.cellAt(0).document,
					reason: undefined,
					detailedReason: {
						source: 'cursor',
						metadata: {}
					},
					contentChanges: [{
						range: new Range(0, 20, 0, 20),
						rangeOffset: 20,
						rangeLength: 0,
						text: '\nprint("Another line")\nprint("Yet another line")',
					}]
				})).toMatchSnapshot();
			});
			test(`remove a line`, async () => {
				expect(getUpdatedAltText({
					document: notebook.cellAt(0).document,
					reason: undefined,
					detailedReason: {
						source: 'cursor',
						metadata: {}
					},
					contentChanges: [{
						range: new Range(0, 20, 1, 16),
						rangeOffset: 20,
						rangeLength: 18,
						text: '',
					}]
				})).toMatchSnapshot();
			});
			test(`remove two lines`, async () => {
				expect(getUpdatedAltText({
					document: notebook.cellAt(0).document,
					reason: undefined,
					detailedReason: {
						source: 'cursor',
						metadata: {}
					},
					contentChanges: [{
						range: new Range(0, 20, 2, 16),
						rangeOffset: 20,
						rangeLength: 36,
						text: '',
					}]
				})).toMatchSnapshot();
			});
			test(`merge two lines`, async () => {
				expect(getUpdatedAltText({
					document: notebook.cellAt(0).document,
					reason: undefined,
					detailedReason: {
						source: 'cursor',
						metadata: {}
					},
					contentChanges: [{
						range: new Range(0, 20, 1, 0),
						rangeOffset: 20,
						rangeLength: 2,
						text: '',
					}]
				})).toMatchSnapshot();
			});
		});
		describe('Cell with multiple line (lf)', () => {
			const cells = [
				new NotebookCellData(NotebookCellKind.Code, 'print("Hello World")\nprint("Foo Bar")\nprint("Bar Baz")\nprint("Something Else")', 'python'),
			];
			let altDoc: AlternativeNotebookTextDocument;
			let notebook: NotebookDocument;
			beforeEach(() => {
				({ altDoc, notebook } = createNotebook(cells));
			});
			function getUpdatedAltText(e: TextDocumentChangeEvent): string {
				const [newDoc, edit] = altDoc.withCellChangesAndEdit(e.document, e.contentChanges);
				const updatedAltText = newDoc.getAltText();

				// Verify the alt text is updated correctly
				expect(updatedAltText).toBe(edit!.apply(altDoc.getAltText()));

				return updatedAltText;
			}
			test(`replace line`, async () => {
				expect(getUpdatedAltText({
					document: notebook.cellAt(0).document,
					reason: undefined,
					detailedReason: {
						source: 'cursor',
						metadata: {}
					},
					contentChanges: [{
						range: new Range(0, 0, 0, 20),
						rangeOffset: 0,
						rangeLength: 20,
						text: '# Top level imports',
					}]
				})).toMatchSnapshot();
			});
			test(`replace multiple lines`, async () => {
				expect(getUpdatedAltText({
					document: notebook.cellAt(0).document,
					reason: undefined,
					detailedReason: {
						source: 'cursor',
						metadata: {}
					},
					contentChanges: [{
						range: new Range(1, 7, 1, 14),
						rangeOffset: 28,
						rangeLength: 7,
						text: 'Say Something',
					}, {
						range: new Range(0, 0, 0, 20),
						rangeOffset: 0,
						rangeLength: 20,
						text: '# Top level print statements',
					}]
				})).toMatchSnapshot();
			});
			test(`replace text with smaller text`, async () => {
				expect(getUpdatedAltText({
					document: notebook.cellAt(0).document,
					reason: undefined,
					detailedReason: {
						source: 'cursor',
						metadata: {}
					},
					contentChanges: [{
						range: new Range(0, 7, 0, 18),
						rangeOffset: 7,
						rangeLength: 11,
						text: 'Foo Bar',
					}]
				})).toMatchSnapshot();
			});
			test(`replace text with larger text`, async () => {
				expect(getUpdatedAltText({
					document: notebook.cellAt(0).document,
					reason: undefined,
					detailedReason: {
						source: 'cursor',
						metadata: {}
					},
					contentChanges: [{
						range: new Range(0, 7, 0, 18),
						rangeOffset: 7,
						rangeLength: 11,
						text: 'This is a longer piece of text',
					}]
				})).toMatchSnapshot();
			});
			test(`replace while inserting a few lines`, async () => {
				expect(getUpdatedAltText({
					document: notebook.cellAt(0).document,
					reason: undefined,
					detailedReason: {
						source: 'cursor',
						metadata: {}
					},
					contentChanges: [{
						range: new Range(0, 7, 0, 20),
						rangeOffset: 7,
						rangeLength: 13,
						text: 'Foo Bar")\nprint("Another line")\nprint("Yet another line")',
					}]
				})).toMatchSnapshot();
			});
			test(`insert a few lines`, async () => {
				expect(getUpdatedAltText({
					document: notebook.cellAt(0).document,
					reason: undefined,
					detailedReason: {
						source: 'cursor',
						metadata: {}
					},
					contentChanges: [{
						range: new Range(0, 20, 0, 20),
						rangeOffset: 20,
						rangeLength: 0,
						text: '\nprint("Another line")\nprint("Yet another line")',
					}]
				})).toMatchSnapshot();
			});
			test(`remove a line`, async () => {
				expect(getUpdatedAltText({
					document: notebook.cellAt(0).document,
					reason: undefined,
					detailedReason: {
						source: 'cursor',
						metadata: {}
					},
					contentChanges: [{
						range: new Range(0, 20, 1, 16),
						rangeOffset: 20,
						rangeLength: 17,
						text: '',
					}]
				})).toMatchSnapshot();
			});
			test(`remove two lines`, async () => {
				expect(getUpdatedAltText({
					document: notebook.cellAt(0).document,
					reason: undefined,
					detailedReason: {
						source: 'cursor',
						metadata: {}
					},
					contentChanges: [{
						range: new Range(0, 20, 2, 16),
						rangeOffset: 20,
						rangeLength: 34,
						text: '',
					}]
				})).toMatchSnapshot();
			});
			test(`merge two lines`, async () => {
				expect(getUpdatedAltText({
					document: notebook.cellAt(0).document,
					reason: undefined,
					detailedReason: {
						source: 'cursor',
						metadata: {}
					},
					contentChanges: [{
						range: new Range(0, 20, 1, 0),
						rangeOffset: 20,
						rangeLength: 1,
						text: '',
					}]
				})).toMatchSnapshot();
			});
		});
	});
	describe('Cell Add/Delete', () => {
		describe('Cell with 1 line', () => {
			const cells = [
				new NotebookCellData(NotebookCellKind.Code, 'print("Hello World")', 'python'),
			];
			let altDoc: AlternativeNotebookTextDocument;
			let notebook: NotebookDocument;
			beforeEach(() => {
				({ altDoc, notebook } = createNotebook(cells));
			});
			function getUpdatedAltText(e: NotebookDocumentContentChange[]): string {
				const originalText = altDoc.getAltText();
				const [newDoc, edit] = altDoc.withNotebookChangesAndEdit(e);
				const updatedAltText = newDoc.getAltText();
				if (edit) {
					// Verify the edit is generated correctly
					expect(edit.apply(originalText)).toBe(updatedAltText);
				}
				return updatedAltText;
			}
			test(`remove cell`, async () => {
				expect(getUpdatedAltText([{
					addedCells: [],
					range: new NotebookRange(0, 1),
					removedCells: [notebook.cellAt(0)],
				}])).toMatchSnapshot();
			});
			test(`insert cell below`, async () => {
				const { notebook } = createNotebook(cells.concat([
					new NotebookCellData(NotebookCellKind.Code, 'print("Foo Bar")', 'python'),
				]));
				expect(getUpdatedAltText([{
					addedCells: [notebook.cellAt(1)],
					range: new NotebookRange(1, 1),
					removedCells: [],
				}])).toMatchSnapshot();
			});
			test(`insert cell above`, async () => {
				const { notebook } = createNotebook(cells.concat([
					new NotebookCellData(NotebookCellKind.Code, 'print("Foo Bar")', 'python'),
				]));
				expect(getUpdatedAltText([{
					addedCells: [notebook.cellAt(1)],
					range: new NotebookRange(0, 0),
					removedCells: [],
				}])).toMatchSnapshot();
			});
			test(`insert cells above`, async () => {
				const { notebook } = createNotebook(cells.concat([
					new NotebookCellData(NotebookCellKind.Code, 'print("Foo Bar")', 'python'),
					new NotebookCellData(NotebookCellKind.Code, 'print("Bar Baz")', 'python'),
				]));
				expect(getUpdatedAltText([{
					addedCells: [notebook.cellAt(1), notebook.cellAt(2)],
					range: new NotebookRange(0, 0),
					removedCells: [],
				}])).toMatchSnapshot();
			});
			test(`insert cells`, async () => {
				const { notebook } = createNotebook(cells.concat([
					new NotebookCellData(NotebookCellKind.Code, 'print("Foo Bar")', 'python'),
					new NotebookCellData(NotebookCellKind.Code, 'print("Bar Baz")', 'python'),
				]));
				expect(getUpdatedAltText([{
					addedCells: [notebook.cellAt(1), notebook.cellAt(2)],
					range: new NotebookRange(1, 1),
					removedCells: [],
				}])).toMatchSnapshot();
			});
			test(`remove and insert cell`, async () => {
				const { notebook } = createNotebook(cells.concat([
					new NotebookCellData(NotebookCellKind.Code, 'print("Foo Bar")', 'python'),
				]));
				expect(getUpdatedAltText([{
					addedCells: [notebook.cellAt(1)],
					range: new NotebookRange(0, 1),
					removedCells: [notebook.cellAt(0)],
				}])).toMatchSnapshot();
			});
			test(`remove and insert cells`, async () => {
				const { notebook } = createNotebook(cells.concat([
					new NotebookCellData(NotebookCellKind.Code, 'print("Foo Bar")', 'python'),
					new NotebookCellData(NotebookCellKind.Code, 'print("Bar Baz")', 'python'),
				]));
				expect(getUpdatedAltText([{
					addedCells: [notebook.cellAt(1), notebook.cellAt(2)],
					range: new NotebookRange(0, 1),
					removedCells: [notebook.cellAt(0)],
				}])).toMatchSnapshot();
			});
		});
		describe('Cell with multiple line (crlf)', () => {
			const cells = [
				new NotebookCellData(NotebookCellKind.Code, 'print("Hello World")', 'python'),
				new NotebookCellData(NotebookCellKind.Code, 'print("Hello World")\r\nprint("Foo Bar")\r\nprint("Bar Baz")\r\nprint("Something Else")', 'python'),
			];
			let altDoc: AlternativeNotebookTextDocument;
			let notebook: NotebookDocument;
			beforeEach(() => {
				({ altDoc, notebook } = createNotebook(cells));
			});
			function getUpdatedAltText(e: NotebookDocumentContentChange[]): string {
				const originalText = altDoc.getAltText();
				const [newDoc, edit] = altDoc.withNotebookChangesAndEdit(e);
				const updatedAltText = newDoc.getAltText();
				if (edit) {
					// Verify the edit is generated correctly
					expect(edit.apply(originalText)).toBe(updatedAltText);
				}
				return updatedAltText;
			}
			test(`remove first cell`, async () => {
				expect(getUpdatedAltText([{
					addedCells: [],
					range: new NotebookRange(0, 1),
					removedCells: [notebook.cellAt(0)],
				}])).toMatchSnapshot();
			});
			test(`insert cell below`, async () => {
				const { notebook } = createNotebook(cells.concat([
					new NotebookCellData(NotebookCellKind.Code, 'print("Foo Bar")', 'python'),
				]));
				expect(getUpdatedAltText([{
					addedCells: [notebook.cellAt(2)],
					range: new NotebookRange(2, 2),
					removedCells: [],
				}])).toMatchSnapshot();
			});
			test(`insert cell middle`, async () => {
				const { notebook } = createNotebook(cells.concat([
					new NotebookCellData(NotebookCellKind.Code, 'print("Foo Bar")', 'python'),
				]));
				expect(getUpdatedAltText([{
					addedCells: [notebook.cellAt(2)],
					range: new NotebookRange(1, 1),
					removedCells: [],
				}])).toMatchSnapshot();
			});
			test(`insert cells middle`, async () => {
				const { notebook } = createNotebook(cells.concat([
					new NotebookCellData(NotebookCellKind.Code, 'print("Foo Bar")', 'python'),
					new NotebookCellData(NotebookCellKind.Code, '# Another Cell', 'python'),
				]));
				expect(getUpdatedAltText([{
					addedCells: [notebook.cellAt(2), notebook.cellAt(3)],
					range: new NotebookRange(1, 1),
					removedCells: [],
				}])).toMatchSnapshot();
			});
			test(`insert cell above`, async () => {
				const { notebook } = createNotebook(cells.concat([
					new NotebookCellData(NotebookCellKind.Code, 'print("Foo Bar")', 'python'),
				]));
				expect(getUpdatedAltText([{
					addedCells: [notebook.cellAt(1)],
					range: new NotebookRange(0, 0),
					removedCells: [],
				}])).toMatchSnapshot();
			});
			test(`insert cells above`, async () => {
				const { notebook } = createNotebook(cells.concat([
					new NotebookCellData(NotebookCellKind.Code, 'print("Foo Bar")', 'python'),
					new NotebookCellData(NotebookCellKind.Code, 'print("Bar Baz")', 'python'),
				]));
				expect(getUpdatedAltText([{
					addedCells: [notebook.cellAt(1), notebook.cellAt(2)],
					range: new NotebookRange(0, 0),
					removedCells: [],
				}])).toMatchSnapshot();
			});
			test(`insert cells`, async () => {
				const { notebook } = createNotebook(cells.concat([
					new NotebookCellData(NotebookCellKind.Code, 'print("Foo Bar")', 'python'),
					new NotebookCellData(NotebookCellKind.Code, 'print("Bar Baz")', 'python'),
				]));
				expect(getUpdatedAltText([{
					addedCells: [notebook.cellAt(1), notebook.cellAt(2)],
					range: new NotebookRange(1, 1),
					removedCells: [],
				}])).toMatchSnapshot();
			});
			test(`remove and insert cell`, async () => {
				const { notebook } = createNotebook(cells.concat([
					new NotebookCellData(NotebookCellKind.Code, 'print("Foo Bar")', 'python'),
				]));
				expect(getUpdatedAltText([{
					addedCells: [notebook.cellAt(1)],
					range: new NotebookRange(0, 1),
					removedCells: [notebook.cellAt(0)],
				}])).toMatchSnapshot();
			});
			test(`remove and insert cells`, async () => {
				const { notebook } = createNotebook(cells.concat([
					new NotebookCellData(NotebookCellKind.Code, 'print("Foo Bar")', 'python'),
					new NotebookCellData(NotebookCellKind.Code, 'print("Bar Baz")', 'python'),
				]));
				expect(getUpdatedAltText([{
					addedCells: [notebook.cellAt(1), notebook.cellAt(2)],
					range: new NotebookRange(0, 1),
					removedCells: [notebook.cellAt(0)],
				}])).toMatchSnapshot();
			});
		});
	});
});
