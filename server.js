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

// C. ADD GOAT (Complex Route: Data + Images)
app.post("/add-goat", async (req, res) => {
  console.log("\n--- ADD GOAT REQUEST ---");

  try {
    // 1. Extract Goat Data + Photos Array
    const { 
      owner, rfidTag, name, gender, breed, birthDate, 
      weight, height, healthStatus, 
      photos // Array of Base64 strings from React
    } = req.body;

    console.log(`📦 Registering: ${name} (${rfidTag})`);

    // 2. Save Goat Info First
    const newGoat = new Goat({
      owner, rfidTag, name, gender, breed, birthDate, 
      weight, height, healthStatus
    });

    const savedGoat = await newGoat.save();
    console.log(`✅ Goat Saved! ID: ${savedGoat._id}`);

    // 3. Process & Save Images (Convert Base64 -> File -> DB)
    if (photos && photos.length > 0) {
      console.log(`📸 Processing ${photos.length} images...`);
      
      const imagePromises = photos.map(async (base64String, index) => {
        // Strip header if present
        const matches = base64String.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
        
        if (!matches || matches.length !== 3) return null;

        const imageBuffer = Buffer.from(matches[2], 'base64');
        const filename = `${Date.now()}_${savedGoat._id}_img${index}.jpg`;
        const filePath = path.join(__dirname, "uploads", filename);

        // Save File to Disk
        fs.writeFileSync(filePath, imageBuffer);

        // Save Record to DB
        const newImage = new Image({
          goatId: savedGoat._id,
          filename: filename,
          imageUrl: `http://localhost:${PORT}/uploads/${filename}`
          // Removed 'angle' since your model doesn't use it
        });

        return newImage.save();
      });

      await Promise.all(imagePromises);
      console.log("✅ Images saved to disk & DB.");
    }

    res.status(201).json({ status: "ok", goat: savedGoat });

  } catch (err) {
    console.error("❌ Error adding goat:", err); 
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