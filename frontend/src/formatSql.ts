import { formatDialect, mysql, postgresql } from "sql-formatter";

// Doris uses MySQL-compatible syntax; unsupported extensions leave the editor unchanged.
export function formatSql(sql: string, kind = "mysql"): string {
  return formatDialect(sql, {
    dialect: kind === "postgresql" ? postgresql : mysql,
    tabWidth: 2,
    keywordCase: "upper",
  });
}
