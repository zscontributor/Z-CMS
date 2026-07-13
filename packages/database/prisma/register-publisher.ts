import fs from "node:fs";
import path from "node:path";
import { config as loadEnv } from "dotenv";

loadEnv({ path: path.resolve(__dirname, "../../../.env"), quiet: true });

import { getSystemDb, disconnectDb } from "../src/clients";

/**
 * Registers a publisher and the public key the marketplace will verify their
 * packages against.
 *
 * This stands in for the publisher-account flow: sign up, prove who you are,
 * upload a public key. The key is the part that matters — from here on,
 * "is this package really from them?" is a signature check, not a judgement call.
 *
 *   tsx prisma/register-publisher.ts <slug> <name> <public-key.pem>
 */
async function main() {
  const [slug, name, keyPath] = process.argv.slice(2);

  if (!slug || !name || !keyPath) {
    console.error("Usage: register-publisher <slug> <name> <public-key.pem>");
    process.exitCode = 1;
    return;
  }

  const publicKey = fs.readFileSync(keyPath, "utf8").trim();
  const db = getSystemDb();

  const publisher = await db.publisher.upsert({
    where: { slug },
    update: { name, publicKey, verified: true },
    create: { slug, name, publicKey, verified: true },
  });

  console.log(`Publisher "${publisher.name}" (${publisher.slug}) registered.`);
  console.log(`  public key: ${publicKey.split("\n")[1]?.slice(0, 32)}…`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(disconnectDb);
