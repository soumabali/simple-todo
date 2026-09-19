import { Pool } from "pg";

// Dev-branch cleanup: remove the throwaway verification account + its board.
const pool = new Pool({ connectionString: process.env.DATABASE_URL!, max: 2 });
const q = (s: string, p?: unknown[]) => pool.query(s, p);

async function main() {
  const email = "gantt-dev@example.test";
  const u = await q(`select id from "user" where email = $1`, [email]);
  if (u.rowCount === 0) {
    console.log("no test user — nothing to clean");
    await pool.end();
    return;
  }
  const userId = u.rows[0].id;

  const boards = await q(`select id from boards where user_id = $1`, [userId]);
  for (const b of boards.rows) {
    await q(`delete from tasks where board_id = $1`, [b.id]).catch(() => {});
    await q(`delete from statuses where board_id = $1`, [b.id]).catch(() => {});
    await q(`delete from boards where id = $1`, [b.id]).catch(() => {});
  }
  await q(`delete from session where user_id = $1`, [userId]).catch(() => {});
  await q(`delete from account where user_id = $1`, [userId]).catch(() => {});
  await q(`delete from "user" where id = $1`, [userId]).catch(() => {});

  const left = await q(`select count(*)::int c from "user" where email = $1`, [email]);
  console.log(`cleaned: boards=${boards.rowCount}, test users left=${left.rows[0].c}`);
  await pool.end();
}

main().catch(async (e) => {
  console.error("cleanup failed:", e.message);
  await pool.end();
  process.exit(1);
});
