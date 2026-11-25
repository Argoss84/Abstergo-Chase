// Entry point compatible with the cPanel Node.js application manager.
process.chdir(__dirname);
import('./src/server.js').catch((error) => {
  console.error('ServerBDD startup failed:', error.code ?? error.name);
  process.exitCode = 1;
});
