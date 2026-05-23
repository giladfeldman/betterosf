import { z } from "zod";

const schema = z.object({
  OSF_APP_TOKEN: z.string().min(1, "OSF_APP_TOKEN required"),
  NEXT_PUBLIC_BASE_URL: z.string().url(),
});

export type Env = z.infer<typeof schema>;

export function parseEnv(input: Record<string, string | undefined>): Env {
  return schema.parse(input);
}

let cached: Env | null = null;
export function env(): Env {
  if (cached) return cached;
  cached = parseEnv(process.env);
  return cached;
}
