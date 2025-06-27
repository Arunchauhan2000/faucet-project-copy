const Redis = require("ioredis");
const redis = new Redis(process.env.REDIS_URL); // Connection starts here
module.exports = redis;
