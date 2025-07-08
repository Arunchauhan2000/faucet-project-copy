const nodemailer = require('nodemailer');
require('dotenv').config();

const transportOptions = {
  auth: {
    user: process.env.MAIL_USER,
    pass: process.env.MAIL_PASS,
  },
};

if (process.env.MAIL_SERVICE) {
  transportOptions.service = process.env.MAIL_SERVICE;
} else if (process.env.MAIL_HOST) {
  transportOptions.host = process.env.MAIL_HOST;
  transportOptions.port = parseInt(process.env.MAIL_PORT || '587', 10);
  transportOptions.secure = transportOptions.port === 465;
} else {
  // Agar service ya host configure nahi hai to spasht error dein.
  throw new Error('Nodemailer is not configured. Please set either MAIL_SERVICE or MAIL_HOST in your .env file.');
}

const transporter = nodemailer.createTransport(transportOptions);

transporter.verify(function (error, success) {
  if (error) {
    console.error("❌ Nodemailer configuration error:", error);
  } else {
    console.log("✅ Nodemailer is configured correctly. Server is ready to take our messages.");
  }
});

const sendLowBalanceEmail = async (workerId, address, balance) => {
  const mailOptions = {
    // Use MAIL_FROM if set, otherwise default to MAIL_USER
    from: process.env.MAIL_FROM || `"Faucet Alert" <${process.env.MAIL_USER}>`,
    to: process.env.MAIL_TO,
    subject: `Faucet Worker ${workerId} Low Balance Alert!`,
    text: `Worker ${workerId} with address ${address} has a low balance: ${balance} ETH. Please refill.`,
    html: `
      <p><b>Warning:</b> Faucet Worker #${workerId} has a low balance.</p>
      <p><b>Address:</b> ${address}</p>
      <p><b>Current Balance:</b> ${balance} ETH</p>
      <p>Please refill the wallet to ensure the faucet continues to operate smoothly.</p>
    `,
  };

  try {
    const info = await transporter.sendMail(mailOptions);
    console.log(`✅ Alert email sent successfully to ${process.env.MAIL_TO}: ${info.messageId}`);
  } catch (error) {
    console.error(`❌ Error sending low balance email for worker ${workerId}:`, error);
  }
};

module.exports = { sendLowBalanceEmail };