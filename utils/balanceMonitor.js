const cron = require("node-cron");
const Wallet = require("../db/Wallet");
const { ethers } = require("ethers");
const nodemailer = require("nodemailer");
require("dotenv").config();

const provider = new ethers.JsonRpcProvider(process.env.RPC_URL);
const transporter = nodemailer.createTransport({
  service: process.env.SMTP_SERVICE,
  auth: { user: process.env.ALERT_EMAIL, pass: process.env.EMAIL_PASS }
});

cron.schedule("*/5 * * * *", async () => {
  const wallets = await Wallet.find();
  for (const w of wallets) {
    const bal = await provider.getBalance(w.address);
    const mnt = ethers.formatEther(bal);
    if (parseFloat(mnt) < 10000) {
      await transporter.sendMail({
        to: process.env.ALERT_EMAIL,
        subject: "Low Wallet Balance Alert",
        text: `Wallet ${w.address} has only ${mnt} MNT left.`
      });
    }
  }
});