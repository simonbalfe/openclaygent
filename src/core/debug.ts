function envFlag(name: string): boolean {
  const v = process.env[name];
  return v !== undefined && v !== "" && v !== "0" && v !== "false";
}

export function reason(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export function debug(scope: string, message: string): void {
  if (!envFlag("OPENCLAY_DEBUG")) return;
  console.error(`[${new Date().toISOString()}] ${scope} ${message.slice(0, 500)}`);
}
