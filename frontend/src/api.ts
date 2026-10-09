let csrf = "";
export function setCsrf(token: string) {
  csrf = token;
}
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export const apiUrl = (path: string) => `${import.meta.env.BASE_URL}api${path}`;
export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(apiUrl(path), {
    credentials: "same-origin",
    ...init,
    headers: {
      "Content-Type": "application/json",
      "X-CSRF-Token": csrf,
      ...init.headers,
    },
  });
  if (!response.ok) {
    let text = "请求失败，请稍后重试";
    try {
      const body = await response.json();
      text =
        typeof body.detail === "string"
          ? body.detail
          : body.detail?.map((v: { msg: string }) => v.msg).join("；") || text;
    } catch {
      /* preserve fallback */
    }
    if (response.status === 401)
      window.dispatchEvent(new Event("session-expired"));
    throw new ApiError(response.status, text);
  }
  if (response.status === 204) return undefined as T;
  return response.json();
}
export const send = (method: string, data: unknown): RequestInit => ({
  method,
  body: JSON.stringify(data),
});
export const query = (data: Record<string, string | number>) =>
  new URLSearchParams(
    Object.entries(data).map(([k, v]) => [k, String(v)]),
  ).toString();
