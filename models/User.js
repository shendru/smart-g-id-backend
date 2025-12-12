const mongoose = require("mongoose");

const UserSchema = new mongoose.Schema({
  email: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    lowercase: true,
  },
  password: {
    type: String,
    required: true,
  },
  // === NEW FIELDS ===
  farmName: {
    type: String,
    required: true,
    trim: true,
  },
  address: {
    type: String,
    required: true, // Now Mandatory
    trim: true,
  },
  // ==================
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

module.exports = mongoose.model("User", UserSchema);