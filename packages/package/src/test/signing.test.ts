import { describe, expect, it } from "vitest";
import {
  generateKeyPair,
  sha256,
  signChecksum,
  verifyChecksumSignature,
  verifyPackage,
  verifyPublisher,
} from "../signing";
import { PackageError, type PackageEnvelope, type PackageManifest } from "../types";

/**
 * REFERENCE SUITE — the shape every test file in this repo follows.
 * See docs/testing.md. In short:
 *
 *   - one `describe` per exported symbol, named exactly like the symbol;
 *   - test names read as a sentence about behaviour ("rejects a package whose
 *     payload changed after signing"), never as a restatement of the code
 *     ("returns false");
 *   - a security test asserts that the ATTACK FAILS, and is written from the
 *     attacker's side: build the forgery, then prove it is refused.
 */

const MANIFEST: PackageManifest = {
  id: "vn.zsoft.theme.corporate",
  name: "Corporate",
  version: "1.0.0",
  kind: "theme",
  author: { name: "Z-SOFT" },
  engine: ">=0.1.0",
  entry: "dist/index.js",
};

/** A released package: publisher signed it, then the marketplace vouched for it. */
function releasedPackage(payload = Buffer.from("the real theme bytes")) {
  const publisher = generateKeyPair();
  const marketplace = generateKeyPair();
  const checksum = sha256(payload);

  const envelope: PackageEnvelope = {
    checksum,
    manifest: MANIFEST,
    publisherSignature: signChecksum(checksum, publisher.privateKey),
    publisherKey: publisher.publicKey,
    marketplaceSignature: signChecksum(checksum, marketplace.privateKey),
  };

  return { envelope, payload, publisher, marketplace };
}

describe("generateKeyPair", () => {
  it("returns a PKCS#8 private key and an SPKI public key", () => {
    const { privateKey, publicKey } = generateKeyPair();

    expect(privateKey).toContain("-----BEGIN PRIVATE KEY-----");
    expect(publicKey).toContain("-----BEGIN PUBLIC KEY-----");
  });

  it("never returns the same key twice", () => {
    expect(generateKeyPair().publicKey).not.toBe(generateKeyPair().publicKey);
  });
});

describe("sha256", () => {
  it("is stable for the same bytes", () => {
    expect(sha256(Buffer.from("abc"))).toBe(sha256(Buffer.from("abc")));
  });

  it("changes when a single byte changes", () => {
    expect(sha256(Buffer.from("abc"))).not.toBe(sha256(Buffer.from("abd")));
  });

  it("matches the known SHA-256 of an empty input", () => {
    expect(sha256(Buffer.alloc(0))).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
  });
});

describe("signChecksum / verifyChecksumSignature", () => {
  it("verifies a signature made by the matching private key", () => {
    const { privateKey, publicKey } = generateKeyPair();
    const checksum = sha256(Buffer.from("payload"));

    const signature = signChecksum(checksum, privateKey);

    expect(verifyChecksumSignature(checksum, signature, publicKey)).toBe(true);
  });

  it("refuses a signature made by a different key", () => {
    const author = generateKeyPair();
    const attacker = generateKeyPair();
    const checksum = sha256(Buffer.from("payload"));

    const forged = signChecksum(checksum, attacker.privateKey);

    expect(verifyChecksumSignature(checksum, forged, author.publicKey)).toBe(false);
  });

  it("refuses a valid signature presented over a different checksum", () => {
    const { privateKey, publicKey } = generateKeyPair();
    const signature = signChecksum(sha256(Buffer.from("original")), privateKey);

    const otherChecksum = sha256(Buffer.from("swapped"));

    expect(verifyChecksumSignature(otherChecksum, signature, publicKey)).toBe(false);
  });

  it("reports a malformed public key as a failed verification, not a crash", () => {
    // This input arrives from a stranger. Throwing here would turn a bad package
    // into a way to kill the process that inspects it.
    const { privateKey } = generateKeyPair();
    const checksum = sha256(Buffer.from("payload"));
    const signature = signChecksum(checksum, privateKey);

    expect(verifyChecksumSignature(checksum, signature, "not a pem")).toBe(false);
  });

  it("reports a malformed signature as a failed verification, not a crash", () => {
    const { publicKey } = generateKeyPair();

    expect(
      verifyChecksumSignature(sha256(Buffer.from("x")), "!!!not-base64!!!", publicKey),
    ).toBe(false);
  });

  it("fails when signing with something that is not a private key", () => {
    expect(() => signChecksum("abc", "-----BEGIN PRIVATE KEY-----\nrubbish\n")).toThrow(
      PackageError,
    );
  });
});

describe("verifyPackage", () => {
  it("accepts a package the marketplace signed, checked against the pinned key", () => {
    const { envelope, payload, marketplace } = releasedPackage();

    expect(() => verifyPackage(envelope, payload, marketplace.publicKey)).not.toThrow();
  });

  it("rejects a payload that was modified after it was signed", () => {
    const { envelope, marketplace } = releasedPackage();

    const backdoored = Buffer.from("the real theme bytes + a backdoor");

    expect(() => verifyPackage(envelope, backdoored, marketplace.publicKey)).toThrow(
      /Checksum mismatch/,
    );
  });

  it("rejects a package that has not been signed by the marketplace", () => {
    // A publisher-signed package that never went through review. It is perfectly
    // authentic and must still not run.
    const { envelope, payload, marketplace } = releasedPackage();
    delete envelope.marketplaceSignature;

    expect(() => verifyPackage(envelope, payload, marketplace.publicKey)).toThrow(
      /has not been signed by the marketplace/,
    );
  });

  it("rejects a package signed by a key the runtime does not pin", () => {
    // THE ATTACK THIS FUNCTION EXISTS FOR. An attacker who owns cms-api can serve
    // any bytes and any envelope — including one signed by a key they generated.
    // The runtime pins the real marketplace key in its own config, so the forgery
    // has nothing to hide behind.
    const payload = Buffer.from("backdoored theme");
    const checksum = sha256(payload);
    const attacker = generateKeyPair();
    const realMarketplace = generateKeyPair();

    const forged: PackageEnvelope = {
      checksum,
      manifest: MANIFEST,
      publisherSignature: signChecksum(checksum, attacker.privateKey),
      publisherKey: attacker.publicKey,
      marketplaceSignature: signChecksum(checksum, attacker.privateKey),
    };

    expect(() => verifyPackage(forged, payload, realMarketplace.publicKey)).toThrow(
      /not released by Z-CMS/,
    );
  });

  it("rejects a package whose signature is valid but over someone else's checksum", () => {
    // Signature-splicing: lift the marketplace signature off a genuine release and
    // staple it to a hostile payload. The checksum in the envelope must describe
    // the bytes, and the signature must describe that checksum — both, or neither.
    const genuine = releasedPackage(Buffer.from("genuine"));
    const hostile = Buffer.from("hostile");

    const spliced: PackageEnvelope = {
      ...genuine.envelope,
      checksum: sha256(hostile), // matches the bytes we are shipping...
      // ...but the lifted signature still covers the GENUINE checksum.
    };

    expect(() =>
      verifyPackage(spliced, hostile, genuine.marketplace.publicKey),
    ).toThrow(/not released by Z-CMS/);
  });

  it("throws PackageError, so callers can tell a refusal from a crash", () => {
    const { envelope, marketplace } = releasedPackage();

    expect(() =>
      verifyPackage(envelope, Buffer.from("other"), marketplace.publicKey),
    ).toThrow(PackageError);
  });
});

describe("verifyPublisher", () => {
  it("accepts a package signed by the key in its own envelope", () => {
    const { envelope, payload } = releasedPackage();

    expect(() => verifyPublisher(envelope, payload)).not.toThrow();
  });

  it("rejects a payload that does not match the declared checksum", () => {
    const { envelope } = releasedPackage();

    expect(() => verifyPublisher(envelope, Buffer.from("swapped"))).toThrow(
      /does not match the package contents/,
    );
  });

  it("rejects a signature that was not made by the declared publisher key", () => {
    // Someone re-uploading another author's package under their own key: the key
    // and the signature must belong to each other.
    const { envelope, payload } = releasedPackage();
    const impostor = generateKeyPair();

    const stolen: PackageEnvelope = {
      ...envelope,
      publisherKey: impostor.publicKey,
    };

    expect(() => verifyPublisher(stolen, payload)).toThrow(/Invalid publisher signature/);
  });
});
