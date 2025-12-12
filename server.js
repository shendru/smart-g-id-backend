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
// Limit increased to 50mb to handle the 4 incoming Base64 images
app.use(express.json({ limit: '50mb' })); 
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use("/uploads", express.static("uploads"));

// --- DATABASE --- //
const mongoString = process.env.MONGO_URI;
console.log("⏳ Connecting to MongoDB..."); 

mongoose
  .connect(mongoString)
  .then(() => console.log("✅ Connected to MongoDB Cloud (Atlas)!"))
  .catch((err) => console.error("❌ Cloud Connection Error:", err));

// --- MULTER SETUP --- //
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
  res.send("Backend is running!");
});

// A. REGISTER
app.post("/register", async (req, res) => {
  try {
    const { email, password, farmName, address } = req.body;

    const existingUser = await User.findOne({ email });
    if (existingUser) return res.status(400).json({ error: "Email already exists." });

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    const newUser = new User({ email, farmName, address, password: hashedPassword });
    await newUser.save();

    const userResponse = newUser.toObject();
    delete userResponse.password;

    res.status(201).json(userResponse);
  } catch (err) {
    console.error("❌ Registration Error:", err);
    res.status(500).json({ error: "Server error." });
  }
});

// B. LOGIN
app.post("/login", async (req, res) => {
    try {
        const { email, password } = req.body;
        const user = await User.findOne({ email });
        
        if (!user) return res.status(400).json({ error: "User not found" });

        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) return res.status(400).json({ error: "Invalid credentials" });

        const userResponse = user.toObject();
        delete userResponse.password;
        
        res.json({ status: "ok", user: userResponse });
    } catch (err) {
        console.error("❌ Login Error:", err);
        res.status(500).json({ error: err.message });
    }
});

app.post("/add-goat", async (req, res) => {
  console.log("\n--- ADD/UPDATE GOAT REQUEST ---");

  try {
    const { 
      owner, rfidTag, name, gender, breed, birthDate, 
      weight, height, healthStatus, 
      photos // Array of Base64 strings
    } = req.body;

    console.log(`📦 Processing: ${name} (${rfidTag})`);

    // 1. FIND & UPDATE (or CREATE if not exists)
    // We search by 'rfidTag'. If found, we update the fields. If not, we create it.
    const goat = await Goat.findOneAndUpdate(
      { rfidTag: rfidTag }, // Search Query
      {
        $set: {
          owner,        // Updates owner (useful if ownership changes)
          name,
          gender,
          breed,
          birthDate,
          weight,       // Updates to latest weight
          height,       // Updates to latest height
          healthStatus, // Updates health tags
          addedAt: Date.now() // Optional: Update timestamp to show "Last Modified"
        }
      },
      { 
        new: true,              // Return the updated document, not the old one
        upsert: true,           // Create if it doesn't exist
        setDefaultsOnInsert: true // Apply schema defaults (like default healthStatus)
      }
    );

    console.log(`✅ Goat Processed! ID: ${goat._id}`);

    // 2. Process Images (Always ADD new images, never delete old ones)
    // This allows you to build a history of photos over time.
    if (photos && photos.length > 0) {
      console.log(`📸 Saving ${photos.length} new images...`);
      
      const imagePromises = photos.map(async (base64String, index) => {
        // Strip header
        const matches = base64String.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
        
        if (!matches || matches.length !== 3) return null;

        const imageBuffer = Buffer.from(matches[2], 'base64');
        // Unique filename: Timestamp + GoatID + Index
        const filename = `${Date.now()}_${goat._id}_img${index}.jpg`;
        const filePath = path.join(__dirname, "uploads", filename);

        // Save File
        fs.writeFileSync(filePath, imageBuffer);

        // Save DB Entry linked to this Goat
        const newImage = new Image({
          goatId: goat._id,
          filename: filename,
          imageUrl: `http://localhost:${PORT}/uploads/${filename}`
        });

        return newImage.save();
      });

      await Promise.all(imagePromises);
      console.log("✅ New images linked to goat.");
    }

    res.status(200).json({ 
        status: "ok", 
        message: "Goat record updated successfully!", 
        goat: goat 
    });

  } catch (err) {
    console.error("❌ Error processing goat:", err); 
    res.status(500).json({ error: err.message });
  }
});

// D. GET GOATS (With Image Lookup)
app.get("/get-goats/:userId", async (req, res) => {
  try {
    const { userId } = req.params;
    console.log(`🔍 Fetching goats for: ${userId}`);

    const goats = await Goat.aggregate([
      { $match: { owner: new mongoose.Types.ObjectId(userId) } },
      { $sort: { addedAt: -1 } },
      {
        $lookup: {
          from: "images",
          localField: "_id",
          foreignField: "goatId",
          as: "goatImages"
        }
      },
      {
        $addFields: {
          // Get the URL of the first image found
          mainPhoto: { $arrayElemAt: ["$goatImages.imageUrl", 0] } 
        }
      },
      { $project: { goatImages: 0 } }
    ]);
    
    console.log(`✅ Found ${goats.length} goats.`); 
    res.status(200).json(goats);

  } catch (err) {
    console.error("❌ Error fetching goats:", err);
    res.status(500).json({ error: err.message });
  }
});

app.get("/get-goat/:id", async (req, res) => {
  try {
    const { id } = req.params;
    
    // 1. Get Goat Details
    const goat = await Goat.findById(id);
    if (!goat) return res.status(404).json({ error: "Goat not found" });

    // 2. Get Related Images
    const images = await Image.find({ goatId: id });

    // 3. Combine
    const profileData = {
        ...goat.toObject(),
        images: images.map(img => img.imageUrl) // or img.imageBase64 if using that method
    };

    res.json(profileData);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`🚀 Server started on port ${PORT}`);
});