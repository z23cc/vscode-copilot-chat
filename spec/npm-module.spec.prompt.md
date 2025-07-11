We'd like to extract a npm module from the codebase. The module should be named `@vscode/chat-lib`. There should be a build script that helps us create this npm module. The extraction process should include the following steps:
- we need a `chat-lib.d.ts` file somewhere which defines the "public" API of this node module and which we'll use for driving the versioning
- we need a script similar to copySources.ts which we can seed with some entry points and then all of the code will be moved to a temporary folder like `tmp-chat-lib`. Inside the folder `tmp-chat-lib` there will be the complete node module which we can then publish to npm.
- the node module will contain typescript files and all of our code will go to an `_internal` folder inside of it.
- the public entry point of the node module will be a `main.ts` file which exports an API that is equal to `chat-lib.d.ts`.




Some clarifications:


Here are the entry-points. All of these should be made available in the `_internal`:
```
...
src/platform/inlineEdits/common/observableWorkspace';
src/platform/inlineEdits/common/observableWorkspace';
src/util/vs/editor/common/core/position';
src/platform/inlineEdits/common/observableWorkspace';
src/util/vs/base/common/lifecycle';
src/extension/inlineEdits/node/nearbyCursorInlineEditProvider';
src/platform/inlineEdits/common/dataTypes/languageId';
src/util/vs/editor/common/core/lineRange';
src/extension/inlineEdits/node/ghNearbyNesProvider';
src/extension/inlineEdits/node/nextEditResult';
src/extension/xtab/node/xtabProvider';
src/platform/inlineEdits/common/observableWorkspace';
src/platform/inlineEdits/common/workspaceEditTracker/nesXtabHistoryTracker';
src/vscodeTypes';
src/platform/inlineEdits/common/observableWorkspace';
src/platform/inlineEdits/common/observableWorkspace';
src/util/vs/editor/common/core/position';
- Sources forked from [VS Code Copilot's Preview implementation](https://github.com/microsoft/vscode-copilot/blob/main/src/extension/inlineEdits/node/nextEditProvider.ts).
src/platform/chat/common/globalStringUtils';
src/util/node/tokenizer';
src/extension/xtab/node/xtabProvider';
src/platform/chat/common/globalStringUtils';
src/platform/diff/common/diffService';
src/platform/diff/common/diffWorker';
src/platform/networking/common/openai';
src/util/vs/base/common/uuid';
src/util/node/tokenizer';
src/platform/inlineEdits/common/dataTypes/documentId';
src/platform/inlineEdits/common/dataTypes/edit';
src/platform/inlineEdits/common/dataTypes/languageId';
src/platform/inlineEdits/common/dataTypes/stringValue';
src/platform/inlineEdits/common/utils/observable';
src/util/vs/base/common/lifecycle';
src/util/vs/base/common/observableInternal';
src/util/vs/editor/common/core/offsetRange';
src/platform/inlineEdits/common/observableWorkspace';
src/platform/inlineEdits/common/observableWorkspace';
src/platform/inlineEdits/common/observableWorkspace';
src/platform/inlineEdits/common/utils/observable';
src/util/vs/base/common/lifecycle';
src/util/vs/base/common/observableInternal';
src/util/vs/base/common/charCode';
```

The lbirary should be decoupled from the vscode API and should only include files in the `/common/` or `/node/` layers. Let's make a trivial API surface just for demo purposes, maybe something which exports the class LineRange.

Consumers should only consume TypeScript , we won't ship .js files. Just use the same node version we use in this project.

Yes, `chat-lib.d.ts` should be hand-written and maintained separately and then it will be used as typechecking that the API is correctly implementing it.

Yes, you need to drag in all required files as necessary to ensure that the generated node module source code compiles correctly. This should be compiled with TS.

The consumer of the library will be a project which will use the code like an SDK trying to benefit from the functioanlity by providing their own service implementations for the different services necessary.

Again, the outcome of all of this should be basically the .d.ts file, the main entry point file and a .ts script that can generate this node module using all the rules we discussed