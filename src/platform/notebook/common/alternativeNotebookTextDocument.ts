/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { NotebookCell, NotebookDocument, NotebookDocumentContentChange, Selection, TextDocument, TextDocumentContentChangeEvent, TextEditor } from 'vscode';
import { coalesce } from '../../../util/vs/base/common/arrays';
import { findLastIdxMonotonous } from '../../../util/vs/base/common/arraysFind';
import { StringEdit } from '../../../util/vs/editor/common/core/edits/stringEdit';
import { OffsetRange } from '../../../util/vs/editor/common/core/ranges/offsetRange';
import { EndOfLine, NotebookCellKind, Range, Position as VSCodePosition } from '../../../vscodeTypes';
import { stringEditFromTextContentChange } from '../../editing/common/edit';
import { PositionOffsetTransformer } from '../../editing/common/positionOffsetTransformer';
import { generateCellTextMarker, getBlockComment, getLineCommentStart } from './alternativeContentProvider.text';
import { EOL, summarize } from './helpers';
import { CrLfOffsetTranslator } from './offsetTranslator';


class AlternativeNotebookCellTextDocument {
	private readonly positionTransformer: PositionOffsetTransformer;
	private readonly crlfTranslator: CrLfOffsetTranslator;
	public readonly lineCount: number;
	// private _originalTextWithPreservedEOL?: string;
	public static fromNotebookCell(cell: NotebookCell, blockComment: [string, string], lineCommentStart: string): AlternativeNotebookCellTextDocument {
		const summary = summarize(cell);
		const cellMarker = generateCellTextMarker(summary, lineCommentStart);
		const code = cell.document.getText().replace(/\r\n|\n/g, EOL);
		const prefix = cell.kind === NotebookCellKind.Markup ? `${cellMarker}${EOL}${blockComment[0]}${EOL}` : `${cellMarker}${EOL}`;
		const suffix = cell.kind === NotebookCellKind.Markup ? `${EOL}${blockComment[1]}` : '';
		return new AlternativeNotebookCellTextDocument(cell, blockComment, lineCommentStart, code, prefix, suffix);
	}
	constructor(
		public readonly cell: NotebookCell,
		private readonly blockComment: [string, string],
		private readonly lineCommentStart: string,
		private readonly code: string,
		private readonly prefix: string,
		private readonly suffix: string
	) {
		this.crlfTranslator = new CrLfOffsetTranslator(cell.document.getText(), cell.document.eol);
		this.positionTransformer = new PositionOffsetTransformer(`${prefix}${code}${suffix}`);
		// this.positionTransformer.
		this.lineCount = this.positionTransformer.getLineCount();
		// this._originalTextWithPreservedEOL = cell.document.getText() !== code ? cell.document.getText() : undefined;
	}

	public normalizeEdits(edits: readonly TextDocumentContentChangeEvent[]): TextDocumentContentChangeEvent[] {
		return edits.map(e => {
			const range = this.toAltRange(e.range);
			const rangeOffset = this.crlfTranslator.translate(e.rangeOffset);
			const endOffset = this.crlfTranslator.translate(e.rangeOffset + e.rangeLength);
			return {
				range,
				rangeLength: endOffset - rangeOffset,
				rangeOffset,
				text: e.text.replace(/\r\n|\n/g, EOL), // Normalize line endings to EOL
			};
		});
	}

	// public withTextChanges(events: readonly TextDocumentContentChangeEvent[]): AlternativeNotebookCellTextDocument {
	// 	const edit = editFromTextDocumentContentChangeEvents(events);
	// 	return this.withTextEdit(edit);
	// }

	public withTextEdit(edit: StringEdit): AlternativeNotebookCellTextDocument {
		const newCode = edit.apply(this.code);
		return new AlternativeNotebookCellTextDocument(this.cell, this.blockComment, this.lineCommentStart, newCode, this.prefix, this.suffix);
	}

	public get altText(): string {
		return this.positionTransformer.getText();
	}

	public toAltOffsetRange(range: Range): OffsetRange {
		// Remove the lines we've added for the cell marker and block comments
		const extraLinesAdded = this.cell.kind === NotebookCellKind.Markup ? 2 : 1;
		// VS Code positions are 0 based, and our transformer works with 1 based positions.
		const startOffset = this.positionTransformer.getOffset(new VSCodePosition(range.start.line + extraLinesAdded, range.start.character));
		const endOffset = this.positionTransformer.getOffset(new VSCodePosition(range.end.line + extraLinesAdded, range.end.character));
		return new OffsetRange(startOffset, endOffset);
	}

	public toAltRange(range: Range): Range {
		// Remove the lines we've added for the cell marker and block comments
		const extraLinesAdded = this.cell.kind === NotebookCellKind.Markup ? 2 : 1;

		return new Range(range.start.line + extraLinesAdded, range.start.character, range.end.line + extraLinesAdded, range.end.character);
	}

	public fromAltOffsetRange(offsetRange: OffsetRange): Range {
		const startOffset = offsetRange.start;
		const endOffset = offsetRange.endExclusive;
		const startPosition = this.positionTransformer.getPosition(startOffset);
		const endPosition = this.positionTransformer.getPosition(endOffset);

		// Remove the lines we've added for the cell marker and block comments
		const extraLinesAdded = this.cell.kind === NotebookCellKind.Markup ? 2 : 1;

		const startLine = Math.max(startPosition.line - extraLinesAdded, 0);
		const endLine = Math.max(endPosition.line - extraLinesAdded, 0);
		let endLineEndColumn = endPosition.character;
		if (endLine === (this.lineCount - extraLinesAdded)) {
			const lastPosition = this.positionTransformer.getPosition(this.positionTransformer.getText().length); // Ensure the transformer has the correct line count
			const lastLineLength = lastPosition.character;
			if (lastLineLength < endLineEndColumn) {
				endLineEndColumn = lastLineLength;
			}
		}
		return new Range(startLine, startPosition.character, endLine, endLineEndColumn);
	}
}

function cellsBuilder<T>(cellItems: T[], altCelBuilder: (cellItem: T) => AlternativeNotebookCellTextDocument, blockComment: [string, string], lineCommentStart: string) {
	let lineCount = 0;
	let offset = 0;
	return cellItems.map(item => {
		const altCell = altCelBuilder(item);
		const startLine = lineCount;
		const startOffset = offset;
		lineCount += altCell.lineCount;
		offset += altCell.altText.length + EOL.length; // EOL is added between cells
		return { altCell, startLine, startOffset };
	});
}

export class AlternativeNotebookTextDocument {
	private readonly cellTextDocuments = new Map<TextDocument, NotebookCell>();
	public static withoutMDCells(notebook: NotebookDocument) {
		return AlternativeNotebookTextDocument.create(notebook, true);
	}

	private static create(notebook: NotebookDocument, excludeMarkdownCells: boolean): AlternativeNotebookTextDocument {
		const blockComment = getBlockComment(notebook);
		const lineCommentStart = getLineCommentStart(notebook);
		const notebookCells = notebook.getCells().filter(cell => !excludeMarkdownCells || cell.kind !== NotebookCellKind.Markup);
		const altCells = cellsBuilder(notebookCells, cell => AlternativeNotebookCellTextDocument.fromNotebookCell(cell, blockComment, lineCommentStart), blockComment, lineCommentStart);

		return new AlternativeNotebookTextDocument(notebook, excludeMarkdownCells, blockComment, lineCommentStart, altCells);
	}
	private constructor(public readonly notebook: NotebookDocument,
		private readonly excludeMarkdownCells: boolean,
		private readonly blockComment: [string, string],
		private readonly lineCommentStart: string,
		private readonly altCells: { altCell: AlternativeNotebookCellTextDocument; startLine: number; startOffset: number }[]) {
		for (const { altCell } of this.altCells) {
			this.cellTextDocuments.set(altCell.cell.document, altCell.cell);
		}
	}

	public withNotebookChangesx(events: readonly NotebookDocumentContentChange[]): AlternativeNotebookTextDocument {
		return this.withNotebookChangesAndEdit(events)[0];
	}

	public withNotebookChangesAndEdit(events: readonly NotebookDocumentContentChange[]): [AlternativeNotebookTextDocument, StringEdit | undefined] {
		if (!events.length) {
			return [this, undefined];
		}
		let altCells = this.altCells.slice();
		let edit = StringEdit.compose([]);
		for (const event of events) {
			const newCells = event.addedCells.map(cell => ({ altCell: AlternativeNotebookCellTextDocument.fromNotebookCell(cell, this.blockComment, this.lineCommentStart), startLine: 0, startOffset: 0 }));

			const removedCells = altCells.slice(event.range.start, event.range.end);
			let firstUnChangedCellIndex = -1;
			if (event.range.isEmpty) {
				firstUnChangedCellIndex = event.range.start === 0 ? -1 : event.range.start - 1;
			} else {
				firstUnChangedCellIndex = event.range.start === 0 ? -1 : event.range.start - 1;
			}
			const startOffset = firstUnChangedCellIndex === -1 ? 0 : altCells[firstUnChangedCellIndex].startOffset + altCells[firstUnChangedCellIndex].altCell.altText.length + EOL.length;
			let offsetLength = removedCells.map((cell) => cell.altCell.altText).join(EOL).length;
			let newCellsContent = newCells.map((cell) => cell.altCell.altText).join(EOL);
			if (startOffset !== 0) {
				if (!(event.range.end < altCells.length)) {
					newCellsContent = `${EOL}${newCellsContent}`;
				}
			}
			// if we have some cells after the insertion, then we need to insert an EOL at the end.
			if (event.range.end < altCells.length) {
				if (newCellsContent) {
					newCellsContent += EOL;
				}
				if (offsetLength) {
					offsetLength += EOL.length;
				}
			}
			edit = edit.compose(StringEdit.replace(new OffsetRange(startOffset, startOffset + offsetLength), newCellsContent));

			altCells.splice(event.range.start, event.range.end - event.range.start, ...newCells);
			altCells = cellsBuilder(altCells, cell => cell.altCell, this.blockComment, this.lineCommentStart);
		}

		const altDoc = new AlternativeNotebookTextDocument(this.notebook, this.excludeMarkdownCells, this.blockComment, this.lineCommentStart, altCells);
		return [altDoc, edit];
	}

	public withCellChangesAndEdit(cellTextDoc: TextDocument, events: readonly TextDocumentContentChangeEvent[]): [AlternativeNotebookTextDocument, StringEdit | undefined] {
		if (events.length === 0) {
			return [this, undefined];
		}
		const edit = editFromNotebookCellTextDocumentContentChangeEvents(this, cellTextDoc, events);
		return [this.withCellChanges(cellTextDoc, events), edit];
	}

	public withCellChanges(cellTextDoc: TextDocument, edit: StringEdit | readonly TextDocumentContentChangeEvent[]): AlternativeNotebookTextDocument {
		if (edit instanceof StringEdit ? edit.isEmpty() : edit.length === 0) {
			return this;
		}
		const cell = this.altCells.find(c => c.altCell.cell.document === cellTextDoc);
		if (!cell) {
			return this;
		}
		const cellEdit = edit instanceof StringEdit ? edit : stringEditFromTextContentChange(cell.altCell.normalizeEdits(edit));
		const blockComment = this.blockComment;
		const lineCommentStart = this.lineCommentStart;
		const altCells = cellsBuilder(this.altCells, cell => cell.altCell.cell.document === cellTextDoc ? cell.altCell.withTextEdit(cellEdit) : cell.altCell, blockComment, lineCommentStart);
		return new AlternativeNotebookTextDocument(this.notebook, this.excludeMarkdownCells, blockComment, lineCommentStart, altCells);
	}

	public getCell(textDocument: TextDocument): NotebookCell | undefined {
		return this.cellTextDocuments.get(textDocument);
	}

	public get altText(): string {
		return this.altCells.map(cell => cell.altCell.altText).join(EOL);
	}

	public getAltText(range?: OffsetRange): string {
		return range ? range.substring(this.altText) : this.altText;
	}

	public toAltSelection(cell: NotebookCell, selections: Selection[]): OffsetRange[] {
		return this.toAltOffsetRange(cell, selections);
	}

	public fromAltOffsetRange(offsetRange: OffsetRange): [NotebookCell, Range][] | undefined {
		const firstIdx = findLastIdxMonotonous(this.altCells, c => c.startOffset <= offsetRange.start);
		if (firstIdx === -1) {
			return;
		}
		const cells: [NotebookCell, Range][] = [];

		for (let i = firstIdx; i < this.altCells.length; i++) {
			const { altCell, startOffset } = this.altCells[i];
			if (i === firstIdx) {
				const offset = new OffsetRange(offsetRange.start - startOffset, offsetRange.endExclusive - startOffset);
				cells.push([altCell.cell, altCell.fromAltOffsetRange(offset)]);
			} else if ((startOffset + altCell.altText.length) < offsetRange.endExclusive) {
				const offset = new OffsetRange(0, altCell.altText.length);
				cells.push([altCell.cell, altCell.fromAltOffsetRange(offset)]);
			} else if (startOffset < offsetRange.endExclusive) {
				const offset = new OffsetRange(0, offsetRange.endExclusive - startOffset);
				cells.push([altCell.cell, altCell.fromAltOffsetRange(offset)]);
			}
		}

		return cells;
	}

	projectVisibleRanges(visibleTextEditors: readonly TextEditor[]): OffsetRange[] {
		const visibleEditors = new Map(visibleTextEditors.map(editor => ([editor.document, editor] as const)));
		const visibleCells = this.notebook.getCells().filter(cell => visibleEditors.has(cell.document));
		return visibleCells.flatMap(cell => {
			const editor = visibleEditors.get(cell.document);
			if (editor) {
				return this.toAltOffsetRange(cell, editor.visibleRanges);
			}
			return [];
		});
	}

	// projectSelections(): OffsetRange[] {
	// 	const visibleEditors = new Map(window.visibleTextEditors.map(editor => ([editor.document, editor] as const)));
	// 	const visibleCells = this.notebook.getCells().filter(cell => visibleEditors.has(cell.document));
	// 	return visibleCells.flatMap(cell => {
	// 		const editor = visibleEditors.get(cell.document);
	// 		if (editor) {
	// 			return this.projectRange(cell, editor.visibleRanges);
	// 		}
	// 		return [];
	// 	});
	// }

	public toAltOffsetRange(cell: NotebookCell, ranges: readonly Range[]): OffsetRange[] {
		let offset = 0;
		for (const { altCell } of this.altCells) {
			if (altCell.cell === cell) {
				return ranges.map(range => {
					const offsetRange = altCell.toAltOffsetRange(range);
					const adjustedRange = new OffsetRange(offset + offsetRange.start, offset + offsetRange.endExclusive);
					return adjustedRange;
				});
			} else {
				offset += altCell.altText.length + EOL.length; // EOL is added between cells
			}
		}
		return [];
	}

	public toAltRange(cell: NotebookCell, ranges: readonly Range[]): Range[] {
		let offset = 0;
		for (const { altCell, startLine } of this.altCells) {
			if (altCell.cell === cell) {
				return ranges.map(range => {
					const altCellRange = altCell.toAltRange(range);
					const adjustedRange = new Range(altCellRange.start.line + startLine, altCellRange.start.character, altCellRange.end.line + startLine, altCellRange.end.character);
					return adjustedRange;
				});
			} else {
				offset += altCell.altText.length + EOL.length; // EOL is added between cells
			}
		}
		return [];
	}
}

export function editFromNotebookCellTextDocumentContentChangeEvents(notebook: AlternativeNotebookTextDocument, cellTextDocument: TextDocument, events: readonly TextDocumentContentChangeEvent[]): StringEdit {
	const replacementsInApplicationOrder = toAltCellTextDocumentContentChangeEvents(notebook, cellTextDocument, events);

	return stringEditFromTextContentChange(replacementsInApplicationOrder);
}

export function toAltCellTextDocumentContentChangeEvents(notebook: AlternativeNotebookTextDocument, cellTextDocument: TextDocument, events: readonly TextDocumentContentChangeEvent[]): TextDocumentContentChangeEvent[] {
	return coalesce(events.map(e => {
		const cell = notebook.getCell(cellTextDocument);
		if (!cell) {
			return undefined;
		}
		const ranges = notebook.toAltRange(cell, [e.range]);
		const rangeOffsets = notebook.toAltOffsetRange(cell, [e.range]);
		if (!ranges.length || !rangeOffsets.length) {
			return undefined;
		}
		const range = ranges[0];
		const rangeOffset = rangeOffsets[0];
		return {
			range,
			rangeLength: rangeOffset.endExclusive - rangeOffset.start,
			rangeOffset: rangeOffset.start,
			text: e.text.replace(/\r\n|\n/g, EOL), // Normalize line endings to EOL
		} as typeof e;
	}));
}
