import { hashPassword } from '../src/modules/admin/security.js';

try {
  process.stdin.setEncoding('utf8');
  let input = '';
  for await (const chunk of process.stdin) {
    input += chunk.toString();
    if (input.length > 258) throw new Error('Mot de passe trop long.');
  }
  const password = input.replace(/\r?\n$/, '');
  console.log(await hashPassword(password));
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
