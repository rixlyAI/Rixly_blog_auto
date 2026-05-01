import { GoogleGenAI, Type } from "@google/genai";

export interface BlogContent {
  title: string;
  author: string;
  slug: string;
  content: string;
  category: string;
  excerpt: string;
  seoTitle: string;
  seoDescription: string;
  tags: string[];
  faq: { question: string; answer: string }[];
  chartData: any[];
  chartConfig: {
    type: "bar" | "line" | "pie";
    xAxisKey: string;
    dataKey: string;
    title: string;
  };
  imagePrompt: string;
  altText: string;
}

async function callWithRetry<T>(
  apiKeys: string[],
  operation: (ai: any) => Promise<T>,
  preferredKey?: string,
  openRouterKey?: string
): Promise<T> {
  // If OpenRouter key is provided, we can use it as a fallback or primary
  // For now, let's stick to the rotation logic but include OpenRouter if requested
  
  let lastError: any;
  let keys = [...apiKeys];
  
  // Include the platform's default key if available
  const envKey = process.env.GEMINI_API_KEY;
  if (envKey && !keys.includes(envKey)) {
    keys.push(envKey);
  }
  
  if (preferredKey) {
    // Prioritize the preferred key by moving it to the front
    keys = [preferredKey, ...keys.filter(k => k !== preferredKey)];
  }

  const uniqueKeys = Array.from(new Set(keys.filter(k => !!k)));
  
  if (uniqueKeys.length === 0) {
    throw new Error("No Gemini API keys configured. Please add at least one API key in the Settings tab to start generating content.");
  }

  let keysAttempted = 0;

  for (const key of uniqueKeys) {
    keysAttempted++;
    const ai = new GoogleGenAI({ apiKey: key });
    
    // Internal retry loop for the same key (handles transient server/proxy blips)
    let internalAttempts = 0;
    const maxInternalAttempts = 3;
    
    while (internalAttempts < maxInternalAttempts) {
      internalAttempts++;
      try {
        const result = await operation(ai);
        // If the operation returned something that looks like an empty response, treat it as an error to trigger retry
        if (result && (result as any).text === "") {
          throw new Error("Empty response from Gemini");
        }
        return result;
      } catch (error: any) {
        lastError = error;
        
        // Extract full error context for better detection
        const errorStr = JSON.stringify(error);
        const errorString = String(error).toLowerCase();
        const errorMsg = (error.message || "").toLowerCase();
        
        const isQuotaError = 
          errorString.includes("429") || 
          errorString.includes("resource_exhausted") ||
          errorMsg.includes("quota") || 
          errorMsg.includes("limit") ||
          errorMsg.includes("429") ||
          errorStr.includes("429");

        // Attempt to extract retry delay from error if it's a quota issue
        let waitTime = 1000; // Default 1s
        if (isQuotaError) {
          try {
            // The error might contain hints about retry duration
            const match = errorString.match(/retry in ([\d.]+)s/);
            if (match && match[1]) {
              waitTime = (parseFloat(match[1]) + 2) * 1000; // Multiplied to ms, +2s safety buffer
            } else if (errorStr.includes("retryDelay")) {
               // Try to find the duration in 'details'
               const detailMatch = errorStr.match(/"retryDelay":\s*"(\d+)s"/);
               if (detailMatch && detailMatch[1]) {
                 waitTime = (parseInt(detailMatch[1]) + 2) * 1000;
               }
            } else {
              // Default exponential backoff based on keysAttempted
              waitTime = Math.min(60000, Math.pow(2, keysAttempted) * 2000);
            }
          } catch (e) {
            waitTime = 5000;
          }
        }

        const isServerError = 
          errorString.includes("500") || 
          errorString.includes("503") || 
          errorString.includes("rpc failed") || 
          errorString.includes("xhr error") ||
          errorMsg.includes("service unavailable") || 
          errorMsg.includes("server is busy") ||
          errorMsg.includes("empty response") ||
          errorStr.includes("500") ||
          errorStr.includes("503");

        const isPermissionError = 
          errorString.includes("403") || 
          errorMsg.includes("permission_denied") || 
          errorMsg.includes("not have permission") ||
          errorStr.includes("403");

        const isRecitationError = 
          errorString.includes("recitation") || 
          errorMsg.includes("recitation") ||
          errorStr.includes("recitation");

        const isNotFoundError = 
          errorString.includes("404") || 
          errorMsg.includes("not found") || 
          errorMsg.includes("entity was not found") ||
          errorStr.includes("404");

        if (isQuotaError || isServerError || isPermissionError || isNotFoundError || isRecitationError) {
          const typeLabel = isQuotaError ? 'Quota' : (isServerError ? 'Server' : (isPermissionError ? 'Permission' : (isNotFoundError ? 'NotFound' : 'Recitation')));
          
          // For server errors, we can try the same key again up to maxInternalAttempts
          if (isServerError && internalAttempts < maxInternalAttempts) {
            console.warn(`API Key #${keysAttempted} internal retry ${internalAttempts}/${maxInternalAttempts} (${typeLabel} Error: ${errorMsg || 'unspecified'}), waiting 2s...`);
            await new Promise(resolve => setTimeout(resolve, 2000));
            continue; // Retry with the SAME key
          }

          console.warn(`API Key #${keysAttempted} issue detected (${typeLabel} Error: ${errorMsg || 'unspecified'}), waiting ${waitTime/1000}s then trying next key...`);
          
          // Wait before moving to next key
          await new Promise(resolve => setTimeout(resolve, waitTime));
          break; // Exit internal loop, move to NEXT key in the for loop
        }
        
        console.warn(`Operation failed with key #${keysAttempted}, trying next key... Error: ${errorMsg}`);
        break; // Exit internal loop, move to NEXT key
      }
    }
  }
  
  // If we're here, all keys failed. Provide a clear message.
  const finalError = lastError?.message || JSON.stringify(lastError) || "Unknown error";
  const finalErrorLower = finalError.toLowerCase();

  if (finalError.includes("429") || finalErrorLower.includes("quota") || finalErrorLower.includes("limit")) {
    throw new Error(`All ${keysAttempted} available API keys (including backups) have exhausted their quota. Please add more API keys from different Google Cloud projects in Settings, or wait for the quota to reset. Details: ${finalError}`);
  }

  if (finalError.includes("403") || finalErrorLower.includes("permission") || finalErrorLower.includes("not have permission")) {
    throw new Error(`All ${keysAttempted} available API keys failed with a Permission Denied (403) error. 

To fix this:
1. Go to Google AI Studio (aistudio.google.com).
2. Ensure you have enabled the "Generative Language API" for your project.
3. If using Google Cloud Console, ensure the API key has "Generative Language API" in its allowed APIs list.
4. Try creating a fresh API key in AI Studio.

Details: ${finalError}`);
  }

  throw lastError || new Error(`All ${keysAttempted} API keys failed. Last error: ${finalError}`);
}

function handleResponse(result: any, modelName: string) {
  // Check for safety/recitation blocks
  const candidate = result.response?.candidates?.[0] || result.candidates?.[0];
  if (candidate?.finishReason === "RECITATION") {
    throw new Error("The content was blocked due to 'RECITATION' (it was too similar to existing copyrighted material). I will retry with a more unique approach.");
  }
  if (candidate?.finishReason === "SAFETY") {
    throw new Error("The content was blocked by safety filters. I will retry with a safer approach.");
  }

  let text = "";
  try {
    text = result.text;
  } catch (e) {
    console.error(`Gemini Response Error (${modelName}):`, JSON.stringify(result, null, 2));
    throw new Error(`Could not extract text from Gemini response (${modelName}). Reason: ${candidate?.finishReason || 'Unknown'}`);
  }

  if (!text) {
    throw new Error(`Empty response from Gemini (${modelName}).`);
  }

  let cleanedText = text.trim();
  if (cleanedText.startsWith("```json")) {
    cleanedText = cleanedText.replace(/^```json\n?/, "").replace(/\n?```$/, "").trim();
  }
  
  try {
    return JSON.parse(cleanedText);
  } catch (parseError: any) {
    console.error(`Initial JSON parse failed (${modelName}):`, parseError.message);
    
    // Attempt to fix common truncation issues
    let fixedText = cleanedText;
    
    // 1. If it ends with a trailing comma, remove it
    fixedText = fixedText.replace(/,\s*$/, "");

    // 2. Handle unclosed quotes and balance braces/brackets
    let inString = false;
    let escaped = false;
    const stack: string[] = [];

    for (let i = 0; i < fixedText.length; i++) {
      const char = fixedText[i];
      if (escaped) {
        escaped = false;
        continue;
      }
      if (char === '\\') {
        escaped = true;
        continue;
      }
      if (char === '"') {
        inString = !inString;
        continue;
      }
      
      if (!inString) {
        if (char === '{') stack.push('}');
        else if (char === '[') stack.push(']');
        else if (char === '}' || char === ']') {
          if (stack.length > 0 && stack[stack.length - 1] === char) {
            stack.pop();
          }
        }
      }
    }
    
    if (inString) {
      fixedText += '"';
    }
    
    while (stack.length > 0) {
      fixedText += stack.pop();
    }

    try {
      return JSON.parse(fixedText);
    } catch (secondError: any) {
      console.error(`Second JSON parse failed (${modelName}):`, secondError.message);
      
      // 3. More aggressive string fixing: if we're in a string, it might be cut off
      // Let's try to find the last key-value pair that looks complete
      if (inString) {
        // Try to close the string and the object
        let tempText = fixedText;
        if (!tempText.endsWith('"')) tempText += '"';
        let tempStack = [...stack];
        while (tempStack.length > 0) tempText += tempStack.pop();
        try {
          return JSON.parse(tempText);
        } catch (e) {
          // Continue to final attempt
        }
      }

      // Final attempt: find the last complete object or array
      let lastValidIndex = -1;
      inString = false;
      escaped = false;
      for (let i = 0; i < cleanedText.length; i++) {
        const char = cleanedText[i];
        if (escaped) {
          escaped = false;
          continue;
        }
        if (char === '\\') {
          escaped = true;
          continue;
        }
        if (char === '"') {
          inString = !inString;
        } else if (!inString && (char === '}' || char === ']')) {
          lastValidIndex = i;
        }
      }
      
      if (lastValidIndex !== -1) {
        try {
          return JSON.parse(cleanedText.substring(0, lastValidIndex + 1));
        } catch (thirdError) {
          throw new Error(`JSON parsing failed even after recovery attempts. Original error: ${parseError.message}`);
        }
      }
      throw parseError;
    }
  }
}

export async function generateBlog(
  topic: string, 
  oldLinks: string[], 
  internalLinks: string[], 
  apiKeys: string[] = [], 
  preferredKey?: string, 
  openRouterKey?: string, 
  categorizedLinks: {url: string, category: string, title?: string}[] = [],
  customInstructions: string = ""
): Promise<BlogContent> {
  const prompt = `
    You are an expert B2B SaaS SEO strategist and conversion copywriter.
    Your task is to create a high-converting, SEO-optimized blog post for https://www.userixly.com/ that ranks on Google for high buyer-intent keywords.
    
    Title: "${topic}"
    
    ${customInstructions ? `**USER SPECIFIC INSTRUCTIONS**: \n${customInstructions}\n` : ""}

    **CRITICAL TITLE REQUIREMENT**:
    - The "Title" provided above MUST be used exactly as the main title of the blog post. DO NOT change it, rephrase it, or optimize it. Use it as is.

    **CRITICAL UNIQUENESS & TONE REQUIREMENT**: 
    - Before writing, analyze Reddit discussions and identify real user pain points, objections, and language related to the title "${topic}". Use that tone in the blog.
    - Make it read like human-written content, NOT AI-generated. Use unique analogies and a fresh perspective.
    - Write this content from scratch in your own words. DO NOT use verbatim quotes or long passages from existing websites.
    
    Follow these strict formatting and content rules:
    1. **Blog Creation & Structure**: 
       - **Length**: Write a comprehensive 1500–2500 word blog post.
       - **Hook**: Start with a strong hook in the first 3 lines (problem + curiosity).
       - **Structure**: Use clear H2 and H3 subheadings. **CRITICAL**: Every subheading MUST be formatted using HTML tags for a large, bold appearance (e.g., <h2 style="font-size: 32px; font-weight: bold; margin-bottom: 24px;">Subheading Title</h2>).
       - **Formatting**: Use skimmable formatting (short paragraphs of 2-4 sentences, bullets, numbered lists).
       - **White Space**: Use at least 3-4 line breaks between subheadings and paragraphs, and double line breaks between every paragraph.
       - **Value Ratio**: Make it 90% high-value educational content and 10% subtle promotion of Rixly.
       - **Comparison**: Include comparison sections if relevant to the topic.
       - **FAQ Section**: Include a "Frequently Asked Questions" section at the end for featured snippets. Format each question in **bold**.
       - **Final One-Liner**: End the entire post with a single, unique, and impactful one-liner promoting Rixly with a link. This MUST be different for every blog and highly relevant to the topic discussed. DO NOT mention "free" or "free trial" as Rixly is a paid service. Example: "Supercharge your sales intelligence with <a href=\"https://userixly.com\" style=\"color: inherit; text-decoration: underline; font-weight: bold;\">Rixly</a> today."
    
    2. **Conversion & SEO Optimization**:
       - **CTAs**: Add 2–3 soft, non-pushy CTAs positioning Userixly as the natural solution.
       - **Keywords**: Naturally include relevant keywords without stuffing.
       - **Title**: Create a highly clickable SEO title (under 60 characters).
       - **Meta Description**: Create a compelling meta description (150–160 characters).
       - **Rixly Linking**: Mention "Rixly" naturally. Limit stylized HTML links to a MAXIMUM of 3. Format: <a href="https://userixly.com" style="color: inherit; text-decoration: underline; font-weight: bold;">Rixly</a>.
       - **No Dashes**: DO NOT use any dashes (-) in the blog content (except in the slug or within bulleted lists).
    
    3. **Categorization**:
       - Select the most appropriate category: Product Intelligence, Sales Intelligence, Community-Led Growth, Reddit Marketing, or SEO and GEO.
    
    4. **Links & Backlinks**:
       - **Internal Linking**: Share exactly 10 old blog links cleverly throughout the article to show credibility and create backlinks.
       - **Categorized Links**: Use relevant links from this list: ${categorizedLinks.length > 0 ? JSON.stringify(categorizedLinks.slice(0, 50)) : "None provided."}
       - **Old/Internal Links**: ${oldLinks.length > 0 ? oldLinks.join(", ") : "None provided."}
       - **Styling**: Use descriptive anchor tags: <a href="URL" style="color: inherit; text-decoration: underline; font-weight: bold;">Descriptive Text</a>.
    
    5. **Visuals & Data**:
       - **Embedded Graph**: Include a highly stylized "bento-box" style HTML/CSS data visualization in the middle of the article. Use gradients, soft shadows, and rounded corners.
       - **Additional Body Visuals**: Instead of standard images, you MUST include at least 2-3 additional HTML/CSS based visual representations throughout the body of the blog. These should be process flowcharts, comparison tables, feature grids, or step-by-step diagrams. 
       - **Styling for Visuals**: Use clean HTML and inline CSS with a premium, modern aesthetic (gradients, subtle borders, shadows). Ensure they are fully responsive and enhance the educational value of the post.
       - **CRITICAL VISIBILITY**: Ensure all text within HTML/CSS visuals has EXTREMELY high contrast. Use dark text colors (e.g., color: #0f172a; or color: #1e293b;) for any light-colored visual elements, comparison cards, or flowcharts. NEVER use white, silver, or light grey text on light backgrounds. Every single word must be perfectly legible and stand out.
    
    6. **Featured Image**: Provide a descriptive prompt for a professional header image and include descriptive Alt Text.
    
    **REQUIRED JSON STRUCTURE**:
    Return a MINIFIED JSON object with:
    - "title": The blog title (under 60 chars).
    - "author": "Mevin".
    - "category": Selected category.
    - "excerpt": 150-200 character summary.
    - "seoTitle": SEO title (max 60 chars).
    - "seoDescription": Meta description (150-160 chars).
    - "tags": Array of 3-5 keywords.
    - "slug": URL-friendly slug.
    - "content": Full Markdown content with HTML graph and FAQ.
    - "imagePrompt": Prompt for the header image.
    - "altText": Descriptive alt text for the header image.
  `;

    if (openRouterKey) {
      try {
        console.log("Attempting generation via OpenRouter...");
        const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${openRouterKey}`,
            "Content-Type": "application/json",
            "HTTP-Referer": window.location.origin,
            "X-Title": "Rixly Automator"
          },
          body: JSON.stringify({
            model: "google/gemini-flash-1.5", // Good default for OpenRouter
            messages: [{ role: "user", content: prompt }],
            response_format: { type: "json_object" }
          })
        });
        const data = await response.json();
        if (data.choices?.[0]?.message?.content) {
          const blog = handleResponse({ text: data.choices[0].message.content }, "openrouter-gemini");
          return processBlogContent(blog);
        }
      } catch (orError) {
        console.error("OpenRouter generation failed:", orError);
      }
    }

    return callWithRetry(apiKeys, async (ai) => {
    // Try multiple models in case some keys are restricted to specific versions
    const modelsToTry = [
      "gemini-3-flash-preview",
      "gemini-1.5-flash",
      "gemini-1.5-pro"
    ];
    let lastGenError: any;

    for (const modelName of modelsToTry) {
      // Try with responseSchema first (best quality)
      try {
        const result = await ai.models.generateContent({
          model: modelName,
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          config: {
            responseMimeType: "application/json",
            maxOutputTokens: 12000, 
            temperature: 0.7,
            topP: 0.95,
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                title: { type: Type.STRING },
                author: { type: Type.STRING, description: "The author name MUST always be 'Mevin'." },
                category: { type: Type.STRING, description: "Select the most relevant category from the provided list." },
                excerpt: { type: Type.STRING, description: "A short summary of the blog post (150-200 characters)." },
                seoTitle: { type: Type.STRING, description: "A catchy SEO title (max 60 characters)." },
                seoDescription: { type: Type.STRING, description: "A meta description for SEO (150-160 characters)." },
                tags: { 
                  type: Type.ARRAY, 
                  items: { type: Type.STRING },
                  description: "A list of 3-5 relevant keywords."
                },
                slug: { type: Type.STRING },
                content: { type: Type.STRING, description: "The full blog content in Markdown format, including the embedded HTML graph in the middle and the FAQ at the end." },
                imagePrompt: { type: Type.STRING },
                altText: { type: Type.STRING, description: "Descriptive alt text for the header image." }
              },
              required: ["title", "author", "category", "excerpt", "seoTitle", "seoDescription", "tags", "slug", "content", "imagePrompt", "altText"]
            }
          }
        });
        const blog = handleResponse(result, modelName);
        return processBlogContent(blog);
      } catch (error: any) {
        console.warn(`Model ${modelName} with responseSchema failed, trying without...`);
        
        // Fallback: Try without responseSchema (more compatible with some keys/regions)
        try {
          const result = await ai.models.generateContent({
            model: modelName,
            contents: [{ role: "user", parts: [{ text: prompt + "\n\nIMPORTANT: Return ONLY a valid JSON object. If the content is long, ensure you close all JSON braces properly." }] }],
            config: {
              maxOutputTokens: 8192, // Increased for better compatibility
              temperature: 0.7,
            }
          });
          const blog = handleResponse(result, modelName);
          return processBlogContent(blog);
        } catch (fallbackError: any) {
          lastGenError = fallbackError;
          const errorMsg = fallbackError.message || "";
          if (
            errorMsg.includes("403") || 
            errorMsg.includes("permission") || 
            errorMsg.includes("404") || 
            errorMsg.includes("not found") ||
            errorMsg.includes("JSON") ||
            errorMsg.includes("parsing")
          ) {
            console.warn(`Model ${modelName} failed or produced bad JSON, trying next model...`);
            continue;
          }
          throw fallbackError;
        }
      }
    }
    throw lastGenError || new Error("Failed to generate blog with any available model");
  }, preferredKey);
}

function processBlogContent(blog: any): BlogContent {
  // Normalize keys in case AI returns different casing or snake_case
  const normalized: any = {
    title: blog.title || blog.blog_title || "",
    author: blog.author || "Mevin",
    category: blog.category || blog.blog_category || "Product Intelligence",
    excerpt: blog.excerpt || blog.summary || blog.blog_summary || "",
    seoTitle: blog.seoTitle || blog.seo_title || blog.meta_title || blog.title || "",
    seoDescription: blog.seoDescription || blog.seo_description || blog.meta_description || "",
    tags: Array.isArray(blog.tags) ? blog.tags : (typeof blog.tags === 'string' ? blog.tags.split(',').map((t: string) => t.trim()) : []),
    slug: blog.slug || "",
    content: blog.content || blog.body || "",
    imagePrompt: blog.imagePrompt || blog.image_prompt || blog.title || "",
    altText: blog.altText || blog.alt_text || blog.title || "",
    faq: blog.faq || [],
    chartData: blog.chartData || [],
    chartConfig: blog.chartConfig || { type: "bar", xAxisKey: "name", dataKey: "value", title: "Data Visualization" }
  };

  let content = normalized.content;

  // Add the final CTA one-liner if it's missing
  const finalCTA = `Discover how <a href="https://userixly.com" style="color: inherit; text-decoration: underline; font-weight: bold;">Rixly</a> can transform your business today.`;
  if (!content.includes('https://userixly.com') && !content.toLowerCase().includes('rixly</a>')) {
    content = content.trim() + "\n\n" + finalCTA;
  }

  return {
    ...normalized,
    content
  };
}

export async function generateImage(prompt: string, apiKeys: string[] = [], preferredKey?: string, openRouterKey?: string): Promise<string> {
  const delays = [5000, 15000, 30000];
  
  return callWithRetry(apiKeys, async (ai) => {
    // According to gemini-api skill, these are the current image generation models
    const modelsToTry = [
      'gemini-2.5-flash-image', // Preferred: General generation
      'gemini-3.1-flash-image-preview', // High quality backup
      'imagen-4.0-generate-001' // Imagen fallback if available
    ];
    
    let lastImageError: any;

    // Retry loop: Total 4 attempts (Initial + 3 retries)
    for (let attempt = 0; attempt <= 3; attempt++) {
      if (attempt > 0) {
        console.warn(`Image generation attempt ${attempt} failed. Retrying in ${delays[attempt-1] / 1000}s...`);
        await new Promise(resolve => setTimeout(resolve, delays[attempt-1]));
      }

      for (const modelName of modelsToTry) {
        try {
          // imagen-4.0 uses a different method
          if (modelName.startsWith('imagen')) {
             const response = await ai.models.generateImages({
                model: modelName,
                prompt: `A professional, high-quality blog header image for: "${prompt}". Style: Modern, clean, wide-angle, professional photography. Direct focus on the theme. No text in the image.`,
                config: {
                  numberOfImages: 1,
                  aspectRatio: "16:9"
                }
             });
             if (response.generatedImages?.[0]?.image?.imageBytes) {
               return `data:image/png;base64,${response.generatedImages[0].image.imageBytes}`;
             }
             throw new Error("Imagen response did not contain image data");
          }

          const response = await ai.models.generateContent({
            model: modelName,
            contents: {
              parts: [
                {
                  text: `A professional, high-quality blog header image for: "${prompt}". Style: Modern, clean, wide-angle, professional photography. Direct focus on the theme. No text in the image.`,
                },
              ],
            },
            config: {
              imageConfig: {
                aspectRatio: "16:9"
              }
            }
          });

          if (response.candidates?.[0]?.content?.parts) {
            for (const part of response.candidates[0].content.parts) {
              if (part.inlineData) {
                console.log(`Successfully generated AI image using ${modelName} on attempt ${attempt + 1}`);
                return `data:image/png;base64,${part.inlineData.data}`;
              }
            }
          }
          throw new Error("AI response did not contain image data");
        } catch (error: any) {
          lastImageError = error;
          const errorMsg = (error.message || "").toLowerCase();
          
          // If it's a quota issue for this specific model, try the next model in this attempt
          if (errorMsg.includes("429") || errorMsg.includes("quota")) {
            console.warn(`Image model ${modelName} hit quota on attempt ${attempt + 1}, trying next model...`);
            continue;
          }
          
          // For other errors, we still continue the attempt loop unless it's something fatal
          console.error(`Error with model ${modelName} on attempt ${attempt + 1}:`, errorMsg);
        }
      }
    }
    
    // If we've exhausted all attempts and all models
    console.error("All AI Image generation attempts failed after retries.");
    throw lastImageError || new Error("Failed to generate AI image after 4 attempts");
  }, preferredKey);
}
