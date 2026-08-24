import pg from 'pg';

const connectionString = 'postgres://postgres:Sa03146555!@plug_sales_dispatch_app_thsm_distribuidora_postgress:5432/plug_sales_dispatch_app?sslmode=disable';

const pool = new pg.Pool({ connectionString });

async function run() {
  console.log('Starting user database normalization and deduplication...');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Get all users
    const { rows: users } = await client.query('SELECT id, telefone, nome, email, endereco FROM usuarios');
    console.log(`Found ${users.length} total users.`);

    const toDelete = [];
    const toUpdatePhone = [];
    let mergedCount = 0;
    let updatedPhoneCount = 0;

    for (const user of users) {
      const phone = user.telefone;
      if (!phone.startsWith('55') && /^\d+$/.test(phone)) {
        const phone55 = '55' + phone;
        // Check if the 55 counterpart exists
        const counterpart = users.find(u => u.telefone === phone55);
        if (counterpart) {
          console.log(`Duplicate found for phone ${phone}:`);
          console.log(`  - Old User: ${user.nome} (ID: ${user.id}, Phone: ${phone})`);
          console.log(`  - New User: ${counterpart.nome} (ID: ${counterpart.id}, Phone: ${phone55})`);
          
          // Move orders from old user to new user
          const { rowCount: ordersMoved } = await client.query(
            'UPDATE pedidos SET user_id = $1 WHERE user_id = $2',
            [counterpart.id, user.id]
          );
          console.log(`    Moved ${ordersMoved} orders to the counterpart.`);

          // Mark old user for deletion
          toDelete.push(user.id);
          mergedCount++;
        } else {
          // No counterpart, we can safe-update this user's phone to include 55
          toUpdatePhone.push({ id: user.id, phone55 });
        }
      }
    }

    // Perform deletions of duplicate users
    if (toDelete.length > 0) {
      await client.query('DELETE FROM usuarios WHERE id = ANY($1)', [toDelete]);
      console.log(`Deleted ${toDelete.length} duplicate users.`);
    }

    // Perform phone updates
    for (const item of toUpdatePhone) {
      await client.query('UPDATE usuarios SET telefone = $1 WHERE id = $2', [item.phone55, item.id]);
      updatedPhoneCount++;
    }
    console.log(`Updated phone prefix for ${updatedPhoneCount} users.`);

    await client.query('COMMIT');
    console.log('Cleanup completed successfully.');
    console.log(`Merged duplicates: ${mergedCount}`);
    console.log(`Updated prefix: ${updatedPhoneCount}`);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error during cleanup:', err.message);
  } finally {
    client.release();
    await pool.end();
  }
}

run();
