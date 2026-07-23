type NetlifyGlobal = typeof globalThis & {
  Netlify?: { env: { get(name: string): string | undefined } };
  process?: { env?: Record<string, string | undefined> };
};

export function env(name: string): string | undefined {
  const runtime = globalThis as NetlifyGlobal;
  return runtime.Netlify?.env.get(name) ?? runtime.process?.env?.[name];
}

export function requiredEnv(name: string): string {
  const value = env(name);
  if (!value) throw new Error(`${name} is not configured.`);
  return value;
}

export function bootstrapAdminEmails(): Set<string> {
  return new Set(
    (env("BAIRD_ADMIN_EMAILS") || "")
      .split(",")
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean)
  );
}

export function bootstrapOwnerEmails(): Set<string> {
  const protectedOwner = "simsingh@gmail.com";
  return new Set(
    [protectedOwner, ...(env("BAIRD_OWNER_EMAILS") || "").split(",")]
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean)
  );
}
