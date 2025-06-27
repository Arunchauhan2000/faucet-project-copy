// config/redisClient.js

const redis = require("redis");

const client = redis.createClient({
  password: "uJpihuxKWjb4bx6gOAOc9Q0K7qWyUbXO",
  socket: {
    host: "redis-19065.c264.ap-south-1-1.ec2.redns.redis-cloud.com",
    port: 19065,
  },
  tls: {
    rejectUnauthorized: true,
  },
});

(async function redisConnect() {
  try {
    await client.connect();
    console.log("✅ Redis Client Successfully Connected");
  } catch (err) {
    console.error("❌ Failed to Connect to Redis:", err);
  }
})();

module.exports = client;
