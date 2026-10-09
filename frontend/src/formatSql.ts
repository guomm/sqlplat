import { formatDialect, mysql } from "sql-formatter";

// Doris uses MySQL-compatible syntax; unsupported extensions leave the editor unchanged.
export function formatSql(sql: string): string {
  return formatDialect(sql, {
    dialect: mysql,
    tabWidth: 2,
    keywordCase: "upper",
  });
}
