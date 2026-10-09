export type User = {
  id: number;
  username: string;
  role: "admin" | "user";
  enabled: boolean;
};
export type Connection = {
  id: number;
  name: string;
  kind: "mysql" | "doris";
  database: string;
  enabled: boolean;
  host?: string;
  port?: number;
  username?: string;
  tls?: { enabled: boolean; ca: string; cert: string; key: string };
};
export type Column = { name: string; type: number };
export type Statement = {
  id: number;
  ordinal: number;
  sql: string;
  status: string;
  columns: Column[];
  affected_rows: number;
  saved_rows: number;
  truncated: boolean;
  expires_at: string | null;
  elapsed_ms: number;
  error: string;
};
export type Task = {
  id: string;
  connection_id: number | null;
  connection_name: string;
  database: string;
  sql: string;
  status: string;
  created_at: string;
  started_at: string | null;
  ended_at: string | null;
  elapsed_ms: number;
  error: string;
  statements: Statement[];
};
export type ResultPage = {
  columns: Column[];
  rows: (string | number | boolean | null)[][];
  total: number;
  saved_rows: number;
  truncated: boolean;
};
export type SavedQuery = {
  id: string;
  name: string;
  sql: string;
  connection_id: number | null;
  connection_name: string;
  database: string;
  created_at: string;
  updated_at: string;
};
