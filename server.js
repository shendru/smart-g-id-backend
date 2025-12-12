const express = require("express");
const mongoose = require("mongoose");
const multer = require("multer");
const fs = require("fs");
const path = require("path");
const cors = require("cors"); // 1. Allow Frontend connection
const bcrypt = require("bcryptjs"); // 2. Password Encryption

require("dotenv").config();

// --- MODELS --- //
const User = require("./models/User");
const Goat = require("./models/Goat");
const Image = require("./models/Image");

const app = express();
const PORT = 5000;

// --- MIDDLEWARE --- //
app.use(cors()); // Allows React to communicate with this Backend
app.use(express.json());
app.use("/uploads", express.static("uploads"));

const mongoString = process.env.MONGO_URI;

mongoose
  .connect(mongoString)
  .then(() => console.log("✅ Connected to MongoDB Cloud (Atlas)!"))
  .catch((err) => console.log("❌ Cloud Connection Error:", err));

// --- MULTER CONFIG --- //
if (!fs.existsSync("./uploads")) {
  fs.mkdirSync("./uploads");
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, "uploads/");
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + "_" + file.originalname);
  },
});
const upload = multer({ storage: storage });

// --- ROUTES --- //

app.get("/", (req, res) => {
  res.send("Backend is successfully running!");
});

// A. REGISTER USER (SECURE VERSION)
app.post("/register", async (req, res) => {
  try {
    const { email, password, farmName, address } = req.body;

    // 1. Check if user already exists
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ error: "Email already in use." });
    }

    // 2. Hash the password (Security Best Practice)
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    // 3. Create the new user
    const newUser = new User({
      email,
      farmName,
      address,
      password: hashedPassword, // Save the HASH, not the plain text
    });

    await newUser.save();

    // 4. Remove password from the response data
    const userResponse = newUser.toObject();
    delete userResponse.password;

    res.status(201).json(userResponse);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server Error during registration." });
  }
});

// B. LOGIN (You will need this next)
app.post("/login", async (req, res) => {
    try {
        const { email, password } = req.body;

        // 1. Find User
        const user = await User.findOne({ email });
        if (!user) return res.status(400).json({ error: "User not found" });

        // 2. Compare Password
        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) return res.status(400).json({ error: "Invalid credentials" });

        // 3. Success (Return basic info, omit password)
        const userResponse = user.toObject();
        delete userResponse.password;
        
        res.json({ status: "ok", user: userResponse });

    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// C. ADD GOAT
app.post("/add-goat", async (req, res) => {
  try {
    const newGoat = new Goat(req.body);
    await newGoat.save();
    res.status(201).json(newGoat);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// D. UPLOAD IMAGE
app.post("/upload", upload.single("imageFile"), async (req, res) => {
  try {
    const newImage = new Image({
      filename: req.file.filename,
      imageUrl: `http://localhost:${PORT}/uploads/${req.file.filename}`,
      goatId: req.body.goatId || null,
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