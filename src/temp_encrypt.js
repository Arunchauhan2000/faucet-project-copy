const { encryptText } = require('./utils/kmsUtils');
require('dotenv').config();

async function run() {
    // This script reads the plain-text private key from your .env file
    // and encrypts it using AWS KMS.
    const plainTextPrivateKey = process.env.FAUCET_PRIVATE_KEY;

    if (!plainTextPrivateKey || plainTextPrivateKey.length < 64) {
        console.error("❌ Error: FAUCET_PRIVATE_KEY is not set or is invalid in your .env file.");
        console.error("Please ensure it's a valid plain-text private key before running this script.");
        return;
    }

    try {
        const encryptedKey = await encryptText(plainTextPrivateKey);
        console.log("✅ Encryption successful!");
        console.log("\nCopy this encrypted key and update your .env file:\n");
        console.log(encryptedKey);
        console.log("\nThen, you can safely delete this script.");
    } catch (error) {
        console.error("❌ Encryption failed:", error.message);
        console.error("Please check your AWS credentials, region, and KMS_KEY_ID in the .env file.");
    }
}

run();