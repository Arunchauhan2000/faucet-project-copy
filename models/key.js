const mongoose = require('mongoose');
const { Schema } = mongoose;

const keySchema = new Schema({
  workerId: { type: Number, required: true, unique: true, index: true },
  encryptedKey: { type: String, required: true }
});

// Teesra argument 'keys' yeh sunishchit karta hai ki collection ka naam 'keys' hi ho.
module.exports = mongoose.model('Key', keySchema, 'keys');
