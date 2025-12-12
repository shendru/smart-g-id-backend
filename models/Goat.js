const mongoose = require("mongoose");

const GoatSchema = new mongoose.Schema({
  // 1. Link to the Farmer (Owner)
  owner: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
  },

  // 2. Hardware Identification (from RFID Scan)
  rfidTag: { 
    type: String,
    required: true,
    unique: true, // Ensures unique ID per goat
    trim: true,
  },

  // 3. Basic Info (from Details Form)
  name: {
    type: String,
    required: true,
    trim: true,
  },
  gender: {
    type: String,
    enum: ["Male", "Female"], 
    required: true,
  },
  breed: {
    type: String,
    required: true,
  },
  birthDate: {
    type: Date,
    required: true,
  },

  // 4. Physical Metrics (from Sensors)
  weight: {
    type: Number,
    required: true,
  },
  height: {
    type: Number,
    required: true,
  },

  // 5. Health (Array of tags like ["Healthy", "Pregnant"])
  healthStatus: {
    type: [String], 
    default: ["Healthy"],
  },

  addedAt: {
    type: Date,
    default: Date.now,
  },
});

module.exports = mongoose.model("Goat", GoatSchema);