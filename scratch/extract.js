import fs from 'fs';
const lines = fs.readFileSync('C:/Users/Usuario/.gemini/antigravity-ide/brain/0673bd49-b020-4352-b193-b011c8b4f2e7/.system_generated/logs/transcript.jsonl', 'utf-8').split('\n');
for (let i = lines.length - 1; i >= 0; i--) {
  if (!lines[i]) continue;
  try {
    const entry = JSON.parse(lines[i]);
    if (entry.type === 'USER_INPUT' && entry.content && entry.content.includes('18:39:49.577+00')) {
      fs.writeFileSync('scratch/user_prompt.txt', entry.content);
      console.log('Saved to scratch/user_prompt.txt');
      break;
    }
  } catch (e) {}
}
