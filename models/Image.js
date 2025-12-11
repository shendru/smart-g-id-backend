const mongoose = require("mongoose");

const ImageSchema = new mongoose.Schema({
  goatId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Goat", // This links the Image to a specific Goat
    required: false, // We can make this false for now while testing
  },
  filename: {
    type: String,
    required: true,
  },
  imageUrl: {
    type: String,
    required: true,
  },
  notes: String,
  uploadedAt: {
    type: Date,
    default: Date.now,
  },
});

module.exports = mongoose.model("Image", ImageSchema);
