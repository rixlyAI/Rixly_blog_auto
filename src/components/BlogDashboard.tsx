import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { generateBlog, generateImage, type BlogContent } from "@/src/lib/gemini";
import { Loader2, Send, Sparkles, Image as ImageIcon, BarChart3, CheckCircle2, History, LayoutDashboard, Trash2, Search, Calendar, ListTodo, Settings as SettingsIcon, Play, Clock, CheckCircle, Eye, UploadCloud, LogOut } from "lucide-react";
import ReactMarkdown from "react-markdown";
import rehypeRaw from "rehype-raw";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LineChart, Line, PieChart, Pie, Cell } from "recharts";
import { motion, AnimatePresence } from "motion/react";
import { db, auth } from "@/src/lib/firebase";
import Papa from "papaparse";
import * as XLSX from "xlsx";
import { createClient } from "@sanity/client";
import { collection, addDoc, query, orderBy, onSnapshot, serverTimestamp, deleteDoc, doc, updateDoc, setDoc, getDoc, writeBatch, runTransaction } from "firebase/firestore";
import { onAuthStateChanged, signOut } from "firebase/auth";
import showdown from "showdown";

enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId: string | undefined;
    email: string | null | undefined;
    emailVerified: boolean | undefined;
    isAnonymous: boolean | undefined;
    tenantId: string | null | undefined;
    providerInfo: {
      providerId: string;
      displayName: string | null;
      email: string | null;
      photoUrl: string | null;
    }[];
  }
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo = {
    error: error instanceof Error ? error.message : String(error),
    operationType,
    path,
    authInfo: { userId: 'public' }
  }
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  toast.error(`Database Error: ${errInfo.error}`);
}

const COLORS = ['#0088FE', '#00C49F', '#FFBB28', '#FF8042', '#8884d8'];

export default function BlogDashboard({ onLogout }: { onLogout?: () => void }) {
  const [view, setView] = useState<'dashboard' | 'queue' | 'settings'>('dashboard');
  const [queue, setQueue] = useState<any[]>([]);
  const [settings, setSettings] = useState<any>({ 
    additionalApiKeys: [], 
    defaultOldLinks: [], 
    defaultInternalLinks: [],
    categorizedLinks: [] 
  });
  
  const [topics, setTopics] = useState<{topic: string, instructions: string}[]>([
    {topic: "", instructions: ""}, 
    {topic: "", instructions: ""}
  ]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isUploading, setIsUploading] = useState<string | null>(null);
  const [showLogs, setShowLogs] = useState(false);
  const [logs, setLogs] = useState<{ message: string; timestamp: string; type: 'info' | 'success' | 'error' }[]>([]);
  
  const logContainerRef = React.useRef<HTMLDivElement>(null);

  const [user, setUser] = useState<any>({ uid: 'public' });
  const [isAuthLoading, setIsAuthLoading] = useState(false);

  // No longer using Firebase Auth sign-in to avoid 'admin-restricted-operation' errors.
  // The app is protected by the password gate in App.tsx.

  React.useEffect(() => {
    if (!user) return;

    // Queue Listener
    const qQueue = query(collection(db, "queue"), orderBy("createdAt", "desc"));
    const unsubQueue = onSnapshot(qQueue, (snapshot) => {
      setQueue(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, "queue");
    });

    // Settings Listener
    const unsubSettings = onSnapshot(doc(db, "settings", "automation"), (doc) => {
      if (doc.exists()) {
        const data = doc.data();
        setSettings(data);
        if (data.autoDelaySeconds !== undefined) {
          setTimerDuration(data.autoDelaySeconds);
        }
      }
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, "settings/automation");
    });

    return () => {
      unsubQueue();
      unsubSettings();
    };
  }, [user]);

  const handleSignOut = async () => {
    try {
      await signOut(auth);
      // After sign out, the effect will trigger re-login anonymously
      if (onLogout) onLogout();
    } catch (error: any) {
      toast.error(`Logout failed: ${error.message}`);
    }
  };

  // No user check here anymore, handled by background anonymous auth and App.tsx password check

  React.useEffect(() => {
    if (logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [logs]);

  const addLog = (message: string, type: 'info' | 'success' | 'error' = 'info') => {
    setLogs(prev => [...prev, { message, timestamp: new Date().toLocaleTimeString(), type }]);
  };

  const compressImage = (base64Str: string): Promise<string> => {
    return new Promise((resolve, reject) => {
      const img = new Image();
      // If it's a URL (like Picsum), we need crossOrigin to avoid "tainted canvas" error
      if (base64Str.startsWith('http')) {
        img.crossOrigin = "anonymous";
      }
      img.src = base64Str;
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const MAX_WIDTH = 800; 
        const MAX_HEIGHT = 600;
        let width = img.width;
        let height = img.height;

        if (width > height) {
          if (width > MAX_WIDTH) {
            height *= MAX_WIDTH / width;
            width = MAX_WIDTH;
          }
        } else {
          if (height > MAX_HEIGHT) {
            width *= MAX_HEIGHT / height;
            height = MAX_HEIGHT;
          }
        }

        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(base64Str);
          return;
        }
        ctx.drawImage(img, 0, 0, width, height);
        try {
          resolve(canvas.toDataURL('image/jpeg', 0.7));
        } catch (err) {
          console.error("Compression failed (likely CORS):", err);
          resolve(base64Str); // Fallback to original if compression fails
        }
      };
      img.onerror = () => {
        console.error("Image load failed for compression");
        resolve(base64Str);
      };
    });
  };

  const [previewBlog, setPreviewBlog] = useState<any>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [countdown, setCountdown] = useState(10);
  const [timerDuration, setTimerDuration] = useState(10);
  const [isTimerActive, setIsTimerActive] = useState(false);
  const [autoUploadQueue, setAutoUploadQueue] = useState<string[]>([]);
  const [localAutoUploadEnabled, setLocalAutoUploadEnabled] = useState(() => {
    const saved = localStorage.getItem("localAutoUploadEnabled");
    return saved !== null ? JSON.parse(saved) : true;
  });

  React.useEffect(() => {
    localStorage.setItem("localAutoUploadEnabled", JSON.stringify(localAutoUploadEnabled));
  }, [localAutoUploadEnabled]);

  const formatTime = (seconds: number) => {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    return `${h > 0 ? h + 'h ' : ''}${m > 0 || h > 0 ? m + 'm ' : ''}${s}s`;
  };

  const preGenerate = async () => {
    const pendingItems = queue.filter(t => t.status === 'pending').sort((a, b) => {
      const timeA = a.createdAt?.toMillis() || 0;
      const timeB = b.createdAt?.toMillis() || 0;
      return timeA - timeB;
    }).slice(0, 1);
    
    if (pendingItems.length === 0) {
      return;
    }

    setIsGenerating(true);
    setShowLogs(true);
    setLogs([]);
    addLog(`Starting pre-generation for topic...`, "info");

    const oldLinkList = settings.defaultOldLinks || [];
    const internalLinkList = settings.defaultInternalLinks || [];
    const apiKeys = settings.additionalApiKeys || [];
    const preferredKey = settings.preferredApiKey;
    const openRouterKey = settings.openRouterKey;
    const categorizedLinks = settings.categorizedLinks || [];

    try {
      for (const item of pendingItems) {
        addLog(`Generating content for: ${item.topic}...`, "info");
        try {
          const blog = await generateBlog(item.topic, oldLinkList, internalLinkList, apiKeys, preferredKey, openRouterKey, categorizedLinks, item.customInstructions);
          addLog(`Content generated for: ${item.topic}. Now generating image...`, "info");
          const rawImage = await generateImage(blog.imagePrompt, apiKeys, preferredKey, openRouterKey);
          const image = await compressImage(rawImage);
          
          const docRef = doc(db, "queue", item.id);
          const docSnap = await getDoc(docRef);
          
          if (!docSnap.exists()) {
            addLog(`Item ${item.topic} was removed from queue during generation. Skipping update.`, "info");
            continue;
          }

          try {
            await updateDoc(docRef, {
              status: "generated",
              generatedAt: serverTimestamp(),
              generatedContent: {
                ...blog,
                image
              }
            });
          } catch (updateErr) {
            handleFirestoreError(updateErr, OperationType.UPDATE, `queue/${item.id}`);
            throw updateErr;
          }
          addLog(`Successfully generated: ${item.topic}`, "success");
        } catch (itemError: any) {
          addLog(`Failed to generate "${item.topic}": ${itemError.message}`, "error");
          throw itemError;
        }
      }
      toast.success("Pre-generation complete!");
      setTimeout(() => setShowLogs(false), 3000);
    } catch (error: any) {
      console.error("Pre-generation error:", error);
      const isQuota = error.message.includes("429") || error.message.toLowerCase().includes("quota");
      if (isQuota) {
        addLog(`System-wide quota exhausted. The automation will pause and retry once the limits reset.`, "error");
        toast.error(`Quota exhausted. Please wait for reset or add more API keys.`);
      } else {
        toast.error(`Pre-generation failed: ${error.message}`);
      }
    } finally {
      setIsGenerating(false);
    }
  };

  // Auto-generation logic: If there are pending topics and no generated ones, start generating
  React.useEffect(() => {
    const pendingCount = queue.filter(t => t.status === 'pending').length;
    const generatedCount = queue.filter(t => t.status === 'generated').length;
    const shouldBeActive = pendingCount > 0 && generatedCount === 0 && !isGenerating;

    if (shouldBeActive) {
      setIsTimerActive(true);
      // If no target time is set in DB, set it
      if (!settings.nextGenerationAt) {
        const targetTime = Date.now() + (timerDuration * 1000);
        updateDoc(doc(db, "settings", "automation"), { nextGenerationAt: targetTime });
      }
    } else {
      setIsTimerActive(false);
      if (settings.nextGenerationAt) {
        updateDoc(doc(db, "settings", "automation"), { nextGenerationAt: null });
      }
    }
  }, [queue, isGenerating, timerDuration, settings.nextGenerationAt]);

  React.useEffect(() => {
    let interval: any;
    if (isTimerActive && settings.nextGenerationAt) {
      // Immediate sync
      const now = Date.now();
      const remaining = Math.max(0, Math.floor((settings.nextGenerationAt - now) / 1000));
      setCountdown(remaining);

      interval = setInterval(() => {
        const now = Date.now();
        const remaining = Math.max(0, Math.floor((settings.nextGenerationAt - now) / 1000));
        setCountdown(remaining);
        
        if (remaining === 0 && !isGenerating) {
          console.log("Timer hit zero, auto-triggering pre-generation...");
          preGenerate();
        }
      }, 1000);
    } else {
      setCountdown(timerDuration);
    }
    return () => clearInterval(interval);
  }, [isTimerActive, settings.nextGenerationAt, timerDuration, isGenerating]);

  const updateTimerDuration = async (newTotal: number) => {
    setTimerDuration(newTotal);
    setCountdown(newTotal);
    try {
      const updateData: any = { autoDelaySeconds: newTotal };
      // If timer is active, we should probably reset the target time
      if (isTimerActive) {
        updateData.nextGenerationAt = Date.now() + (newTotal * 1000);
      }
      await setDoc(doc(db, "settings", "automation"), updateData, { merge: true });
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, "settings/automation");
    }
  };

  const addToQueue = async () => {
    const topicList = topics.filter(t => t.topic.trim());
    if (topicList.length === 0) {
      toast.error("Enter topics to add to queue");
      return;
    }

    try {
      toast.info(`Adding ${topicList.length} topics to queue...`);
      for (const item of topicList) {
        await addDoc(collection(db, "queue"), {
          topic: item.topic,
          customInstructions: item.instructions,
          status: "pending",
          createdAt: serverTimestamp(),
          userId: user?.uid
        });
      }
      setTopics([{topic: "", instructions: ""}, {topic: "", instructions: ""}]);
      toast.success("Topics added to queue!");
      setView('queue');
    } catch (error: any) {
      handleFirestoreError(error, OperationType.CREATE, "queue");
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const fileExtension = file.name.split('.').pop()?.toLowerCase();

    const processLinks = async (data: any[]) => {
      const newLinks = data.map((row: any) => ({
        url: row.url || row.URL || row.link || row.Link,
        category: row.category || row.Category || "General",
        title: row.title || row.Title || ""
      })).filter(l => l.url);

      if (newLinks.length === 0) {
        toast.error("No valid links found. Ensure you have a 'url' column.");
        return;
      }

      try {
        const currentLinks = settings.categorizedLinks || [];
        const updatedLinks = [...currentLinks, ...newLinks];
        await updateSettings({ categorizedLinks: updatedLinks });
        toast.success(`Successfully added ${newLinks.length} links!`);
      } catch (err) {
        toast.error("Failed to save links to database");
      }
    };

    if (fileExtension === 'csv') {
      Papa.parse(file, {
        header: true,
        skipEmptyLines: true,
        complete: (results) => processLinks(results.data),
        error: (err) => toast.error(`Error parsing CSV: ${err.message}`)
      });
    } else if (fileExtension === 'xlsx' || fileExtension === 'xls') {
      const reader = new FileReader();
      reader.onload = (evt) => {
        try {
          const bstr = evt.target?.result;
          const wb = XLSX.read(bstr, { type: 'binary' });
          const wsname = wb.SheetNames[0];
          const ws = wb.Sheets[wsname];
          const data = XLSX.utils.sheet_to_json(ws);
          processLinks(data);
        } catch (err: any) {
          toast.error(`Error parsing Excel file: ${err.message}`);
        }
      };
      reader.readAsBinaryString(file);
    } else {
      toast.error("Unsupported file format. Please upload .csv, .xlsx, or .xls");
    }
  };

  const updateSettings = async (newSettings: any) => {
    try {
      await setDoc(doc(db, "settings", "automation"), newSettings, { merge: true });
      toast.success("Settings updated");
    } catch (error: any) {
      handleFirestoreError(error, OperationType.WRITE, "settings/automation");
    }
  };

  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  const deleteFromQueue = async (id: string, silent = false) => {
    try {
      await deleteDoc(doc(db, "queue", id));
      if (!silent) toast.success("Removed from queue");
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `queue/${id}`);
    }
    setDeleteConfirm(null);
  };

  const updateTopic = (index: number, field: 'topic' | 'instructions', value: string) => {
    const newTopics = [...topics];
    newTopics[index] = { ...newTopics[index], [field]: value };
    setTopics(newTopics);
  };

  const generateRandomTopics = () => {
    const randomTitles = [
      "The Future of AI in Sales Intelligence",
      "How Community-Led Growth is Changing SaaS",
      "Mastering Reddit Marketing for Startups",
      "SEO vs GEO: What You Need to Know in 2024",
      "Product Intelligence: The Key to User Retention",
      "Automating Lead Generation with AI",
      "The Rise of Generative Engine Optimization",
      "Building a Brand on Reddit: Do's and Don'ts",
      "Scaling Sales with AI-Powered Insights",
      "Why Community is the New Competitive Moat"
    ];
    
    const selected = [...randomTitles].sort(() => 0.5 - Math.random()).slice(0, 3);
    setTopics(selected.map(t => ({ topic: t, instructions: "Write in a professional yet engaging tone." })));
    toast.success("Random titles generated!");
  };

  const handleUpload = async (blog: any, image: string) => {
    const uploadToServer = async () => {
      const response = await fetch("/api/upload-blog", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: blog.title,
          slug: blog.slug,
          content: blog.content,
          author: blog.author,
          category: blog.category,
          excerpt: blog.excerpt,
          seoTitle: blog.seoTitle,
          seoDescription: blog.seoDescription,
          tags: blog.tags,
          altText: blog.altText,
          imageBase64: image,
          sanityConfig: {
            projectId: settings.sanityProjectId,
            dataset: settings.sanityDataset,
            token: settings.sanityToken
          }
        }),
      });

      const text = await response.text();
      let data;
      const contentType = response.headers.get("content-type");
      if (contentType && contentType.includes("application/json")) {
        data = JSON.parse(text);
      }

      if (!response.ok) {
        if (response.status === 404) {
          throw new Error("SERVER_404");
        }
        throw new Error(data?.error || text || `Server Error ${response.status}`);
      }
      return data;
    };

    const uploadToClient = async () => {
      const projectId = settings.sanityProjectId;
      const dataset = settings.sanityDataset || "production";
      const token = settings.sanityToken;

      if (!token || !projectId) {
        throw new Error("Sanity Project ID or Token missing in Settings");
      }

      const client = createClient({
        projectId,
        dataset,
        token,
        useCdn: false,
        apiVersion: "2023-05-03",
      });

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

      const authorRef = authorMappings[blog.author] || authorMappings["Mevin"];
      
      // Case-insensitive category mapping
      const normalizedCategory = blog.category?.trim().toLowerCase();
      const categoryRef = Object.entries(categoryMappings).find(
        ([key]) => key.toLowerCase() === normalizedCategory
      )?.[1];

      let mainImage = null;
      if (image) {
        try {
          const res = await fetch(image);
          const blob = await res.blob();
          const asset = await client.assets.upload("image", blob, {
            filename: `${blog.slug}.png`,
          });
          mainImage = {
            _type: "image",
            asset: { _type: "reference", _ref: asset._id },
          };
        } catch (imgErr: any) {
          console.error("Client-side image upload failed:", imgErr);
          // Continue without image if it fails (likely CORS)
        }
      }

      const docData = {
        _type: "post",
        title: blog.title,
        slug: { _type: "slug", current: blog.slug },
        excerpt: blog.excerpt,
        seoTitle: blog.seoTitle,
        seoDescription: blog.seoDescription,
        tags: blog.tags || [],
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
        body: blog.content,
        mainImage,
        featuredImage: mainImage,
        ogImage: mainImage,
        publishedAt: new Date().toISOString(),
      };

      return await client.create(docData);
    };

    try {
      setIsUploading(blog.slug || "uploading");
      toast.info(`Uploading "${blog.title}" to Sanity...`);
      
      let uploadSuccess = false;
      try {
        // Try server-side first
        const data = await uploadToServer();
        if (data.success) {
          toast.success("Uploaded to Sanity (via Server)!");
          uploadSuccess = true;
        }
      } catch (serverErr: any) {
        if (serverErr.message === "SERVER_404") {
          console.log("Server API not found (Shared App), falling back to client-side upload...");
          try {
            await uploadToClient();
            toast.success("Uploaded to Sanity (via Client)!");
            uploadSuccess = true;
          } catch (clientErr: any) {
            console.error("Client-side upload failed:", clientErr);
            const isCors = clientErr.message.includes("Request error") || clientErr.message.includes("Failed to fetch");
            if (isCors) {
              toast.error(
                <div className="space-y-2">
                  <p className="font-bold">CORS Error Detected</p>
                  <p className="text-xs">You are using the Shared App. Sanity blocks requests from new URLs by default.</p>
                  <p className="text-xs font-semibold">To fix: Add this URL to Sanity &rarr; Settings &rarr; API &rarr; CORS Origins</p>
                  <Button size="sm" variant="outline" className="h-7 text-[10px]" onClick={() => {
                    navigator.clipboard.writeText(window.location.origin);
                    toast.success("URL copied!");
                  }}>Copy URL</Button>
                </div>,
                { duration: 10000 }
              );
            } else {
              throw clientErr;
            }
          }
        } else {
          throw serverErr;
        }
      }

      // Automatically add to categorized links for future backlinks
      if (uploadSuccess) {
        try {
          const newLink = {
            url: `https://www.userixly.com/blog/${blog.slug}`,
            category: blog.category || "General",
            title: blog.title
          };
          
          const currentLinks = settings.categorizedLinks || [];
          // Check if already exists
          if (!currentLinks.some((l: any) => l.url === newLink.url)) {
            const updatedLinks = [...currentLinks, newLink];
            await updateSettings({ categorizedLinks: updatedLinks });
            console.log("Added new blog to internal links database");
          }
        } catch (linkErr) {
          console.error("Failed to auto-add link to database:", linkErr);
        }
      }
    } catch (error: any) {
      console.error("Sanity Upload Error:", error);
      let errorMsg = error.message;
      if (errorMsg.includes("Failed to fetch") || errorMsg.includes("NetworkError") || errorMsg.includes("Request error")) {
        errorMsg = "Network connection failed. Please check your internet and Sanity Project ID.";
      }
      toast.error("Upload failed: " + errorMsg);
      throw error; 
    } finally {
      setIsUploading(null);
    }
  };

  // Auto-upload logic: Watch for newly generated items
  React.useEffect(() => {
    if (!localAutoUploadEnabled) return;

    const generatedItems = queue.filter(t => t.status === 'generated');
    generatedItems.forEach(item => {
      if (!autoUploadQueue.includes(item.id)) {
        setAutoUploadQueue(prev => [...prev, item.id]);
        addLog(`Auto-upload scheduled for ${item.topic} in 5 seconds...`, "info");
        setTimeout(async () => {
          try {
            // Use a transaction to "lock" the upload process so only one instance does it
            const docRef = doc(db, "queue", item.id);
            await runTransaction(db, async (transaction) => {
              const sfDoc = await transaction.get(docRef);
              if (!sfDoc.exists()) throw new Error("Document does not exist!");
              if (sfDoc.data().status !== 'generated') throw new Error("Already uploading or completed by another instance.");
              
              // Mark as uploading to lock it
              transaction.update(docRef, { status: 'uploading' });
            });

            // If transaction succeeds, this instance is the winner
            addLog(`Lock acquired for ${item.topic}. Starting upload...`, "info");
            
            handleUpload(item.generatedContent, item.generatedContent.image).then(() => {
              // Mark as completed instead of deleting so it shows in "Recently Completed"
              updateDoc(doc(db, "queue", item.id), { 
                status: 'completed', 
                completedAt: serverTimestamp() 
              });
            }).catch(async (err) => {
              addLog(`Auto-upload failed for ${item.topic}: ${err.message}`, "error");
              // Revert status to generated so it can be retried
              await updateDoc(doc(db, "queue", item.id), { status: 'generated' });
            });
          } catch (lockError: any) {
            console.log("Auto-upload lock skip:", lockError.message);
            // This is expected if another instance already started the upload
          }
        }, 5000);
      }
    });
  }, [queue, autoUploadQueue, localAutoUploadEnabled]);

  if (isAuthLoading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-slate-50 text-slate-900">
        <Loader2 className="w-12 h-12 animate-spin text-indigo-600 mb-4" />
        <p className="text-slate-500 font-medium">Synchronizing with Rixly Database...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background relative overflow-hidden">
      <div className="absolute inset-0 geometric-grid pointer-events-none opacity-50" />
      <div className="container mx-auto py-10 px-4 max-w-6xl relative z-10">
      {/* Debug Info */}
      {(!settings.additionalApiKeys || settings.additionalApiKeys.filter((k: string) => k.trim()).length === 0) && (
        <div className="bg-red-500 text-white text-center py-2 rounded-lg mb-4 text-sm font-bold animate-pulse">
          ⚠️ No API keys configured! AI generation will not work. Please add at least one API key in the Settings tab.
        </div>
      )}
      {!process.env.SANITY_API_TOKEN && !settings.sanityToken && (
        <div className="bg-orange-500 text-white text-center py-2 rounded-lg mb-4 text-sm font-bold">
          ⚠️ SANITY_API_TOKEN is missing! Automation and uploads will fail. Please add it in Settings.
        </div>
      )}
      
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="space-y-8">
        {/* Navigation Header */}
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-white p-6 rounded-none border border-black shadow-none">
          <div className="flex items-center gap-4">
            <div className="h-12 w-12 rounded-none bg-black flex items-center justify-center text-white">
              <Sparkles className="h-6 w-6" />
            </div>
            <div>
              <h1 className="text-2xl font-display font-bold tracking-tighter text-slate-900 uppercase">Rixly Automator</h1>
              <p className="text-slate-500 text-[10px] font-mono tracking-widest uppercase">Full-scale blog automation.</p>
            </div>
          </div>
          
          <div className="flex items-center gap-2 overflow-x-auto pb-2 md:pb-0 w-full md:w-auto custom-scrollbar">
            <div className="flex bg-slate-50 p-1 rounded-none border border-slate-200 shrink-0">
              <NavButton active={view === 'dashboard'} onClick={() => setView('dashboard')} icon={<LayoutDashboard className="h-4 w-4" />} label="Dashboard" />
              <NavButton active={view === 'queue'} onClick={() => setView('queue')} icon={<ListTodo className="h-4 w-4" />} label="Queue" />
              <NavButton active={view === 'settings'} onClick={() => setView('settings')} icon={<SettingsIcon className="h-4 w-4" />} label="Settings" />
            </div>
            {onLogout && (
              <Button variant="ghost" size="sm" onClick={onLogout} className="text-slate-500 hover:text-red-600 hover:bg-red-50">
                <LogOut className="h-4 w-4 mr-2" />
                Logout
              </Button>
            )}
          </div>
        </div>

        {view === 'dashboard' && (
          <div className="space-y-8">
            <div className="flex justify-between items-center">
              <h2 className="text-xl font-display font-bold text-slate-900 border-l-4 border-black pl-4">Title Manager</h2>
              <div className="flex gap-2">
                <Button variant="outline" size="lg" onClick={generateRandomTopics} className="rounded-none border-black text-black hover:bg-black hover:text-white transition-all">
                  <Sparkles className="mr-2 h-4 w-4" />
                  Random Titles
                </Button>
                <Button size="lg" onClick={addToQueue} disabled={isGenerating} className="rounded-none bg-black hover:bg-slate-800 text-white shadow-none">
                  <ListTodo className="mr-2 h-5 w-5" />
                  Add to Queue
                </Button>
              </div>
            </div>

            <AnimatePresence>
              {showLogs && (
                <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
                  <Card className="bg-black border-black text-white font-mono text-sm rounded-none">
                    <CardHeader className="border-b border-white/10 py-3 flex flex-row items-center justify-between">
                      <CardTitle className="text-[10px] font-bold tracking-widest uppercase flex items-center gap-2">
                        <div className="h-2 w-2 bg-green-500 animate-pulse" />
                        Live Logic Stream
                      </CardTitle>
                      <Button variant="ghost" size="sm" onClick={() => setShowLogs(false)} className="h-8 text-white/50 hover:text-white hover:bg-white/10 rounded-none">Close</Button>
                    </CardHeader>
                    <CardContent ref={logContainerRef} className="p-4 max-h-[300px] overflow-y-auto space-y-1 scroll-smooth">
                      {logs.map((log, i) => (
                        <div key={i} className="flex gap-3 text-[11px]">
                          <span className="text-white/30 whitespace-nowrap">[{log.timestamp}]</span>
                          <span className={log.type === 'success' ? 'text-green-400' : log.type === 'error' ? 'text-red-400' : 'text-white/80'}>{log.message}</span>
                        </div>
                      ))}
                    </CardContent>
                  </Card>
                </motion.div>
              )}
            </AnimatePresence>

            <div className="max-w-xl mx-auto">
              <Card className="border-black shadow-none rounded-none">
                <CardHeader className="border-b border-slate-100"><CardTitle className="text-lg font-display uppercase tracking-tight">Enter Titles</CardTitle></CardHeader>
                <CardContent className="space-y-6 pt-6">
                  <div className="space-y-3">
                    <div className="flex justify-between items-center">
                      <Label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Titles & Instructions</Label>
                      <Button variant="ghost" size="sm" onClick={() => setTopics([...topics, {topic: "", instructions: ""}])} className="h-7 text-black text-[10px] font-bold uppercase tracking-wider hover:bg-slate-50">+ Add Item</Button>
                    </div>
                    <div className="space-y-4 max-h-[500px] overflow-y-auto pr-2 custom-scrollbar">
                      {topics.map((item, index) => (
                        <div key={index} className="p-4 bg-slate-50/50 rounded-none border-l-2 border-slate-200 space-y-3 relative group">
                          <div className="flex gap-2 items-center">
                            <Input 
                              placeholder={`Title ${index + 1}`} 
                              value={item.topic} 
                              onChange={(e) => updateTopic(index, 'topic', e.target.value)} 
                              className="h-10 text-sm bg-white rounded-none border-slate-200 focus-visible:ring-black" 
                            />
                            {topics.length > 1 && (
                              <Button 
                                variant="ghost" 
                                size="icon" 
                                onClick={() => setTopics(topics.filter((_, i) => i !== index))} 
                                className="h-8 w-8 text-slate-300 hover:text-black transition-colors rounded-none"
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            )}
                          </div>
                          <Textarea 
                            placeholder="Instructions..." 
                            value={item.instructions} 
                            onChange={(e) => updateTopic(index, 'instructions', e.target.value)}
                            className="min-h-[60px] text-xs resize-none bg-white rounded-none border-slate-200 focus-visible:ring-black"
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        )}

        {view === 'queue' && (
          <div className="space-y-6">
            <div className="flex justify-between items-center">
              <div className="flex items-center gap-6">
                <h2 className="text-2xl font-bold font-display uppercase border-l-4 border-black pl-4">Title Queue</h2>
                <div className="flex items-center gap-2 bg-slate-50 p-1 border border-slate-200 rounded-none">
                  <div className="px-3 py-1.5 bg-white border border-slate-200 rounded-none flex items-center gap-2">
                    <Clock className={`h-4 w-4 ${isTimerActive ? 'text-black animate-pulse' : 'text-slate-300'}`} />
                    <span className="text-sm font-mono font-bold text-slate-900 min-w-[60px] text-center">{formatTime(countdown)}</span>
                  </div>
                  <div className="flex items-center gap-1 px-3 border-l border-slate-200">
                    <span className="text-[9px] font-bold text-slate-400 uppercase tracking-tighter self-center mt-0.5">Delay Target:</span>
                    <div className="flex items-center gap-0.5">
                      <input 
                        type="number" 
                        placeholder="H"
                        min="0"
                        className="w-7 bg-transparent text-xs font-mono font-bold text-black focus:outline-none text-center"
                        value={Math.floor(timerDuration / 3600) || ""}
                        onChange={(e) => {
                          const h = parseInt(e.target.value) || 0;
                          const currentM = Math.floor((timerDuration % 3600) / 60);
                          const currentS = timerDuration % 60;
                          const newTotal = (h * 3600) + (currentM * 60) + currentS;
                          updateTimerDuration(newTotal);
                        }}
                      />
                      <span className="text-[10px] font-mono text-slate-300">h</span>
                      <input 
                        type="number" 
                        placeholder="M"
                        min="0"
                        max="59"
                        className="w-7 bg-transparent text-xs font-mono font-bold text-black focus:outline-none text-center"
                        value={Math.floor((timerDuration % 3600) / 60) || ""}
                        onChange={(e) => {
                          const m = parseInt(e.target.value) || 0;
                          const currentH = Math.floor(timerDuration / 3600);
                          const currentS = timerDuration % 60;
                          const newTotal = (currentH * 3600) + (m * 60) + currentS;
                          updateTimerDuration(newTotal);
                        }}
                      />
                      <span className="text-[10px] font-mono text-slate-300">m</span>
                      <input 
                        type="number" 
                        placeholder="S"
                        min="0"
                        max="59"
                        className="w-7 bg-transparent text-xs font-mono font-bold text-black focus:outline-none text-center"
                        value={timerDuration % 60 || ""}
                        onChange={(e) => {
                          const s = parseInt(e.target.value) || 0;
                          const currentH = Math.floor(timerDuration / 3600);
                          const currentM = Math.floor((timerDuration % 3600) / 60);
                          const newTotal = (currentH * 3600) + (currentM * 60) + s;
                          updateTimerDuration(newTotal);
                        }}
                      />
                      <span className="text-[10px] font-mono text-slate-300">s</span>
                    </div>
                  </div>
                </div>
                <Button 
                  onClick={() => preGenerate()} 
                  disabled={isGenerating || queue.filter(t => t.status === 'pending').length === 0}
                  className="rounded-none bg-black hover:bg-slate-800 text-white shadow-none px-6 uppercase font-display text-xs tracking-wider"
                >
                  {isGenerating ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Sparkles className="h-4 w-4 mr-2" />}
                  Generate Next
                </Button>
              </div>
              <div className="flex gap-4 items-center">
                <div className="flex items-center gap-1.5 px-3 py-1 bg-white border border-black rounded-none text-black text-[10px] font-bold uppercase tracking-widest">
                  <Sparkles className="h-3 w-3" />
                  {queue.filter(t => t.status === 'generated').length} Generated
                </div>
                <div className="flex items-center gap-1.5 px-3 py-1 bg-slate-50 border border-slate-200 rounded-none text-slate-500 text-[10px] font-bold uppercase tracking-widest">
                  <Clock className="h-3 w-3" />
                  {queue.filter(t => t.status === 'pending').length} Pending
                </div>
                <div className="flex items-center gap-1.5 px-3 py-1 bg-black border border-black rounded-none text-white text-[10px] font-bold uppercase tracking-widest">
                  <CheckCircle className="h-3 w-3" />
                  {queue.filter(t => t.status === 'completed').length} Completed
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
              <div className="space-y-4">
                <h3 className="font-semibold text-slate-700 flex items-center gap-2">
                  <ListTodo className="h-4 w-4" /> Pending & Generated
                </h3>
                <div className="space-y-3">
                  {queue.filter(t => t.status !== 'completed').map((item) => (
                    <Card key={item.id} className={`border-slate-200 shadow-sm hover:shadow-md transition-all ${item.status === 'generated' ? 'border-l-4 border-l-blue-500' : ''}`}>
                      <CardContent className="p-4 flex justify-between items-center">
                        <div className="flex items-center gap-3">
                          <div className={`h-10 w-10 rounded-lg flex items-center justify-center ${item.status === 'generated' ? 'bg-blue-100 text-blue-600' : 'bg-slate-100 text-slate-400'}`}>
                            {item.status === 'generated' ? <Sparkles className="h-5 w-5" /> : <Clock className="h-5 w-5" />}
                          </div>
                          <div>
                            <p className="font-medium text-slate-900">{item.topic}</p>
                            <p className="text-xs text-slate-500">
                              {item.status === 'generated' ? 'Generated & Ready for Review' : 'Waiting for automation...'}
                            </p>
                          </div>
                        </div>
                        <div className="flex gap-2">
                          {item.status === 'generated' && (
                            <>
                              <Button variant="outline" size="sm" onClick={() => setPreviewBlog(item.generatedContent)} className="h-8 text-blue-600 border-blue-200 hover:bg-blue-50">
                                <Eye className="h-4 w-4 mr-1" /> Preview
                              </Button>
                              <Button 
                                size="sm" 
                                disabled={isUploading !== null}
                                onClick={() => handleUpload(item.generatedContent, item.generatedContent.image).then(() => {
                                  updateDoc(doc(db, "queue", item.id), { status: 'completed', completedAt: serverTimestamp() })
                                    .catch(e => handleFirestoreError(e, OperationType.UPDATE, `queue/${item.id}`));
                                })} 
                                className="h-8 bg-indigo-600 text-white"
                              >
                                {isUploading === item.generatedContent.slug ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <UploadCloud className="h-4 w-4 mr-1" />}
                                Upload
                              </Button>
                            </>
                          )}
                          <Button 
                            variant="ghost" 
                            size="icon" 
                            onClick={() => setDeleteConfirm(item.id)} 
                            className="h-8 w-8 text-slate-400 hover:text-red-500 hover:bg-red-50"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                  {queue.filter(t => t.status !== 'completed').length === 0 && (
                    <div className="text-center py-10 border-2 border-dashed border-slate-100 rounded-xl text-slate-400 text-sm">Queue is empty</div>
                  )}
                </div>
              </div>

              <div className="space-y-4">
                <div className="flex justify-between items-center">
                  <h3 className="font-semibold text-slate-700 flex items-center gap-2">
                    <CheckCircle className="h-4 w-4" /> Recently Completed
                  </h3>
                  {queue.filter(t => t.status === 'completed').length > 0 && (
                    <Button 
                      variant="ghost" 
                      size="sm" 
                      onClick={async () => {
                        const completed = queue.filter(t => t.status === 'completed');
                        toast.info(`Clearing ${completed.length} completed topics...`);
                        for (const item of completed) {
                          await deleteDoc(doc(db, "queue", item.id));
                        }
                        toast.success("Completed topics cleared");
                      }}
                      className="h-7 text-[10px] text-slate-400 hover:text-red-500"
                    >
                      Clear All
                    </Button>
                  )}
                </div>
                <div className="space-y-3">
                  {queue
                    .filter(t => t.status === 'completed')
                    .sort((a, b) => (b.completedAt?.toMillis() || 0) - (a.completedAt?.toMillis() || 0))
                    .slice(0, 10)
                    .map((item) => (
                    <Card key={item.id} className="p-3 flex justify-between items-center bg-slate-50 border-slate-100 group">
                      <div className="flex flex-col">
                        <span className="text-sm text-slate-500 line-through">{item.topic}</span>
                        <span className="text-[10px] text-slate-400 font-mono">{item.completedAt?.toDate().toLocaleDateString()}</span>
                      </div>
                      <div className="flex items-center gap-1">
                        {item.generatedContent && (
                          <Button 
                            variant="ghost" 
                            size="icon" 
                            onClick={() => setPreviewBlog(item.generatedContent)} 
                            className="h-7 w-7 text-blue-400 hover:text-blue-600 hover:bg-blue-50"
                            title="Preview Content"
                          >
                            <Eye className="h-3.5 w-3.5" />
                          </Button>
                        )}
                        <Button 
                          variant="ghost" 
                          size="icon" 
                          onClick={() => setDeleteConfirm(item.id)} 
                          className="h-7 w-7 text-slate-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </Card>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Preview Modal */}
        <AnimatePresence>
          {previewBlog && (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
              <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }} className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
                <div className="p-4 border-b flex justify-between items-center bg-slate-50">
                  <h3 className="font-bold text-slate-900">Blog Preview</h3>
                  <Button variant="ghost" size="sm" onClick={() => setPreviewBlog(null)}>Close</Button>
                </div>
                <div className="flex-1 overflow-y-auto p-6">
                  <BlogCard blog={previewBlog} image={previewBlog.image} isUploading={isUploading !== null} onUpload={async () => {
                    await handleUpload(previewBlog, previewBlog.image);
                    setPreviewBlog(null);
                  }} />
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>

        {/* Delete Confirmation Modal */}
        <AnimatePresence>
          {deleteConfirm && (
            <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
              <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }} className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 space-y-6">
                <div className="space-y-2 text-center">
                  <div className="h-12 w-12 rounded-full bg-red-100 text-red-600 flex items-center justify-center mx-auto">
                    <Trash2 className="h-6 w-6" />
                  </div>
                  <h3 className="text-xl font-bold text-slate-900">Delete Topic?</h3>
                  <p className="text-slate-500 text-sm">Are you sure you want to remove this topic from the queue? This action cannot be undone.</p>
                </div>
                <div className="flex gap-3">
                  <Button variant="outline" className="flex-1" onClick={() => setDeleteConfirm(null)}>Cancel</Button>
                  <Button variant="destructive" className="flex-1" onClick={() => deleteFromQueue(deleteConfirm)}>Delete</Button>
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>

        {view === 'settings' && (
          <div className="max-w-2xl mx-auto space-y-10">
            <h2 className="text-2xl font-bold font-display uppercase border-l-4 border-black pl-4">System Settings</h2>
            
            <section className="space-y-6">
              <div className="flex items-center justify-between border-b-2 border-black pb-2">
                <h3 className="text-sm font-bold uppercase tracking-[0.2em]">Core Configuration Matrix</h3>
              </div>
              
              <div className="space-y-8">
                {/* API Keys */}
                <div className="space-y-4">
                  <div className="flex justify-between items-end">
                    <Label className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Gemini API Matrix</Label>
                    {settings.preferredApiKey && (
                      <Button 
                        variant="ghost" 
                        size="sm" 
                        onClick={() => updateSettings({ preferredApiKey: null })}
                        className="h-5 text-[9px] font-bold text-red-500 hover:text-red-600 p-0 uppercase tracking-widest"
                      >
                        Reset Primary
                      </Button>
                    )}
                  </div>
                  <div className="space-y-3">
                    {(settings.additionalApiKeys || []).map((key: string, i: number) => (
                      <div key={i} className="flex gap-2 group">
                        <div className="relative flex-1">
                          <Input 
                            type="password" 
                            value={key} 
                            onChange={(e) => {
                              const newKeys = [...settings.additionalApiKeys];
                              newKeys[i] = e.target.value;
                              updateSettings({ additionalApiKeys: newKeys });
                            }}
                            placeholder="X-KEY-OMNIPRESENCE"
                            className={`h-11 text-sm rounded-none border-slate-200 focus-visible:ring-black font-mono ${settings.preferredApiKey === key && key ? 'border-black ring-1 ring-black' : ''}`}
                          />
                          {key && (
                            <div className="absolute right-3 top-1/2 -translate-y-1/2">
                              {settings.preferredApiKey === key ? (
                                <span className="text-[9px] font-bold text-white bg-black px-2 py-1 uppercase tracking-widest">Active</span>
                              ) : (
                                <Button 
                                  variant="outline" 
                                  size="sm" 
                                  onClick={() => updateSettings({ preferredApiKey: key })}
                                  className="h-7 text-[9px] font-bold border-black text-black hover:bg-black hover:text-white rounded-none uppercase tracking-widest"
                                >
                                  Deploy
                                </Button>
                              )}
                            </div>
                          )}
                        </div>
                        <Button 
                          variant="ghost" 
                          size="icon" 
                          className="h-11 w-11 border border-slate-200 rounded-none hover:bg-red-50 hover:text-red-500"
                          onClick={() => {
                            const newKeys = settings.additionalApiKeys.filter((_: any, idx: number) => idx !== i);
                            const updates: any = { additionalApiKeys: newKeys };
                            if (settings.preferredApiKey === key) updates.preferredApiKey = null;
                            updateSettings(updates);
                          }}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    ))}
                    <Button 
                      variant="outline" 
                      size="sm" 
                      onClick={() => {
                        const newKeys = [...(settings.additionalApiKeys || []), ""];
                        updateSettings({ additionalApiKeys: newKeys });
                      }} 
                      className="w-full h-11 text-[10px] font-bold uppercase tracking-[0.2em] rounded-none border-dashed border-slate-300 hover:border-black transition-colors"
                    >
                      + Add Key to Matrix
                    </Button>
                  </div>
                </div>

                {/* OpenRouter */}
                <div className="space-y-2 pt-4">
                  <Label className="text-[10px] font-bold uppercase tracking-widest text-slate-400">OpenRouter Fallback</Label>
                  <Input 
                    type="password" 
                    value={settings.openRouterKey || ""} 
                    onChange={(e) => updateSettings({ openRouterKey: e.target.value })}
                    placeholder="sk-or-..."
                    className="h-11 text-sm rounded-none border-slate-200 focus-visible:ring-black font-mono"
                  />
                </div>

                {/* Source Data */}
                <div className="space-y-4 pt-6">
                  <Label className="flex justify-between items-center bg-slate-50 p-3 border border-slate-100">
                    <span className="text-[10px] font-bold uppercase tracking-widest text-black">Source Database (CSV/Excel)</span>
                    <div className="flex gap-2">
                      {settings.categorizedLinks?.length > 0 && (
                        <Button 
                          variant="ghost" 
                          size="sm" 
                          onClick={() => updateSettings({ categorizedLinks: [] })}
                          className="h-7 text-[9px] font-bold text-red-500 uppercase tracking-widest px-2"
                        >
                          Purge ({settings.categorizedLinks.length})
                        </Button>
                      )}
                      <Button variant="outline" size="sm" className="h-7 text-[9px] font-bold uppercase tracking-widest relative rounded-none border-black bg-white">
                        Synchronize File
                        <input 
                          type="file" 
                          accept=".csv, .xlsx, .xls" 
                          onChange={handleFileUpload} 
                          className="absolute inset-0 opacity-0 cursor-pointer" 
                        />
                      </Button>
                    </div>
                  </Label>
                  <div className="bg-white rounded-none p-4 max-h-[250px] overflow-y-auto border border-black/5 font-mono">
                    {settings.categorizedLinks?.length > 0 ? (
                      <div className="space-y-4">
                        {Array.from(new Set(settings.categorizedLinks.map((l: any) => l.category))).map((cat: any) => (
                          <div key={cat} className="space-y-1.5">
                            <p className="text-[9px] font-bold text-black border-b border-black/10 pb-1 uppercase tracking-[0.1em]">{cat}</p>
                            <div className="flex flex-wrap gap-1.5 pt-1">
                              {settings.categorizedLinks.filter((l: any) => l.category === cat).map((l: any, i: number) => (
                                <div key={i} className="text-[9px] bg-slate-50 border border-slate-200 px-2 py-1 rounded-none text-slate-500 truncate max-w-[200px]">
                                  {l.url}
                                </div>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-[10px] text-slate-400 text-center py-10 tracking-widest uppercase opacity-50">No external link data loaded.</p>
                    )}
                  </div>
                </div>

                {/* Backlinks */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <Label className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Backlink Registry</Label>
                    <Textarea 
                      placeholder="https://..."
                      value={settings.defaultOldLinks?.join('\n') || ""}
                      onChange={(e) => updateSettings({ defaultOldLinks: e.target.value.split('\n').filter(l => l.trim()) })}
                      className="h-32 text-[10px] font-mono rounded-none border-slate-200 focus-visible:ring-black resize-none"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Internal Link Matrix</Label>
                    <Textarea 
                      placeholder="https://..."
                      value={settings.defaultInternalLinks?.join('\n') || ""}
                      onChange={(e) => updateSettings({ defaultInternalLinks: e.target.value.split('\n').filter(l => l.trim()) })}
                      className="h-32 text-[10px] font-mono rounded-none border-slate-200 focus-visible:ring-black resize-none"
                    />
                  </div>
                </div>
                
                {/* Integration */}
                <div className="space-y-6 pt-10 border-t-2 border-black">
                  <Label className="text-black font-bold uppercase tracking-[0.2em] flex items-center gap-3">
                    <div className="h-6 w-1 bg-black" />
                    Sanity Integration
                  </Label>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="space-y-2">
                      <Label className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Project Workspace ID</Label>
                      <Input 
                        value={settings.sanityProjectId || ""} 
                        onChange={(e) => updateSettings({ sanityProjectId: e.target.value })}
                        placeholder="abcdef12"
                        className="h-11 rounded-none border-slate-200 focus-visible:ring-black"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Dataset Environment</Label>
                      <Input 
                        value={settings.sanityDataset || "production"} 
                        onChange={(e) => updateSettings({ sanityDataset: e.target.value })}
                        placeholder="production"
                        className="h-11 rounded-none border-slate-200 focus-visible:ring-black uppercase font-bold text-[11px]"
                      />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Security Token</Label>
                    <Input 
                      type="password"
                      value={settings.sanityToken || ""} 
                      onChange={(e) => updateSettings({ sanityToken: e.target.value })}
                      placeholder="sk..."
                      className="h-11 rounded-none border-slate-200 focus-visible:ring-black"
                    />
                  </div>
                </div>

                {/* Operations */}
                <div className="pt-10 border-t border-slate-100 flex flex-col gap-4">
                  <div className="flex items-center justify-between p-4 bg-slate-50 border border-slate-200 rounded-none">
                    <div className="space-y-1">
                      <Label className="text-xs font-bold uppercase tracking-widest text-black">Autonomous Dispatch</Label>
                      <p className="text-[9px] text-slate-500 uppercase tracking-tighter">Automatic Sanity uploads on generation.</p>
                    </div>
                    <Button 
                      size="sm" 
                      variant={localAutoUploadEnabled ? "default" : "outline"}
                      onClick={() => setLocalAutoUploadEnabled(!localAutoUploadEnabled)}
                      className={`h-9 px-6 rounded-none uppercase font-bold tracking-widest text-[10px] transition-all ${localAutoUploadEnabled ? 'bg-black text-white' : 'border-slate-300'}`}
                    >
                      {localAutoUploadEnabled ? 'Active' : 'Standby'}
                    </Button>
                  </div>

                  <Button 
                    variant="outline" 
                    size="lg" 
                    onClick={async () => {
                      try {
                        addLog("Diagnostic: Starting API Bridge Test...", "info");
                        await generateBlog("Test Topic", [], [], settings.additionalApiKeys || [], settings.preferredApiKey, settings.openRouterKey);
                        addLog("Diagnostic: Bridge stable. Generation successful.", "success");
                        toast.success("API Matrix Operational");
                      } catch (err: any) {
                        addLog(`Diagnostic Error: ${err.message}`, "error");
                        toast.error("Bridge Connection Failed");
                      }
                    }}
                    className="w-full h-12 rounded-none border-2 border-black font-display font-bold uppercase tracking-[0.2em] hover:bg-black hover:text-white transition-all"
                  >
                    Run Matrix Diagnostics
                  </Button>
                </div>
              </div>
            </section>
          </div>
        )}
      </motion.div>
      </div>
    </div>
  );
}

function NavButton({ active, onClick, icon, label }: { active: boolean, onClick: () => void, icon: React.ReactNode, label: string }) {
  return (
    <Button 
      variant={active ? 'secondary' : 'ghost'} 
      size="sm" 
      onClick={onClick} 
      className={`rounded-none transition-all ${active ? 'bg-black text-white px-6' : 'text-slate-500 px-4'}`}
    >
      {icon}
      <span className="ml-2 font-display text-[11px] font-bold tracking-wider uppercase">{label}</span>
    </Button>
  );
}

function BlogCard({ blog, image, isUploading, onUpload }: { blog: any, image: string, isUploading: boolean, onUpload: () => void }) {
  return (
    <Card className="overflow-hidden border-black shadow-none rounded-none">
      <div className="aspect-video relative bg-slate-50">
        <img src={image} alt={blog.title} className="w-full h-full object-cover" />
        <div className="absolute top-4 right-4">
          <Button 
            onClick={onUpload} 
            disabled={isUploading}
            className="bg-black text-white hover:bg-slate-800 rounded-none border border-black uppercase text-[10px] font-bold tracking-widest px-4 h-9 shadow-lg shadow-black/10"
          >
            {isUploading ? <Loader2 className="h-3 w-3 animate-spin mr-2" /> : null}
            Commit to Hub
          </Button>
        </div>
      </div>
      <CardHeader className="border-b border-slate-100 pb-6">
        <div className="flex justify-between items-start gap-4">
          <div className="flex-1">
            <CardTitle className="text-2xl font-display font-bold leading-tight uppercase tracking-tight">{blog.title}</CardTitle>
            <p className="text-[10px] font-mono text-slate-400 mt-2 uppercase tracking-tighter">System ID: {blog.slug}</p>
          </div>
          <div className="text-right flex flex-col items-end gap-3 shrink-0">
            <div>
              <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">Creator</p>
              <p className="text-xs font-bold text-black uppercase">{blog.author}</p>
            </div>
            <div>
              <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">Classification</p>
              <p className="text-[9px] px-2 py-0.5 bg-black text-white font-bold inline-block uppercase tracking-wider">{blog.category}</p>
            </div>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          {blog.tags?.map((tag: string, i: number) => (
            <span key={i} className="text-[9px] border border-black text-black px-2 py-0.5 rounded-none font-bold uppercase tracking-widest bg-white">#{tag}</span>
          ))}
        </div>
      </CardHeader>
      <CardContent className="pt-6 space-y-6">
        <div className="bg-slate-50 border-l-4 border-black p-4 space-y-4">
          <div>
            <p className="text-[9px] font-bold text-black uppercase tracking-widest">Logic Summary</p>
            <p className="text-xs text-slate-600 font-medium leading-relaxed mt-1">"{blog.excerpt}"</p>
          </div>
          <div className="grid grid-cols-2 gap-4 border-t border-slate-100 pt-3">
            <div>
              <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">SEO Registry Title</p>
              <p className="text-xs text-black font-bold uppercase tracking-tight mt-0.5">{blog.seoTitle}</p>
            </div>
            <div>
              <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">SEO Meta String</p>
              <p className="text-[10px] text-slate-600 font-mono leading-tight mt-0.5">{blog.seoDescription}</p>
            </div>
          </div>
        </div>
        <div className="prose prose-slate max-w-none text-slate-800 max-h-[500px] overflow-y-auto custom-scrollbar pr-4 prose-p:my-6 prose-headings:font-display prose-headings:uppercase prose-headings:tracking-wider prose-h2:text-2xl prose-h3:text-xl prose-strong:text-black">
          <ReactMarkdown rehypePlugins={[rehypeRaw]}>{blog.content}</ReactMarkdown>
        </div>
      </CardContent>
    </Card>
  );
}
