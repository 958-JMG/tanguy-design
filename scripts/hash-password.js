// Usage: node scripts/hash-password.js <password>
const bcrypt = require('bcrypt');
const pw = process.argv[2];
if (!pw) { console.error('Usage: node scripts/hash-password.js <password>'); process.exit(1); }
bcrypt.hash(pw, 10).then(h => console.log(h));
