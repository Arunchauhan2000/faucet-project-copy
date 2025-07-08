const amqp = require("amqplib");

let connection = null;
let channel = null;
const mainQueue = "faucetQueue";
const dlxName = "faucet-dlx"; // Dead-letter exchange
const dlqName = "faucet-dlq"; // Dead-letter queue

async function connectQueue() {
  // If already connected, do nothing.
  if (connection) return;

  try {
    console.log("Connecting to RabbitMQ...");
    connection = await amqp.connect(process.env.RABBIT_URL);

    connection.on("error", (err) => {
      console.error("[AMQP] connection error", err.message);
    });

    connection.on("close", () => {
      console.error("[AMQP] connection closed. Attempting to reconnect in 5s...");
      // Reset state and attempt to reconnect
      connection = null;
      channel = null;
      setTimeout(connectQueue, 5000);
    });

    channel = await connection.createChannel();

    await channel.assertExchange(dlxName, 'direct', { durable: true });
    await channel.assertQueue(dlqName, { durable: true });
    await channel.bindQueue(dlqName, dlxName, ''); 
    await channel.assertQueue(mainQueue, {
      durable: true,
      arguments: { 'x-dead-letter-exchange': dlxName }
    });

    console.log("✅ RabbitMQ connected and channel created.");
  } catch (err) {
    console.error("❌ Failed to connect to RabbitMQ during setup:", err.message);
    if (connection) {
      // If connection was partially established, close it.
      // The 'on.close' event handler will manage the reconnection attempt.
      await connection.close().catch(closeErr => console.error("[AMQP] Error closing failed connection:", closeErr));
    } else {
      // If connection was never established, retry directly.
      console.log("Retrying RabbitMQ connection in 5s...");
      setTimeout(connectQueue, 5000);
    }
  }
}

const getChannel = () => channel;

module.exports = { connectQueue, getChannel, queueName: mainQueue };