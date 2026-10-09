export type StatementRange = { sql: string; start: number; end: number };
export type ExecutionMode = "selection" | "current" | "all" | "auto";
export function splitStatements(text: string): StatementRange[] {
  const result: StatementRange[] = [];
  let start = 0,
    quote = "",
    comment = "",
    meaningful = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i],
      next = text[i + 1] || "";
    if (comment === "line") {
      if (c === "\r" || c === "\n") comment = "";
    } else if (comment === "block") {
      if (c === "*" && next === "/") {
        comment = "";
        i++;
      }
    } else if (quote) {
      if (c === "\\") i++;
      else if (c === quote) {
        if (next === quote) i++;
        else quote = "";
      }
    } else if ("'\"`".includes(c)) {
      quote = c;
      meaningful = true;
    } else if (
      c === "#" ||
      (c === "-" &&
        next === "-" &&
        (i + 2 === text.length || /\s/.test(text[i + 2])))
    )
      comment = "line";
    else if (c === "/" && next === "*") {
      if (text[i + 2] === "!") meaningful = true;
      comment = "block";
      i++;
    } else if (c === ";") {
      if (meaningful)
        result.push({ sql: text.slice(start, i).trim(), start, end: i + 1 });
      start = i + 1;
      meaningful = false;
    } else if (!/\s/.test(c)) meaningful = true;
  }
  if (quote || comment === "block") throw new Error("SQL 字符串或块注释未闭合");
  if (meaningful)
    result.push({ sql: text.slice(start).trim(), start, end: text.length });
  return result;
}
export function executionText(
  mode: ExecutionMode,
  text: string,
  selection: string,
  offset: number,
) {
  if (mode === "auto") mode = selection.length ? "selection" : "current";
  if (mode === "selection") return selection;
  if (mode === "all") return text;
  const parts = splitStatements(text);
  return (
    parts.find((p) => p.start <= offset && offset < p.end)?.sql ||
    (offset === text.length ? parts.at(-1)?.sql || "" : "")
  );
}
