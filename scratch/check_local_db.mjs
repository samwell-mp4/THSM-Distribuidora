import pg from 'pg';

const connectionString = 'postgres://postgres:Sa03146555!@localhost:5432/plug_sales_dispatch_app?sslmode=disable';

console.log('Testing connection to localhost...');
const pool = new pg.Pool({
  connectionString,
  connectionTimeoutMillis: 5000
});

try {
  const res = await pool.query('SELECT NOW()');
  console.log('Success! Connected. Database time:', res.rows[0]);

  // Check columns of usuarios
  const usuariosCols = await pool.query(`
    SELECT column_name, data_type 
    FROM information_schema.columns 
    WHERE table_name = 'usuarios'
  `);
  console.log('\nColumns in "usuarios" table:');
  usuariosCols.rows.forEach(row => {
    console.log(`- ${row.column_name} (${row.data_type})`);
  });

  // Check columns of produtos
  const produtosCols = await pool.query(`
    SELECT column_name, data_type 
    FROM information_schema.columns 
    WHERE table_name = 'produtos'
  `);
  console.log('\nColumns in "produtos" table:');
  produtosCols.rows.forEach(row => {
    console.log(`- ${row.column_name} (${row.data_type})`);
  });

} catch (err) {
  console.error('Failed to query localhost database:', err.message || err);
} finally {
  await pool.end();
}
