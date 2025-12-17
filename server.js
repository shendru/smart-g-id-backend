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
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));

// ✅ FIX 1: Use absolute path for static files
// This ensures the server looks in the EXACT same folder where you saved the images
console.log("📂 Serving static files from:", path.join(__dirname, "uploads"));
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
    if (existingUser)
      return res.status(400).json({ error: "Email already exists." });

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    const newUser = new User({
      email,
      farmName,
      address,
      password: hashedPassword,
    });
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
      owner,
      rfidTag,
      name,
      gender,
      breed,
      birthDate,
      weight,
      height,
      healthStatus,
      photos,
    } = req.body;

    console.log(`📦 Processing: ${name} (${rfidTag})`);

    const goat = await Goat.findOneAndUpdate(
      { rfidTag: rfidTag },
      {
        $set: {
          owner,
          name,
          gender,
          breed,
          birthDate,
          weight,
          height,
          healthStatus,
          addedAt: Date.now(),
        },
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
            console.error(
              `   ❌ Error deleting file ${img.filename}:`,
              fileErr.message
            );
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
        const matches = base64String.match(
          /^data:([A-Za-z-+\/]+);base64,(.+)$/
        );
        if (!matches || matches.length !== 3) return null;

        const imageBuffer = Buffer.from(matches[2], "base64");
        const filename = `${Date.now()}_${goat._id}_img${index}.jpg`;
        const filePath = path.join(__dirname, "uploads", filename);

        fs.writeFileSync(filePath, imageBuffer);

        // ✅ FIX 3: Store RELATIVE URL only
        // Instead of hardcoding 'http://localhost:5000', we just store 'uploads/filename.jpg'.
        // This allows the frontend to decide the IP address (localhost vs 10.109...)
        const newImage = new Image({
          goatId: goat._id,
          filename: filename,
          imageUrl: `uploads/${filename}`,
        });

        return newImage.save();
      });

      await Promise.all(imagePromises);
      console.log("✅ New images saved successfully.");
    }

    res.status(200).json({
      status: "ok",
      message: "Goat record updated successfully!",
      goat: goat,
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
          as: "goatImages",
        },
      },
      {
        $addFields: {
          // Because we changed how we save URLs, we just grab the path here
          mainPhotoPath: { $arrayElemAt: ["$goatImages.imageUrl", 0] },
        },
      },
      { $project: { goatImages: 0 } },
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

    // Validate ID format to prevent crashes
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(404).json({ error: "Invalid Goat ID" });
    }

    const goats = await Goat.aggregate([
      // 1. MATCH: Find the specific goat by ID
      // We must cast the string 'id' to a real ObjectId for aggregation to work
      { $match: { _id: new mongoose.Types.ObjectId(id) } },

      // 2. CONVERT ID: Fix the 'owner' string vs ObjectId mismatch
      {
        $addFields: {
          ownerObjectId: { $toObjectId: "$owner" },
        },
      },

      // 3. LOOKUP OWNER: Get farm details from Users collection
      {
        $lookup: {
          from: "users",
          localField: "ownerObjectId",
          foreignField: "_id",
          as: "ownerData",
        },
      },

      // 4. LOOKUP IMAGES: Get all images for this goat
      {
        $lookup: {
          from: "images",
          localField: "_id",
          foreignField: "goatId", // Matches the 'goatId' field in your Image schema
          as: "goatImages",
        },
      },

      // 5. FORMAT DATA
      {
        $project: {
          // Include all Goat fields you need
          name: 1,
          breed: 1,
          price: 1,
          gender: 1,
          weight: 1,
          height: 1,
          birthDate: 1,
          listedAt: 1,
          healthStatus: 1,
          rfidTag: 1,
          isForSale: 1,
          description: 1, // Include if you have it

          // Transform Images: Convert array of objects -> array of URL strings
          images: {
            $map: {
              input: "$goatImages",
              as: "img",
              in: "$$img.imageUrl",
            },
          },

          // Create the ownerDetails object (taking the first match from the array)
          ownerDetails: {
            farmName: { $arrayElemAt: ["$ownerData.farmName", 0] },
            address: { $arrayElemAt: ["$ownerData.address", 0] },
            email: { $arrayElemAt: ["$ownerData.email", 0] },
          },
        },
      },
    ]);

    // Check if goat was found
    if (!goats || goats.length === 0) {
      return res.status(404).json({ error: "Goat not found" });
    }

    // Return the single object (goats[0]), not the array
    res.json(goats[0]);
  } catch (err) {
    console.error("❌ Get-Goat Error:", err);
    res.status(500).json({ error: err.message });
  }
});

// E. UPDATE GOAT (Partial Update for Marketplace)
// This supports sending just { price: 500, isForSale: true }
app.put("/update-goat/:id", async (req, res) => {
  try {
    const { id } = req.params;

    // { new: true } returns the updated document so the UI updates instantly
    const updatedGoat = await Goat.findByIdAndUpdate(id, req.body, {
      new: true,
    });

    if (!updatedGoat) {
      return res.status(404).json({ error: "Goat not found" });
    }

    res.json(updatedGoat);
  } catch (err) {
    console.error("❌ Update Error:", err);
    res.status(500).json({ error: err.message });
  }
});

// F. GET ALL MARKETPLACE GOATS (Public Feed)
app.get("/api/goats", async (req, res) => {
  try {
    const goats = await Goat.aggregate([
      // 1. FILTER: Only show goats for sale
      { $match: { isForSale: true } },

      // 2. SORT: Newest listed first
      { $sort: { listedAt: -1 } },

      // === FIX STARTS HERE ===
      // 3. CONVERT ID: Ensure 'owner' is treated as an ObjectId so Lookup works
      {
        $addFields: {
          ownerObjectId: { $toObjectId: "$owner" },
        },
      },

      // 4. LOOKUP USER: Match the converted ID
      {
        $lookup: {
          from: "users",
          localField: "ownerObjectId", // Use the converted ID
          foreignField: "_id",
          as: "ownerData",
        },
      },
      // === FIX ENDS HERE ===

      // 5. LOOKUP IMAGES
      {
        $lookup: {
          from: "images",
          localField: "_id",
          foreignField: "goatId",
          as: "goatImages",
        },
      },

      // 6. FORMAT DATA
      {
        $addFields: {
          mainPhoto: { $arrayElemAt: ["$goatImages.imageUrl", 0] },
          // Extract the address we just found
          ownerAddress: { $arrayElemAt: ["$ownerData.address", 0] },
          // Optional: Extract Farm Name too
          farmName: { $arrayElemAt: ["$ownerData.farmName", 0] },
        },
      },

      // 7. CLEANUP
      { $project: { goatImages: 0, ownerData: 0, ownerObjectId: 0 } },
    ]);

    res.status(200).json(goats);
  } catch (err) {
    console.error("❌ Marketplace Error:", err);
    res.status(500).json({ error: err.message });
  }
});

// G. DELETE GOAT
app.delete("/delete-goat/:id", async (req, res) => {
  try {
    const { id } = req.params;

    // 1. Delete the Goat Record
    await Goat.findByIdAndDelete(id);

    // 2. Delete associated Images from DB
    // (Optional: You could also delete the actual files from /uploads here if you want to be clean)
    await Image.deleteMany({ goatId: id });

    res.json({ message: "Goat deleted successfully" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/farms", async (req, res) => {
  try {
    // Fetch users (you might want to filter by role: 'breeder' or 'farmer' if you have that field)
    const farms = await User.find({})
      .select("farmName address email _id profileImage") // Only select public info
      .lean();

    res.json(farms);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/goats", async (req, res) => {
  try {
    const goats = await Goat.aggregate([
      // 1. FILTER: Only show goats that are marked for sale
      { $match: { isForSale: true } },

      // 2. SORT: Newest listed first
      { $sort: { listedAt: -1 } },

      // 3. CONVERT OWNER ID:
      // The 'owner' field in Goat is likely a String, but we need an ObjectId for lookup
      {
        $addFields: {
          ownerObjectId: { $toObjectId: "$owner" },
        },
      },

      // 4. LOOKUP OWNER (USER): Match the converted ID to the User collection
      {
        $lookup: {
          from: "users",
          localField: "ownerObjectId",
          foreignField: "_id",
          as: "ownerData",
        },
      },

      // 5. LOOKUP IMAGES: Get images linked to this goat
      {
        $lookup: {
          from: "images",
          localField: "_id",
          foreignField: "goatId",
          as: "goatImages",
        },
      },

      // 6. FORMAT OUTPUT: Shape the data for the frontend
      {
        $addFields: {
          // Get the first image as the main photo
          mainPhoto: { $arrayElemAt: ["$goatImages.imageUrl", 0] },
          // Extract specific public fields from the owner array
          farmName: { $arrayElemAt: ["$ownerData.farmName", 0] },
          ownerAddress: { $arrayElemAt: ["$ownerData.address", 0] },
          // Keep the original owner ID if needed
          ownerId: { $toString: "$ownerObjectId" },
        },
      },

      // 7. CLEANUP: Remove massive internal arrays to keep the response light
      {
        $project: {
          goatImages: 0,
          ownerData: 0,
          ownerObjectId: 0,
          __v: 0,
        },
      },
    ]);

    res.status(200).json(goats);
  } catch (err) {
    console.error("❌ Marketplace Error:", err);
    res.status(500).json({ error: "Failed to fetch marketplace listings" });
  }
});

app.get("/goats", async (req, res) => {
  try {
    const goats = await Goat.aggregate([
      // 1. FILTER: Only show goats that are marked for sale
      // (Remove this block if you want to see ALL goats regardless of status)
      { $match: { isForSale: true } },

      // 2. SORT: Newest listed first
      { $sort: { listedAt: -1 } },

      // 3. LOOKUP OWNER (USER)
      // matching "owner" in Goat to "_id" in Users
      {
        $lookup: {
          from: "users",
          localField: "owner",
          foreignField: "_id",
          as: "ownerData",
        },
      },

      // 4. LOOKUP IMAGES
      // This is the KEY FIX. It grabs images from the separate "images" collection
      {
        $lookup: {
          from: "images", // Must match your MongoDB collection name for images
          localField: "_id",
          foreignField: "goatId",
          as: "goatImages",
        },
      },

      // 5. FORMAT OUTPUT
      {
        $addFields: {
          // Take the first image found and make it the 'mainPhoto'
          // ensure your Image collection has a field named 'imageUrl' or change this string
          mainPhoto: { $arrayElemAt: ["$goatImages.imageUrl", 0] },

          // Extract owner details
          farmName: { $arrayElemAt: ["$ownerData.farmName", 0] },
          ownerAddress: { $arrayElemAt: ["$ownerData.address", 0] },
        },
      },

      // 6. CLEANUP (Remove heavy arrays to make response faster)
      {
        $project: {
          goatImages: 0,
          ownerData: 0,
          __v: 0,
        },
      },
    ]);

    res.status(200).json(goats);
  } catch (error) {
    console.error("Error fetching all goats:", error);
    res.status(500).json({ message: "Server error fetching goats" });
  }
});

// H. GET SPECIFIC FARM (For Store Page)
app.get("/api/farms/:id", async (req, res) => {
  try {
    const { id } = req.params;

    // Validate ID format to prevent server crash on bad URLs
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(404).json({ error: "Invalid Farm ID" });
    }

    // Find user by ID but EXCLUDE the password
    const farm = await User.findById(id).select("-password").lean();

    if (!farm) {
      return res.status(404).json({ error: "Farm not found" });
    }

    res.json(farm);
  } catch (err) {
    console.error("❌ Get Farm Error:", err);
    res.status(500).json({ error: "Server error fetching farm" });
  }
});

app.listen(PORT, () => {
  console.log(`🚀 Server started on port ${PORT}`);
});
