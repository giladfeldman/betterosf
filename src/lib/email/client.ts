import { SESClient } from "@aws-sdk/client-ses";

let cached: SESClient | null = null;

export function getSesClient(): SESClient {
  if (cached) return cached;

  const region = process.env.AWS_SES_REGION?.trim();
  const accessKeyId = process.env.AWS_SES_ACCESS_KEY_ID?.trim();
  const secretAccessKey = process.env.AWS_SES_SECRET_ACCESS_KEY?.trim();

  if (!region || !accessKeyId || !secretAccessKey) {
    throw new Error(
      "SES env vars missing: AWS_SES_REGION, AWS_SES_ACCESS_KEY_ID, AWS_SES_SECRET_ACCESS_KEY",
    );
  }

  cached = new SESClient({
    region,
    credentials: { accessKeyId, secretAccessKey },
  });
  return cached;
}

export const FROM_ADDRESS = () =>
  process.env.EMAIL_FROM_ADDRESS?.trim() || "betterosf@scimeto.app";

export const FROM_NAME = () => process.env.EMAIL_FROM_NAME?.trim() || "BetterOSF";

export const EMAIL_MODE = () =>
  (
    process.env.EMAIL_MODE?.trim() ||
    (process.env.NODE_ENV === "development" ? "console" : "ses")
  ) as "ses" | "console";

export const ALLOWLIST = (): string[] =>
  (process.env.EMAIL_ALLOWLIST ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
