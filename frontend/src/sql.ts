export type StatementRange = { sql: string; start: number; end: number };
export type ExecutionMode = "selection" | "current" | "all" | "auto";
export function splitStatements(
  text: string,
  kind = "mysql",
): StatementRange[] {
  const result: StatementRange[] = [];
  let dollar = "",
    depth = 0,
    escapeQuote = false;
  let start = 0,
    quote = "",
    comment = "",
    meaningful = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i],
      next = text[i + 1] || "";
    if (dollar) {
      if (text.startsWith(dollar, i)) {
        i += dollar.length - 1;
        dollar = "";
      }
    } else if (comment === "line") {
      if (c === "\r" || c === "\n") comment = "";
    } else if (comment === "block") {
      if (c === "*" && next === "/") {
        if (--depth === 0) comment = "";
        i++;
      } else if (kind === "postgresql" && c === "/" && next === "*") {
        depth++;
        i++;
      }
    } else if (quote) {
      if (c === "\\" && (kind !== "postgresql" || escapeQuote)) i++;
      else if (c === quote) {
        if (next === quote) i++;
        else quote = "";
      }
    } else if (
      kind === "postgresql" &&
      c === "$" &&
      /^\$(?:[A-Za-z_][A-Za-z_0-9]*)?\$/.test(text.slice(i))
    ) {
      dollar = text.slice(i).match(/^\$(?:[A-Za-z_][A-Za-z_0-9]*)?\$/)![0];
      meaningful = true;
      i += dollar.length - 1;
    } else if ("'\"`".includes(c)) {
      escapeQuote =
        i > 0 &&
        /[eE]/.test(text[i - 1]) &&
        (i < 2 || !/[A-Za-z_0-9]/.test(text[i - 2]));
      quote = c;
      meaningful = true;
    } else if (
      (c === "#" && kind !== "postgresql") ||
      (c === "-" &&
        next === "-" &&
        (kind === "postgresql" ||
          i + 2 === text.length ||
          /\s/.test(text[i + 2])))
    )
      comment = "line";
    else if (c === "/" && next === "*") {
      if (text[i + 2] === "!") meaningful = true;
      comment = "block";
      depth = 1;
      i++;
    } else if (c === ";") {
      if (meaningful)
        result.push({ sql: text.slice(start, i).trim(), start, end: i + 1 });
      start = i + 1;
      meaningful = false;
    } else if (!/\s/.test(c)) meaningful = true;
  }
  if (quote || dollar || comment === "block")
    throw new Error("SQL 字符串或块注释未闭合");
  if (meaningful)
    result.push({ sql: text.slice(start).trim(), start, end: text.length });
  return result;
}
export function executionText(
  mode: ExecutionMode,
  text: string,
  selection: string,
  offset: number,
  kind = "mysql",
) {
  if (mode === "auto") mode = selection.length ? "selection" : "current";
  if (mode === "selection") return selection;
  if (mode === "all") return text;
  const parts = splitStatements(text, kind);
  return (
    parts.find((p) => p.start <= offset && offset < p.end)?.sql ||
    (offset === text.length ? parts.at(-1)?.sql || "" : "")
  );
}
