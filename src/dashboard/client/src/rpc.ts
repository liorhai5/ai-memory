export async function rpc<T>(method: string, params?: Record<string, unknown>): Promise<T> {
  const res = await fetch('/rpc', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ method, params: params ?? {} }),
  });
  const data = await res.json();
  if (!data.ok) throw new Error(data.error);
  return data.result as T;
}
