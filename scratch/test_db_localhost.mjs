import pg from 'pg';
pg.types.setTypeParser(pg.types.builtins.INT8, (val) => parseInt(val, 10));
pg.types.setTypeParser(pg.types.builtins.NUMERIC, (val) => parseFloat(val));
const connectionString = 'postgres://postgres:Sa03146555!@127.0.0.1:5432/plug_sales_dispatch_app?sslmode=disable';
const pool = new pg.Pool({ connectionString });

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
