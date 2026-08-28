async function updatePasswords() {
  console.log('Fetching all users from production API...');
  
  // 1. Fetch all users
  const res = await fetch('https://thsmdistribuidora.com/api/db', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'select',
      table: 'usuarios'
    })
  });
  
  const result = await res.json();
  if (result.error) {
    console.error('Error fetching users:', result.error);
    return;
  }
  
  const users = result.data || [];
  console.log(`Found ${users.length} users. Updating passwords to 1234...`);
  
  // 2. Update each user
  let updatedCount = 0;
  for (let i = 0; i < users.length; i++) {
    const user = users[i];
    const endereco = user.endereco || {};
    endereco.senha = '1234';
    
    try {
      const updateRes = await fetch('https://thsmdistribuidora.com/api/db', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'upsert',
          table: 'usuarios',
          args: {
            values: { 
              telefone: user.telefone, 
              nome: user.nome, 
              email: user.email,
              endereco: endereco 
            },
            options: { onConflict: 'telefone' }
          },
          single: true
        })
      });
      
      const updateResult = await updateRes.json();
      if (updateResult.error) {
        console.error(`Failed to update user ${user.telefone}:`, updateResult.error);
      } else {
        updatedCount++;
        if (updatedCount % 50 === 0) {
          console.log(`Updated ${updatedCount}/${users.length} users...`);
        }
      }
    } catch (e) {
      console.error(`Exception updating user ${user.telefone}:`, e.message);
    }
  }
  
  console.log(`Successfully updated ${updatedCount} out of ${users.length} users.`);
}

updatePasswords();
