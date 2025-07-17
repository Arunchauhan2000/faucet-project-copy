const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../.env") });
const express = require("express");
const axios = require("axios");
const mongoose = require("mongoose");
const cors = require("cors");
const { isAddress } = require("ethers");
const { connectQueue, getChannel, queueName } = require("../utils/queue");
const redisClient = require("../config/redisClient");

const app = express();

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

const CLIENT_ID = process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET;
const REDIRECT_URI = process.env.REDIRECT_URI;
const GUILD_ID = process.env.GUILD_ID;

// ✅ Rate Limit Middleware - Only on `to` address with 1 minute TTL
const rateLimitMiddleware = async (req, res, next) => {
  try {
    const { to } = req.body;

    if (!to) {
      return res.status(400).json({ error: "'to' address is required." });
    }

    const addressKey = `faucet:address:${to.toLowerCase()}`;
    const addressExists = await redisClient.get(addressKey);

    if (addressExists) {
      return res.status(429).json({ error: "⏳ This address has already claimed faucet in the last 1 minute." });
    }

    next();
  } catch (err) {
    console.error("❌ Rate limit error:", err);
    res.status(500).json({ error: "Internal server error during rate limit check." });
  }
};

// ✅ Fund Transfer Endpoint
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

    const addressKey = `faucet:address:${to.toLowerCase()}`;
    await redisClient.set(addressKey, "1", { EX: 60 }); // ✅ 1 minute rate limit

    res.json({
      success: true,
      message: "Your request has been queued. Please wait a few moments while we process your transaction."
    });
  } catch (err) {
    console.error("❌ Error during fund transfer:", err);
    res.status(500).json({ error: "Internal server error." });
  }
});

// ✅ Discord OAuth Callback
app.get("/auth/discord/callback", async (req, res) => {
  const code = req.query.code;

  try {
    const tokenRes = await axios.post(
      "https://discord.com/api/oauth2/token",
      new URLSearchParams({
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        grant_type: "authorization_code",
        code,
        redirect_uri: REDIRECT_URI,
        scope: "identify guilds",
      }),
      { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
    );

    const { access_token } = tokenRes.data;

    const userRes = await axios.get("https://discord.com/api/users/@me", {
      headers: { Authorization: `Bearer ${access_token}` },
    });

    const guildsRes = await axios.get("https://discord.com/api/users/@me/guilds", {
      headers: { Authorization: `Bearer ${access_token}` },
    });

    const isInGuild = guildsRes.data.some((guild) => guild.id === GUILD_ID);

    if (isInGuild) {
      res.redirect(`${process.env.CONFIG_URL}/faucet?verified=true`);
    } else {
      res.redirect(`${process.env.CONFIG_URL}/faucet?verified=false`);
    }

  } catch (err) {
    console.error("OAuth Error", err?.response?.data || err.message || err);
    res.redirect(`${process.env.CONFIG_URL}/faucet?error=oauth_failed`);
  }
});

// ✅ Start server
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
