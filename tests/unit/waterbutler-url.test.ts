import { describe, it, expect } from "vitest";
import { validateWaterbutlerActionUrl, OsfWriteError } from "@/lib/osf/waterbutler-url";

const GUID = "abcde";
const OK = `https://files.osf.io/v1/resources/${GUID}/providers/osfstorage/`;

describe("validateWaterbutlerActionUrl", () => {
  it("accepts a canonical files.osf.io action URL", () => {
    expect(validateWaterbutlerActionUrl(OK, GUID)).toContain("files.osf.io");
  });

  it("accepts a regional files host (files.de-1.osf.io)", () => {
    const url = `https://files.de-1.osf.io/v1/resources/${GUID}/providers/osfstorage/`;
    expect(validateWaterbutlerActionUrl(url, GUID)).toContain("files.de-1.osf.io");
  });

  it("rejects non-https", () => {
    expect(() => validateWaterbutlerActionUrl(OK.replace("https:", "http:"), GUID)).toThrow(OsfWriteError);
  });

  it("rejects a non-osf host", () => {
    expect(() => validateWaterbutlerActionUrl(`https://evil.example.com/v1/resources/${GUID}/providers/osfstorage/`, GUID)).toThrow(OsfWriteError);
  });

  it("rejects an explicit port", () => {
    expect(() => validateWaterbutlerActionUrl(`https://files.osf.io:8443/v1/resources/${GUID}/providers/osfstorage/`, GUID)).toThrow(OsfWriteError);
  });

  it("rejects embedded credentials", () => {
    expect(() => validateWaterbutlerActionUrl(`https://user:pass@files.osf.io/v1/resources/${GUID}/providers/osfstorage/`, GUID)).toThrow(OsfWriteError);
  });

  it("rejects a path for a different guid", () => {
    expect(() => validateWaterbutlerActionUrl(`https://files.osf.io/v1/resources/other1/providers/osfstorage/`, GUID)).toThrow(OsfWriteError);
  });
});
