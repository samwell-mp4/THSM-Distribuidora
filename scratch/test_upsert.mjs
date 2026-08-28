async function testUpsert() {
  const payload = {
    action: 'upsert',
    table: 'produtos',
    args: {
      values: [{
        id: 448643454,
        nome: "Teste Upsert 2",
        estoque: 99,
        _new: true,
        extra: 'campo_extra'
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

testUpsert();
