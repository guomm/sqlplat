import Editor, { loader, type EditorProps } from "@monaco-editor/react";
import * as monaco from "monaco-editor/esm/vs/editor/editor.api";
import "monaco-editor/esm/vs/basic-languages/sql/sql.contribution";
import EditorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";
self.MonacoEnvironment = { getWorker: () => new EditorWorker() };
loader.config({ monaco });
export default function SqlEditor(props: EditorProps) {
  return <Editor {...props} />;
}
