import { pool } from '../db.js';

async function test() {
  try {
    const res = await pool.query('SELECT count(*) FROM produtos');
    console.log('Total produtos in DB:', res.rows[0].count);
  } catch (err) {
    console.error('Error connecting to DB:', err);
  } finally {
    await pool.end();
  }
}
test();
