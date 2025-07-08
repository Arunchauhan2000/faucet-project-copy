const cron = require("node-cron");
const mongoose = require("mongoose");
const Wallet = require("../db/Wallet");
const { ethers } = require("ethers");
const { sendLowBalanceEmail } = require("./mailer");
require("dotenv").config();

const main = async () => {
  try {
    // 1. Script shuru hone par MongoDB se connect karein
    await mongoose.connect(process.env.MONGO_URI);
    console.log("✅ Mongo connected for balance monitor.");

    const provider = new ethers.JsonRpcProvider(process.env.RPC_URL);
    const lowBalanceThreshold = parseFloat(process.env.LOW_BALANCE_THRESHOLD_MONITOR || "0.1");
    const cronSchedule = process.env.CRON_SCHEDULE || "*/5 * * * *";

    // 2. Connection safal hone ke baad hi cron job schedule karein
    cron.schedule(cronSchedule, async () => {
      console.log("Running balance check cron job...");
      try {
        const wallets = await Wallet.find();
        for (const w of wallets) {
          const bal = await provider.getBalance(w.address);
          const balanceInEth = ethers.formatEther(bal);

          if (parseFloat(balanceInEth) < lowBalanceThreshold) {
            console.log(`Low balance detected for worker ${w.workerId} (${w.address}): ${balanceInEth} ETH. Sending alert.`);
            // Use the centralized mailer utility
            await sendLowBalanceEmail(w.workerId, w.address, balanceInEth);
          }
        }
        console.log("Balance check finished.");
      } catch (cronErr) {
        console.error("Error during balance check cron job:", cronErr);
      }
    });

    console.log(`Balance monitor cron job scheduled with schedule: "${cronSchedule}".`);
  } catch (err) {
    console.error("❌ Mongo connection failed for balance monitor:", err);
    process.exit(1);
  }
};

main();