const { createClient } = require('redis');
const { encryptMnemonic } = require('../utils/kmsUtils');

require('dotenv').config();

const run = async () => {
  const client = createClient();
  await client.connect();

  const mnemonic = process.env.MNEMONIC_PLAIN;

  if (!mnemonic) {
    console.error('❌ MNEMONIC_PLAIN not set in .env');
    process.exit(1);
  }

  try {
    console.log(`Encrypting mnemonic: ${mnemonic}`);
    const encryptedMnemonic = await encryptMnemonic(mnemonic);

    await client.set('ENCRYPTED_MNEMONIC', encryptedMnemonic);
    console.log('✅ Encrypted mnemonic stored in Redis.');
  } catch (err) {
    console.error('❌ Failed to encrypt and store mnemonic:', err);
  } finally {
    await client.quit();
  }
};

run();
