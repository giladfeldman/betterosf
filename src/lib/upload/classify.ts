import type { UploadCause } from "./types";

export type ClassifyInput = {
  status?: number;
  code?: string;      // server error code: unauthorized|forbidden|conflict|too_large|invalid|upstream
  message?: string;
  threw?: boolean;    // fetch itself rejected (network/offline)
};

export type Classification = {
  cause: UploadCause;
  retryable: boolean;
  message: string;
};

export function classifyUploadError(input: ClassifyInput): Classification {
  const detail = (input.message ?? "").trim();
  if (input.threw) {
    return { cause: "connectivity", retryable: true, message: detail || "Network error — could not reach OSF." };
  }
  const status = input.status ?? 0;
  if (status === 429 || (status >= 500 && status <= 599)) {
    return { cause: "osf_down", retryable: true, message: detail || `OSF is unavailable (status ${status}).` };
  }
  if (status === 401 || status === 403) {
    return { cause: "permission", retryable: false, message: detail || "Your OSF session/permission is insufficient." };
  }
  if (status === 413) {
    return { cause: "betterosf", retryable: false, message: detail || "OSF rejected the file as too large." };
  }
  if (status === 400 || input.code === "invalid") {
    return { cause: "betterosf", retryable: false, message: detail || "BetterOSF sent an invalid upload request." };
  }
  // Conflicts are handled by the conflict policy, not as errors; anything else is unknown.
  return { cause: "unknown", retryable: false, message: detail || `Upload failed (status ${status || "unknown"}).` };
}
