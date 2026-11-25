// CommonJS entry point for cPanel / Phusion Passenger.
process.chdir(__dirname);
import('./src/server.js').catch((error) => {
  console.error('Error collector startup failed:', error.message);
  process.exitCode = 1;
});
