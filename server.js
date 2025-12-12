const express = require("express");
const mongoose = require("mongoose");
const multer = require("multer");
const fs = require("fs");
const path = require("path");
const cors = require("cors"); 
const bcrypt = require("bcryptjs"); 

require("dotenv").config();

// --- MODELS --- //
const User = require("./models/User");
const Goat = require("./models/Goat");
const Image = require("./models/Image");

const app = express();
const PORT = 5000;

// --- MIDDLEWARE --- //
app.use(cors()); 
// INCREASED LIMIT: Base64 images are large, so we need to allow bigger JSON bodies
app.use(express.json({ limit: '50mb' })); 
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use("/uploads", express.static("uploads"));

// --- DATABASE CONNECTION --- //
const mongoString = process.env.MONGO_URI;
console.log("⏳ Connecting to MongoDB..."); 

mongoose
  .connect(mongoString)
  .then(() => console.log("✅ Connected to MongoDB Cloud (Atlas)!"))
  .catch((err) => console.error("❌ Cloud Connection Error:", err));

// --- MULTER CONFIG --- //
// Ensure uploads folder exists
if (!fs.existsSync("./uploads")) {
  console.log("📁 'uploads' folder not found, creating it..."); 
  fs.mkdirSync("./uploads");
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, "uploads/");
  },
  filename: (req, file, cb) => {
    const filename = Date.now() + "_" + file.originalname;
    cb(null, filename);
  },
});
const upload = multer({ storage: storage });

// --- ROUTES --- //

app.get("/", (req, res) => {
  res.send("Backend is successfully running!");
});

// A. REGISTER USER
app.post("/register", async (req, res) => {
  console.log("\n--- REGISTER REQUEST RECEIVED ---"); 

  try {
    const { email, password, farmName, address } = req.body;

    // 1. Check if user already exists
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ error: "Email already in use." });
    }

    // 2. Hash the password
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    // 3. Create the new user
    const newUser = new User({
      email,
      farmName,
      address,
      password: hashedPassword, 
    });

    await newUser.save();
    console.log("✅ User saved successfully!"); 

    const userResponse = newUser.toObject();
    delete userResponse.password;

    res.status(201).json(userResponse);
  } catch (err) {
    console.error("❌ Registration Error:", err); 
    res.status(500).json({ error: "Server Error during registration." });
  }
});

// B. LOGIN
app.post("/login", async (req, res) => {
    console.log("\n--- LOGIN REQUEST RECEIVED ---"); 

    try {
        const { email, password } = req.body;

        const user = await User.findOne({ email });
        if (!user) {
            return res.status(400).json({ error: "User not found" });
        }

        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            return res.status(400).json({ error: "Invalid credentials" });
        }

        console.log("✅ Login Successful!"); 
        const userResponse = user.toObject();
        delete userResponse.password;
        
        res.json({ status: "ok", user: userResponse });

    } catch (err) {
        console.error("❌ Login Error:", err); 
        res.status(500).json({ error: err.message });
    }
});

// C. ADD GOAT (THE BIG UPDATE)
// This now handles Data + Base64 Images together
app.post("/add-goat", async (req, res) => {
  console.log("\n--- ADD GOAT REQUEST ---");

  try {
    // 1. Extract Data
    const { 
      owner, rfidTag, name, gender, breed, birthDate, 
      weight, height, healthStatus, 
      photos // Array of Base64 strings
    } = req.body;

    console.log(`📦 Registering: ${name} (${rfidTag})`);

    // 2. Create Goat Document
    const newGoat = new Goat({
      owner,
      rfidTag,
      name,
      gender,
      breed,
      birthDate,
      weight,
      height,
      healthStatus
    });

    const savedGoat = await newGoat.save();
    console.log(`✅ Goat Saved! ID: ${savedGoat._id}`);

    // 3. Process Images (Convert Base64 -> File -> DB Entry)
    if (photos && photos.length > 0) {
      console.log(`📸 Processing ${photos.length} images...`);
      
      const imagePromises = photos.map(async (base64String, index) => {
        // Remove header "data:image/jpeg;base64,"
        const matches = base64String.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
        
        if (!matches || matches.length !== 3) {
          console.warn(`⚠️ Skipping invalid image at index ${index}`);
          return null;
        }

        const imageBuffer = Buffer.from(matches[2], 'base64');
        const filename = `${Date.now()}_${savedGoat._id}_angle${index + 1}.jpg`;
        const filePath = path.join(__dirname, "uploads", filename);

        // Save to Disk
        fs.writeFileSync(filePath, imageBuffer);
        console.log(`💾 Saved file: ${filename}`);

        // Save to DB (Image Model)
        const newImage = new Image({
          goatId: savedGoat._id,
          filename: filename,
          imageUrl: `http://localhost:${PORT}/uploads/${filename}`,
          angle: `Angle ${index + 1}`
        });

        return newImage.save();
      });

      await Promise.all(imagePromises);
      console.log("✅ All Images Linked & Saved!");
    }

    res.status(201).json({ 
        status: "ok", 
        message: "Goat registered successfully!", 
        goat: savedGoat 
    });

  } catch (err) {
    console.error("❌ Error adding goat:", err); 
    res.status(500).json({ error: err.message });
  }
});

app.get("/get-goats/:userId", async (req, res) => {
  try {
    const { userId } = req.params;
    // Find goats belonging to this user, sort by newest first
    const goats = await Goat.find({ owner: userId }).sort({ addedAt: -1 });
    
    // Optional: You might want to fetch the "main photo" for each goat here too
    // For now, we will just return the goat data
    res.status(200).json(goats);
  } catch (err) {
    console.error("❌ Error fetching goats:", err);
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`🚀 Server started on port ${PORT}`);
});