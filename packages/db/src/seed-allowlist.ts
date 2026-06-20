import postgres from "postgres";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is required");
  const email = (process.argv[2] ?? process.env.SEED_EMAIL ?? "").trim().toLowerCase();
  if (!email) throw new Error("Usage: bun run src/seed-allowlist.ts <email>");

  const sql = postgres(url, { max: 1, onnotice: () => {} });
  await sql`INSERT INTO access_allowlist (email) VALUES (${email}) ON CONFLICT DO NOTHING`;
  await sql.end();
  console.log(`✅ allowlisted ${email}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
