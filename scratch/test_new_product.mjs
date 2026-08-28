async function testNewProduct() {
  const payload = {
    action: 'upsert',
    table: 'produtos',
    args: {
      values: [{
        id: Math.floor(Math.random() * 1000000000),
        nome: "Produto Teste " + Date.now(),
        preco: 50.5,
        estoque: 10,
        categoria: "TESTE",
        variantes: {},
        semDevolucao: false
      }],
      options: { onConflict: 'id' }
    }
  };
  
  const res = await fetch('https://thsmdistribuidora.com/api/db', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const data = await res.json();
  console.log(JSON.stringify(data, null, 2));
}

testNewProduct();
