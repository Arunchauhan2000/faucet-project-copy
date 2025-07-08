const { KMSClient, EncryptCommand, DecryptCommand } = require("@aws-sdk/client-kms");
const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../.env") });


const client = new KMSClient({ region: process.env.AWS_REGION || "ap-south-1" });

const kmsKeyId = process.env.KMS_KEY_ID;

const encryptMnemonic = async (mnemonic) => {
  console.log("Encrypting mnemonic:", mnemonic);

  const command = new EncryptCommand({
    KeyId: kmsKeyId,
    Plaintext: Buffer.from(mnemonic, "utf-8"),
  });

  const response = await client.send(command);
// console.log(response,"respomse")
  if (!response.CiphertextBlob) throw new Error("Encryption failed: no ciphertext returned");

  return Buffer.from(response.CiphertextBlob).toString("base64");
};

const decryptMnemonic = async (encrypted) => {

  const command = new DecryptCommand({
    CiphertextBlob: Buffer.from(encrypted, "base64"),
  });

  const response = await client.send(command);

  if (!response.Plaintext) throw new Error("Decryption failed: no plaintext returned");

  return Buffer.from(response.Plaintext).toString("utf-8");
};
module.exports = {
  encryptMnemonic,
  decryptMnemonic,
};
