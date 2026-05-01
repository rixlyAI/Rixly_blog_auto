import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";
import { createClient } from "@sanity/client";
import dotenv from "dotenv";
import axios from "axios";
import { initializeApp, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const firebaseConfig = require("./firebase-applet-config.json");

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Initialize Firebase Admin
if (!getApps().length) {
  initializeApp({
    projectId: firebaseConfig.projectId,
  });
}

let db: any;
try {
  // Try named database first
  db = getFirestore(firebaseConfig.firestoreDatabaseId);
  console.log(`Using named database: ${firebaseConfig.firestoreDatabaseId}`);
} catch (e) {
  console.log("Failed to initialize named database, falling back to default...");
  db = getFirestore();
}

process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
  if (err.message.includes('EADDRINUSE')) {
    console.error('Port 3000 is already in use. The previous process might still be running.');
    process.exit(1);
  }
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

async function startServer() {
  const app = express();
  const PORT = 3000;

  // Request Logger
  app.use((req, res, next) => {
    console.log(`${new Date().toISOString()} - ${req.method} ${req.url}`);
    next();
  });

  app.use(express.json({ limit: '50mb' }));

  // Health Check
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok", timestamp: new Date().toISOString() });
  });

  // Sanity Client for manual uploads
  const sanityClient = createClient({
    projectId: process.env.SANITY_PROJECT_ID || "",
    dataset: process.env.SANITY_DATASET || "production",
    token: process.env.SANITY_API_TOKEN || "",
    useCdn: false,
    apiVersion: "2023-05-03",
  });

  // API Routes
  app.post("/api/upload-blog", async (req, res) => {
    try {
      const { 
        title, slug, content, imageBase64, author, category, 
        excerpt, seoTitle, seoDescription, tags, altText,
        sanityConfig 
      } = req.body;

      // Use dynamic config if provided, otherwise fallback to env
      const projectId = sanityConfig?.projectId || process.env.SANITY_PROJECT_ID;
      const dataset = sanityConfig?.dataset || process.env.SANITY_DATASET || "production";
      const token = sanityConfig?.token || process.env.SANITY_API_TOKEN;

      if (!token) {
        return res.status(500).json({ error: "Sanity API Token not configured. Please add it in Settings." });
      }
      if (!projectId) {
        return res.status(500).json({ error: "Sanity Project ID not configured. Please add it in Settings." });
      }

      const dynamicClient = createClient({
        projectId,
        dataset,
        token,
        useCdn: false,
        apiVersion: "2023-05-03",
      });

      console.log(`Attempting Sanity upload for project: ${projectId}, dataset: ${dataset}`);

      // Mappings for Author and Category IDs
      const authorMappings: Record<string, string> = {
        "Mevin": "1f069a75-556a-4455-a1f7-ba10f817dbc6",
      };

      const categoryMappings: Record<string, string> = {
        "Product Intelligence": "1ddb19f7-3f1f-431a-ae0a-0551d1adc58a",
        "Sales Intelligence": "394356ee-cb88-47b4-b262-167ac836e284",
        "Community-Led Growth": "3f1330d4-3f8f-469d-9f66-4ea1cf2744a2",
        "Reddit Marketing": "66c284a3-4cfa-4a18-8a0c-06d1d6c0f558",
        "SEO and GEO": "824f79d8-f4ea-4210-82b6-a05efc7d45a1"
      };

      const authorRef = authorMappings[author] || authorMappings["Mevin"];
      
      // Case-insensitive category mapping
      const normalizedCategory = category?.trim().toLowerCase();
      const categoryRef = Object.entries(categoryMappings).find(
        ([key]) => key.toLowerCase() === normalizedCategory
      )?.[1];

      console.log(`Category received: "${category}", Normalized: "${normalizedCategory}", Ref: "${categoryRef}"`);

      let mainImage = null;

      if (imageBase64) {
        try {
          let buffer: Buffer;
          if (imageBase64.startsWith("data:")) {
            buffer = Buffer.from(imageBase64.split(",")[1], "base64");
          } else {
            // It's a URL (like Picsum fallback)
            const imageResponse = await axios.get(imageBase64, { 
              responseType: 'arraybuffer',
              timeout: 10000 
            });
            buffer = Buffer.from(imageResponse.data);
          }

          const asset = await dynamicClient.assets.upload("image", buffer, {
            filename: `${slug}.png`,
          });
          mainImage = {
            _type: "image",
            asset: {
              _type: "reference",
              _ref: asset._id,
            },
            alt: altText || title
          };
          console.log("Image uploaded successfully to Sanity");
        } catch (imgErr: any) {
          console.error("Image upload to Sanity failed, continuing without image:", imgErr.message);
        }
      }

      const doc = {
        _type: "post",
        title,
        slug: { _type: "slug", current: slug },
        excerpt,
        seoTitle,
        seoDescription,
        tags: tags || [],
        author: {
          _type: "reference",
          _ref: authorRef
        },
        // Support both singular and plural category fields
        category: categoryRef ? {
          _type: "reference",
          _ref: categoryRef
        } : undefined,
        categories: categoryRef ? [{
          _type: "reference",
          _ref: categoryRef,
          _key: Math.random().toString(36).substring(2, 11)
        }] : [],
        body: content,
        mainImage,
        featuredImage: mainImage,
        ogImage: mainImage,
        publishedAt: new Date().toISOString(),
      };

      const result = await dynamicClient.create(doc);
      console.log("Sanity document created successfully");
      res.json({ success: true, result });
    } catch (error: any) {
      console.error("Sanity Upload Error Details:", {
        message: error.message,
        stack: error.stack,
        response: error.response?.data
      });
      res.status(500).json({ 
        error: error.message || "Unknown server error",
        details: "If you see 'Request error', check if your Sanity Project ID is correct and your API token has 'Editor' permissions."
      });
    }
  });

  // Global Error Handler
  app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
    console.error("Global Error:", err);
    res.status(err.status || 500).json({
      error: err.message || "Internal Server Error",
      success: false
    });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { 
        middlewareMode: true,
        hmr: false
      },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  const server = app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });

  process.on('SIGTERM', () => {
    console.log('SIGTERM signal received: closing HTTP server');
    server.close(() => {
      console.log('HTTP server closed');
      process.exit(0);
    });
  });
}

startServer();
