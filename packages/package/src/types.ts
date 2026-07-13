/**
 * The Z-CMS package format.
 *
 * A `.zcms` file is a gzipped tar containing exactly what a theme or plugin
 * needs to run — its manifest, its built bundle, its assets — and nothing else.
 * No source, no node_modules, no install scripts. A package is data, not a
 * program that runs on install.
 *
 * Two signatures travel with it, and they answer two different questions:
 *
 *   publisher signature   — "who wrote this?"        (the author's private key)
 *   marketplace signature — "did we let this in?"    (Z-SOFT's private key)
 *
 * The runtimes verify the MARKETPLACE signature, against a public key pinned in
 * their own config — not one fetched from the API. That is what preserves the
 * property we already had when bundles lived on disk: a compromised cms-api
 * cannot make a runtime execute code, because it cannot forge the signature.
 */

export type PackageKind = "theme" | "plugin";

export interface PackageManifest {
  /** Reverse-DNS id, e.g. "vn.zsoft.theme.corporate". */
  id: string;
  name: string;
  version: string;
  kind: PackageKind;
  description?: string;
  author: { name: string; url?: string };
  engine: string;
  /** Entry file inside the package, relative to its root. */
  entry: string;
  [key: string]: unknown;
}

/**
 * The signed envelope. Note what is signed: the DIGEST of the archive, not the
 * archive itself — so verification is cheap and the bytes can be streamed to
 * storage while the signature is checked.
 */
export interface PackageEnvelope {
  /** SHA-256 of the tar.gz payload, hex. */
  checksum: string;
  manifest: PackageManifest;
  /** Ed25519 signature over `checksum`, base64. */
  publisherSignature: string;
  /** Publisher's Ed25519 public key, SPKI PEM. */
  publisherKey: string;
  /** Added by the marketplace on acceptance. Absent until then. */
  marketplaceSignature?: string;
}

export interface SignedPackage {
  envelope: PackageEnvelope;
  /** The tar.gz bytes. */
  payload: Buffer;
}

export class PackageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PackageError";
  }
}
