const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../.env") });
const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const { isAddress } = require("ethers");
const { connectQueue, getChannel, queueName } = require("../utils/queue");
const redisClient = require("../config/redisClient");

const app = express();

// ✅ CORS middleware
app.use(cors({
  origin: "*", 
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH"],
  credentials: true
}));

app.use(express.json());

// ✅ MongoDB Connection
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log("✅ Mongo connected"))
  .catch((err) => console.error("❌ Mongo connection failed:", err));

// ✅ RabbitMQ Initialization
connectQueue();

// ✅ Rate Limit Middleware
const rateLimitMiddleware = async (req, res, next) => {
  try {
    const ip = req.headers["x-forwarded-for"] || req.connection.remoteAddress;
    const { to } = req.body;

    if (!to) {
      return res.status(400).json({ error: "'to' address is required." });
    }

    const ipKey = `faucet:ip:${ip}`;
    const addressKey = `faucet:address:${to.toLowerCase()}`;

    const [ipExists, addressExists] = await Promise.all([
      redisClient.get(ipKey),
      redisClient.get(addressKey),
    ]);

    if (ipExists) {
      return res.status(429).json({ error: "⏳ You have already claimed faucet from this IP in the last 24 hours." });
    }

    if (addressExists) {
      return res.status(429).json({ error: "⏳ This address has already claimed faucet in the last 24 hours." });
    }

    // Allow request to proceed
    next();

    // Set keys after request is processed
    redisClient.set(ipKey, "1", { EX: 86400 });
    redisClient.set(addressKey, "1", { EX: 86400 });

  } catch (err) {
    console.error("❌ Rate limit error:", err);
    res.status(500).json({ error: "Internal server error during rate limit check." });
  }
};

// ✅ Fund Transfer API with Rate Limit Middleware
app.post("/api/fund-transfer", rateLimitMiddleware, async (req, res) => {
  console.log(req.body);
  const { to, amount } = req.body;

  if (!to || amount === undefined) {
    return res.status(400).json({ error: "Request body must contain 'to' and 'amount'." });
  }

  if (!isAddress(to)) {
    return res.status(400).json({ error: "Invalid 'to' address provided." });
  }

  if (typeof amount !== "number" || amount <= 0) {
    return res.status(400).json({ error: "'amount' must be a positive number." });
  }

  const MAX_AMOUNT = parseFloat(process.env.FAUCET_MAX_AMOUNT) || 0.1;
  if (amount > MAX_AMOUNT) {
    return res.status(400).json({ error: `Amount exceeds the maximum limit of ${MAX_AMOUNT}.` });
  }

  try {
    const channel = getChannel();
    if (!channel) {
      return res.status(503).json({ error: "Service temporarily unavailable. Please try again later." });
    }

    channel.sendToQueue(
      queueName,
      Buffer.from(JSON.stringify({ to, amount })),
      { persistent: true }
    );

    res.json({
      success: true,
      message: "✅ Your request has been queued. Please wait while we process your transaction."
    });
  } catch (err) {
    console.error("❌ Error during fund transfer:", err);
    res.status(500).json({ error: "Internal server error." });
  }
});

// ✅ Start Server
const server = app.listen(process.env.PORT || 3000, "0.0.0.0", () => {
  console.log(`🚀 API listening on port ${process.env.PORT}`);
});

// ✅ Graceful Shutdown
const gracefulShutdown = async () => {
  console.log("🛑 Received shutdown signal, closing connections...");
  server.close(async (err) => {
    if (err) {
      console.error("❌ Error closing HTTP server:", err);
      process.exit(1);
    }

    try {
      const channel = getChannel();
      await Promise.all([
        mongoose.connection.close(false),
        redisClient.quit(),
        channel ? channel.connection.close() : Promise.resolve(),
      ]);
      console.log("✅ All connections closed gracefully.");
      process.exit(0);
    } catch (shutdownErr) {
      console.error("❌ Error during graceful shutdown:", shutdownErr);
      process.exit(1);
    }
  });
};

process.on("SIGINT", gracefulShutdown);
process.on("SIGTERM", gracefulShutdown);
