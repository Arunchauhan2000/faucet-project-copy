const { ethers } = require("ethers");
const { connectQueue, getChannel, queueName } = require("../utils/queue");
const mongoose = require("mongoose");
const { decryptText } = require("../utils/kmsUtils");
require("dotenv").config();

const startWorker = async () => {
  await connectQueue();
  const channel = getChannel();
  if (!channel) {
    console.log("RabbitMQ channel not ready, retrying in 5 seconds...");
    setTimeout(startWorker, 5000);
    return;
  }

  let faucetPrivateKey;
  try {
    // Retrieve the encrypted private key from environment variables
    console.log(process.env.FAUCET_PRIVATE_KEY);
    
    const encryptedPrivateKey = process.env.FAUCET_PRIVATE_KEY;
    if (!encryptedPrivateKey) throw new Error("FAUCET_PRIVATE_KEY environment variable is not set.");
    faucetPrivateKey = await decryptText(encryptedPrivateKey);
    console.log("✅ Faucet private key decrypted from KMS.");
  } catch (err) {
    console.error("❌ Failed to decrypt faucet private key from KMS:", err.message);
    process.exit(1); // Exit if we can't get the private key
  }

  // Provider and Signer can be created once and reused
  const provider = new ethers.JsonRpcProvider(process.env.RPC_URL);
  const signer = new ethers.Wallet(faucetPrivateKey, provider);

  console.log("🚀 Faucet worker running and listening to queue...");

  // Mongo connection
  mongoose.connect(process.env.MONGO_URI).then(() => console.log("Mongo connected")).catch(err => {
    console.error("Mongo connection failed:", err);
  });

  channel.prefetch(1);
  channel.consume(queueName, async (msg) => {
    if (msg === null) return;

    const { to, amount } = JSON.parse(msg.content.toString());

    try {
      const tx = await signer.sendTransaction({
        to,
        value: ethers.parseUnits(amount.toString(), 18),
      });

      console.log(`✅ Sent ${amount} to ${to}: ${tx.hash}`);
      channel.ack(msg);
    } catch (err) {
      console.error(`❌ Transfer failed for address ${to}:`, err.shortMessage || err.message);
      const errorMessage = (err.error?.message || err.message || "").toLowerCase();

      // A) Retryable nonce/concurrency errors
      if (errorMessage.includes("nonce") || errorMessage.includes("replacement transaction underpriced")) {
        console.log("ℹ️ Concurrency error detected. Re-queueing message for another attempt.");
        channel.nack(msg, false, true);
      // B) Duplicate transaction that is already pending
      } else if (errorMessage.includes("already known") || errorMessage.includes("tx already in mempool")) {
        console.log("ℹ️ Transaction was already submitted. Acknowledging message.");
        channel.ack(msg);
      // C) Other, likely permanent errors (out of gas, revert, etc.)
      } else {
        console.log("🛑 Unrecoverable error. Sending message to dead-letter queue.");
        channel.nack(msg, false, false);
      }
    }
  }, { noAck: false });
};

const gracefulShutdown = async () => {
  console.log('Received shutdown signal, closing worker connections...');
  try {
    const channel = getChannel();
    await Promise.all([
      mongoose.connection.close(false),
      channel ? channel.connection.close() : Promise.resolve(),
    ]);
    console.log('All worker connections closed gracefully.');
    process.exit(0);
  } catch (shutdownErr) {
    console.error('Error during worker graceful shutdown:', shutdownErr);
    process.exit(1);
  }
};

process.on('SIGINT', gracefulShutdown);
process.on('SIGTERM', gracefulShutdown);

startWorker();
