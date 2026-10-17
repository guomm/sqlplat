type Cell = string | number | boolean | null;
const numericTypes = new Set([0, 1, 2, 3, 4, 5, 8, 9, 13, 16, 246]);

function decimal(value: Cell) {
  const match = /^([+-]?)(\d*)(?:\.(\d*))?(?:e([+-]?\d+))?$/i.exec(
    String(typeof value === "boolean" ? Number(value) : value),
  );
  if (!match || !(match[2] || match[3])) return null;
  const whole = match[2],
    combined = whole + (match[3] || "");
  const digits = combined.replace(/^0+/, "");
  return {
    sign: !digits ? 0 : match[1] === "-" ? -1 : 1,
    digits,
    power:
      BigInt(whole.length - (combined.length - digits.length)) +
      BigInt(match[4] || "0"),
  };
}

function compareNumbers(a: Cell, b: Cell): number | null {
  const left = decimal(a),
    right = decimal(b);
  if (!left || !right) return null;
  if (left.sign !== right.sign) return left.sign - right.sign;
  if (!left.sign) return 0;
  if (left.power !== right.power)
    return (left.power > right.power ? 1 : -1) * left.sign;
  const size = Math.max(left.digits.length, right.digits.length);
  const x = left.digits.padEnd(size, "0"),
    y = right.digits.padEnd(size, "0");
  return (x === y ? 0 : x > y ? 1 : -1) * left.sign;
}

/** Sort a copy of the displayed page; never change original rows or coerce decimals to Number. */
export function sortRows(
  rows: Cell[][],
  column: number,
  type: number,
  direction: "desc" | "asc",
): Cell[][] {
  return [...rows].sort((a, b) => {
    const x = a[column],
      y = b[column];
    if (x === null) return y === null ? 0 : 1;
    if (y === null) return -1;
    const numeric = numericTypes.has(type) ? compareNumbers(x, y) : null;
    const compared = numeric ?? String(x).localeCompare(String(y), "zh-CN");
    return direction === "desc" ? -compared : compared;
  });
}
