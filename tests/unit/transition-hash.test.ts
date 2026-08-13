// Streaming digests.
//
// Calibrated against KNOWN GROUND TRUTH — the published MD5/SHA-256 of the empty string
// and of "abc" — not merely against itself. A hasher that is self-consistent but wrong
// would verify every transfer against a hash nobody else computes, and the whole
// verification chain would agree with itself while disagreeing with reality.

import { describe, it, expect } from "vitest";
import { DualHasher, hashBytes, hashText, hashStream } from "@/lib/transition/hash";

// RFC 1321 / FIPS 180-4 published values.
const EMPTY_MD5 = "d41d8cd98f00b204e9800998ecf8427e";
const EMPTY_SHA = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
const ABC_MD5 = "900150983cd24fb0d6963f7d28e17f72";
const ABC_SHA = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";

function streamOf(chunks: Uint8Array[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      for (const c of chunks) controller.enqueue(c);
      controller.close();
    },
  });
}

const enc = (s: string) => new TextEncoder().encode(s);

describe("known-answer tests", () => {
  it("matches the published digests of the empty input", async () => {
    expect(await hashText("")).toEqual({ md5: EMPTY_MD5, sha256: EMPTY_SHA });
  });

  it("matches the published digests of \"abc\"", async () => {
    expect(await hashText("abc")).toEqual({ md5: ABC_MD5, sha256: ABC_SHA });
  });
});

describe("chunking must not change the result", () => {
  it("gives the same digest whether fed in one chunk or many", async () => {
    // The defect this catches: a hasher that resets, or drops a chunk boundary, produces
    // a stable-looking digest that differs from everyone else's.
    const whole = await hashBytes(enc("abc"));
    const streamed = await hashStream(streamOf([enc("a"), enc("b"), enc("c")]));
    expect(streamed.md5).toBe(whole.md5);
    expect(streamed.sha256).toBe(whole.sha256);
    expect(streamed).toMatchObject({ md5: ABC_MD5, sha256: ABC_SHA });
  });

  it("handles a chunk crossing a block boundary", async () => {
    const big = enc("x".repeat(1000));
    const one = await hashBytes(big);
    const many = await hashStream(streamOf([big.slice(0, 37), big.slice(37, 999), big.slice(999)]));
    expect(many.sha256).toBe(one.sha256);
    expect(many.md5).toBe(one.md5);
  });

  it("ignores empty chunks without corrupting the digest", async () => {
    const r = await hashStream(streamOf([enc("a"), new Uint8Array(0), enc("bc")]));
    expect(r.sha256).toBe(ABC_SHA);
  });
});

describe("byte accounting", () => {
  it("reports the exact number of bytes hashed", async () => {
    const r = await hashStream(streamOf([enc("hello"), enc(" world")]));
    expect(r.byteLength).toBe(11);
  });

  it("reports 0 for an empty stream, with the empty digests", async () => {
    const r = await hashStream(streamOf([]));
    expect(r.byteLength).toBe(0);
    expect(r.md5).toBe(EMPTY_MD5);
  });

  it("tracks progress as it goes", async () => {
    const seen: number[] = [];
    await hashStream(streamOf([enc("ab"), enc("cd")]), (n) => seen.push(n));
    expect(seen).toEqual([2, 4]);
  });
});

describe("DualHasher misuse is loud", () => {
  it("throws if updated after digest, rather than hashing a prefix silently", async () => {
    // A digest that quietly describes only part of a file is exactly the kind of
    // plausible-but-wrong value the verification chain would then confirm.
    const h = await DualHasher.create();
    h.update(enc("abc"));
    h.digest();
    expect(() => h.update(enc("more"))).toThrow(/after digest/i);
  });

  it("exposes byteLength before finalising", async () => {
    const h = await DualHasher.create();
    h.update(enc("abcd"));
    expect(h.byteLength).toBe(4);
  });
});
