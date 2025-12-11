const express = require("express");
const mongoose = require("mongoose");
const multer = require("multer");
const fs = require("fs");
const path = require("path");

require("dotenv").config();

// --- MI MODELS --- //
const User = require("./models/User");
const Goat = require("./models/Goat");
const Image = require("./models/Image");

const app = express();
const PORT = 5000;

app.use(express.json());
app.use("/uploads", express.static("uploads")); // Allows you to view images in the browser

const mongoString = process.env.MONGO_URI;

mongoose
  .connect(mongoString)
  .then(() => console.log("✅ Connected to MongoDB Cloud (Atlas)!"))
  .catch((err) => console.log("❌ Cloud Connection Error:", err));

// --- 4. MULTER CONFIG (Image Storage) ---
// Ensure uploads folder exists
if (!fs.existsSync("./uploads")) {
  fs.mkdirSync("./uploads");
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, "uploads/");
  },
  filename: (req, file, cb) => {
    // Save file as "timestamp_filename.jpg"
    cb(null, Date.now() + "_" + file.originalname);
  },
});
const upload = multer({ storage: storage });

// --- ROUTES (The API Endpoints) ---

app.get("/", (req, res) => {
  res.send("Backend is successfully running!");
});

// A. Create a New User (Farmer)
app.post("/register", async (req, res) => {
  try {
    const newUser = new User(req.body); // Create user from the data sent
    await newUser.save();
    res.status(201).json(newUser);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// B. Add a New Goat
app.post("/add-goat", async (req, res) => {
  try {
    const newGoat = new Goat(req.body);
    await newGoat.save();
    res.status(201).json(newGoat);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// C. Upload Image for a Goat
app.post("/upload", upload.single("imageFile"), async (req, res) => {
  try {
    // We expect the ESP32 or Frontend to send the 'goatId' along with the image
    // If testing with HTML, we might not have goatId yet, so we make it optional in code
    const newImage = new Image({
      filename: req.file.filename,
      imageUrl: `http://localhost:${PORT}/uploads/${req.file.filename}`,
      goatId: req.body.goatId || null, // Link to goat if ID is provided
    });

    await newImage.save();
    res.status(201).send("Image Uploaded and Saved to DB");
  } catch (err) {
    console.log(err);
    res.status(500).send("Error uploading image");
  }
});

app.listen(PORT, () => {
  console.log(`🚀 Server started on port ${PORT}`);
});

//693aaf8eeec4fad6ffb3e527
