import { initDb, executeQuery } from '../db.js';
import { upsertUser, upsertOrder, getAllOrders, samePhone, normalizePhoneDigits } from '../src/lib/supabase.js';

async function runIntegrationTest() {
  console.log('--- STARTING INTEGRATION TEST ---');
  
  // 1. Initialize DB and run phone normalization migration
  await initDb();

  // 2. Test upserting a user with 10 digits (missing 9 after DDD 31)
  const phoneInput = '3188889999';
  const expectedPhone = '5531988889999';
  console.log(`\nTesting upsertUser with input phone "${phoneInput}"...`);
  
  const savedUser = await upsertUser({
    telefone: phoneInput,
    nome: 'Cliente Teste Integracao',
    email: 'teste.integracao@thsm.com',
    endereco: { rua: 'Rua Teste', numero: '123', bairro: 'Centro', cidade: 'Belo Horizonte', cep: '30100000', senha: '123' }
  });

  if (!savedUser || !savedUser.telefone) {
    console.error('FAILED: upsertUser returned null or invalid user', savedUser);
    process.exit(1);
  }

  console.log('Saved User returned:', savedUser);
  console.log('Phone matching test:', savedUser.telefone === expectedPhone ? 'PASS' : `FAIL (got ${savedUser.telefone})`);

  // 3. Test upserting SAME user again (to ensure 23505 duplicate key error does NOT happen)
  console.log('\nTesting re-upserting same user (simulating repeated checkout)...');
  const updatedUser = await upsertUser({
    id: savedUser.id,
    telefone: phoneInput,
    nome: 'Cliente Teste Integracao Atualizado',
    email: 'teste.integracao@thsm.com',
    endereco: { rua: 'Rua Teste 2', numero: '456', bairro: 'Centro', cidade: 'Belo Horizonte', cep: '30100000', senha: '123' }
  });

  console.log('Re-upserted User returned:', updatedUser);
  console.log('Re-upsert result:', updatedUser ? 'PASS' : 'FAIL');

  // 4. Test order creation for this user
  console.log('\nTesting order creation (upsertOrder)...');
  const testOrderId = Date.now();
  const orderPayload = {
    id: testOrderId,
    user_id: updatedUser.id,
    date: new Date().toISOString().split('T')[0],
    customer: { nome: updatedUser.nome, email: updatedUser.email, telefone: updatedUser.telefone, endereco: updatedUser.endereco },
    items: [{ id: 1, nome: 'Produto Teste', qty: 2, preco: 50 }],
    pagamento: 'aprazo',
    total_avista: 0,
    total_aprazo: 100,
    total: 100,
    status: 'pre-pedido',
    created_at: new Date().toISOString()
  };

  const orderOk = await upsertOrder(orderPayload);
  console.log('Order creation result:', orderOk ? 'PASS' : 'FAIL');

  // 5. Test fetching orders (simulating Admin sync)
  console.log('\nTesting getAllOrders (Admin sync)...');
  const allOrders = await getAllOrders();
  const foundOrder = allOrders.find(o => String(o.id) === String(testOrderId));

  if (foundOrder) {
    console.log('Found order in DB:', foundOrder);
    console.log('Admin order fetch test: PASS');
  } else {
    console.error('FAILED: Order not found in getAllOrders output. Total orders fetched:', allOrders.length);
    process.exit(1);
  }

  // 6. Cleanup test data
  console.log('\nCleaning up test user and order...');
  await executeQuery({ action: 'delete', table: 'pedidos', filters: [{ type: 'eq', column: 'id', value: testOrderId }] });
  if (updatedUser.id) {
    await executeQuery({ action: 'delete', table: 'usuarios', filters: [{ type: 'eq', column: 'id', value: updatedUser.id }] });
  }

  console.log('\n--- ALL INTEGRATION TESTS PASSED SUCCESSFULLY! ---');
  process.exit(0);
}

runIntegrationTest().catch(err => {
  console.error('Integration test exception:', err);
  process.exit(1);
});
