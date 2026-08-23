import pg from 'pg';

const connectionString = 'postgres://postgres:Sa03146555!@plug_sales_dispatch_app_thsm_distribuidora_postgress:5432/plug_sales_dispatch_app?sslmode=disable';

console.log('Testing connection to:', connectionString.replace(/:[^:]*@/, ':****@')); // Hide password in logs

const pool = new pg.Pool({
  connectionString,
  connectionTimeoutMillis: 5000
});

try {
  const res = await pool.query('SELECT NOW()');
  console.log('Success! Database time:', res.rows[0]);
} catch (err) {
  console.error('Failed to connect to database:', err);
} finally {
  await pool.end();
}
