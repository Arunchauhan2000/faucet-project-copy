// utils/kmsUtils.js
const {
    KMSClient,
    EncryptCommand,
    DecryptCommand,
  } = require('@aws-sdk/client-kms');
  
  const client = new KMSClient({ region: process.env.AWS_REGION });
  
  async function encryptText(plainText) {
    const command = new EncryptCommand({
      KeyId: process.env.KMS_KEY_ID,
      Plaintext: Buffer.from(plainText),
    });
  
    const response = await client.send(command);
    return response.CiphertextBlob.toString('base64');
  }
  
  async function decryptText(encryptedBase64) {
    const command = new DecryptCommand({
      CiphertextBlob: Buffer.from(encryptedBase64, 'base64'),
    });
  
    const response = await client.send(command);
    return response.Plaintext.toString();
  }
  
  module.exports = { encryptText, decryptText };
  