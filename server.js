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
app.use(express.json({ limit: '50mb' })); 
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// ✅ FIX 1: Use absolute path for static files
// This ensures the server looks in the EXACT same folder where you saved the images
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

// --- DATABASE --- //
const mongoString = process.env.MONGO_URI;
console.log("⏳ Connecting to MongoDB..."); 

mongoose
  .connect(mongoString)
  .then(() => console.log("✅ Connected to MongoDB Cloud (Atlas)!"))
  .catch((err) => console.error("❌ Cloud Connection Error:", err));

// --- MULTER SETUP --- //
// Ensure uploads directory exists using absolute path
const uploadDir = path.join(__dirname, "uploads");
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir);
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
  // ... (Your existing register logic is fine) ...
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
    // ... (Your existing login logic is fine) ...
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

// C. ADD OR UPDATE GOAT
app.post("/add-goat", async (req, res) => {
  console.log("\n--- ADD/UPDATE GOAT REQUEST ---");

  try {
    const { 
      owner, rfidTag, name, gender, breed, birthDate, 
      weight, height, healthStatus, 
      photos 
    } = req.body;

    console.log(`📦 Processing: ${name} (${rfidTag})`);

    const goat = await Goat.findOneAndUpdate(
      { rfidTag: rfidTag }, 
      {
        $set: {
          owner, name, gender, breed, birthDate, weight, height, healthStatus,
          addedAt: Date.now() 
        }
      },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );

    console.log(`✅ Goat ID: ${goat._id}`);

    // IMAGE LOGIC
    if (photos && photos.length > 0) {
      console.log("🔄 New photos detected. Starting cleanup sequence...");

      // --- CLEANUP OLD IMAGES ---
      try {
        const oldImages = await Image.find({ goatId: goat._id });
        
        for (const img of oldImages) {
          // ✅ FIX 2: Use absolute path for deletion to match creation
          const filePath = path.join(__dirname, "uploads", img.filename);
          
          try {
            if (fs.existsSync(filePath)) {
              fs.unlinkSync(filePath);
              console.log(`   🗑️ Deleted file: ${img.filename}`);
            }
          } catch (fileErr) {
            console.error(`   ❌ Error deleting file ${img.filename}:`, fileErr.message);
          }
        }

        await Image.deleteMany({ goatId: goat._id });
        console.log(`   ✅ Removed records from DB.`);

      } catch (cleanupErr) {
        console.error("❌ Critical error during cleanup:", cleanupErr);
      }

      // --- SAVE NEW IMAGES ---
      console.log(`📸 Saving ${photos.length} new images...`);
      
      const imagePromises = photos.map(async (base64String, index) => {
        const matches = base64String.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
        if (!matches || matches.length !== 3) return null;

        const imageBuffer = Buffer.from(matches[2], 'base64');
        const filename = `${Date.now()}_${goat._id}_img${index}.jpg`;
        const filePath = path.join(__dirname, "uploads", filename);

        fs.writeFileSync(filePath, imageBuffer);

        // ✅ FIX 3: Store RELATIVE URL only
        // Instead of hardcoding 'http://localhost:5000', we just store 'uploads/filename.jpg'.
        // This allows the frontend to decide the IP address (localhost vs 10.109...)
        const newImage = new Image({
          goatId: goat._id,
          filename: filename,
          imageUrl: `uploads/${filename}` 
        });

        return newImage.save();
      });

      await Promise.all(imagePromises);
      console.log("✅ New images saved successfully.");
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
    
    // We get the goats normally
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
          // Because we changed how we save URLs, we just grab the path here
          mainPhotoPath: { $arrayElemAt: ["$goatImages.imageUrl", 0] } 
        }
      },
      { $project: { goatImages: 0 } }
    ]);
    
    // ✅ Optional: Helper to append full URL if you want backend to handle it
    // But usually frontend handling is better for mobile apps.
    // For now, we return the paths directly.
    
    res.status(200).json(goats);

  } catch (err) {
    console.error("❌ Error fetching goats:", err);
    res.status(500).json({ error: err.message });
  }
});

app.get("/get-goat/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const goat = await Goat.findById(id);
    if (!goat) return res.status(404).json({ error: "Goat not found" });

    const images = await Image.find({ goatId: id });

    const profileData = {
        ...goat.toObject(),
        // Returns "uploads/1234.jpg"
        images: images.map(img => img.imageUrl) 
    };

    res.json(profileData);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`🚀 Server started on port ${PORT}`);
});