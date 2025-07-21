const { ethers } = require("ethers");
const Key = require('../models/key');
const Wallet = require('../db/Wallet');
const { connectQueue, getChannel, queueName } = require("../utils/queue");
const mongoose = require("mongoose");
const { decryptMnemonic } = require("../utils/kmsUtils");
const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../.env") });

const NUM_WORKERS = 5;
console.log("ℹ️ RPC URL and KMS key ID loaded.");

const startWorker = async () => {
  let channel;
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log("✅ Mongo connected");

    await connectQueue();
    channel = getChannel();
    if (!channel) {
      console.log("⚠️ RabbitMQ channel not ready, retrying in 5 seconds...");
      setTimeout(startWorker, 5000);
      return;
    }
  } catch (err) {
    console.error("❌ Initial setup failed (Mongo or RabbitMQ):", err);
    process.exit(1);
  }

  const workers = [];

  for (let i = 1; i <= NUM_WORKERS; i++) {
    try {
      const keyRecord = await Key.findOne({ workerId: i });
      if (!keyRecord || !keyRecord.encryptedKey) {
        console.warn(`⚠️ No encrypted key for worker ${i}, skipping`);
        continue;
      }

      const decryptedKey = await decryptMnemonic(keyRecord.encryptedKey);
      const provider = new ethers.JsonRpcProvider(process.env.RPC_URL);
      const signer = new ethers.Wallet(decryptedKey, provider);

      await Wallet.findOneAndUpdate(
        { workerId: i },
        { address: signer.address, workerId: i },
        { upsert: true, new: true }
      );

      workers.push({ id: i, signer });
      console.log(`✅ Worker ${i} initialized with address ${signer.address}`);
    } catch (err) {
      console.error(`❌ Worker ${i} initialization failed:`, err.message);
    }
  }

  if (workers.length === 0) {
    console.error("❌ No valid workers initialized. Exiting...");
    process.exit(1);
  }

  channel.prefetch(workers.length);

  let currentIndex = 0;
  channel.consume(queueName, async (msg) => {
    if (msg === null) return;

    const { to, amount } = JSON.parse(msg.content.toString());
    const worker = workers[currentIndex];
    currentIndex = (currentIndex + 1) % workers.length;

    try {
      const tx = await worker.signer.sendTransaction({
        to,
        value: ethers.parseUnits(amount.toString(), 18),
      });

      console.log(`✅ [Worker ${worker.id}] Sent ${amount} to ${to}: ${tx.hash}`);
      channel.ack(msg);
    } catch (err) {
      console.error(`❌ [Worker ${worker.id}] Transfer failed for ${to}:`, err.shortMessage || err.message);
      const errorMessage = (err.error?.message || err.message || "").toLowerCase();

      if (errorMessage.includes("nonce") || errorMessage.includes("replacement transaction underpriced")) {
        console.log(`ℹ️ [Worker ${worker.id}] Concurrency error. Re-queuing...`);
        channel.nack(msg, false, true);
      } else if (errorMessage.includes("already known") || errorMessage.includes("tx already in mempool")) {
        console.log(`ℹ️ [Worker ${worker.id}] Duplicate transaction. Acknowledging.`);
        channel.ack(msg);
      } else {
        console.log(`🛑 [Worker ${worker.id}] Unrecoverable error. Sending to dead-letter queue.`);
        channel.nack(msg, false, false);
      }
    }
  }, { noAck: false });

  console.log(`🚀 Faucet workers (${workers.length}) running and listening to queue...`);
};

const gracefulShutdown = async () => {
  console.log('🛑 Received shutdown signal, closing connections...');
  try {
    const channel = getChannel();
    await Promise.all([
      mongoose.connection.close(false),
      channel ? channel.connection.close() : Promise.resolve(),
    ]);
    console.log('✅ Shutdown complete.');
    process.exit(0);
  } catch (shutdownErr) {
    console.error('❌ Shutdown error:', shutdownErr);
    process.exit(1);
  }
};

process.on('SIGINT', gracefulShutdown);
process.on('SIGTERM', gracefulShutdown);

startWorker();
