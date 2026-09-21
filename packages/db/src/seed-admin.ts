import { hash } from "@node-rs/argon2";
import { db } from "./client.js";

async function main(): Promise<void> {
  const email = process.env.ADMIN_EMAIL?.toLowerCase();
  const password = process.env.ADMIN_PASSWORD;
  if (!email || !password) throw new Error("ADMIN_EMAIL and ADMIN_PASSWORD must be set to seed the admin account");
  if (password.length < 12) throw new Error("ADMIN_PASSWORD must be at least 12 characters");

  const passwordHash = await hash(password);
  await db.$transaction([
    db.adminCredential.upsert({ where: { email }, create: { email, passwordHash }, update: { passwordHash } }),
    db.user.upsert({ where: { email }, create: { email, role: "ADMIN" }, update: { role: "ADMIN" } })
  ]);
  console.log(`Admin account ready for ${email}`);
}

main().then(() => process.exit(0)).catch((error) => { console.error(error); process.exit(1); });
