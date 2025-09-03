// Complete Recipe Enrichment System - Production Ready with Full AI
// Supports Vercel deployment with robust error handling and timeouts

import { Client } from '@notionhq/client';
import fetch from 'node-fetch';
import * as cheerio from 'cheerio';
import nodemailer from 'nodemailer';

// Configuration Constants
const CONFIG = {
  MAX_RECIPES_PER_BATCH: 3, // Reduced for Vercel limits
  DEFAULT_DATABASE_ID: "1b1ea313dfba4618915c4574ad7ed576",
  AI_TIMEOUT_MS: 25000, // 25s for OpenAI (within Vercel's 30s limit)
  SCRAPE_TIMEOUT_MS: 15000, // 15s for web scraping
  MAX_IMAGE_SIZE: 5 * 1024 * 1024, // 5MB
  MAX_RETRIES: 2,
  CACHE_TTL_MS: 24 * 60 * 60 * 1000 // 24 hours
};

// Environment Variables with validation
const NOTION_TOKEN = process.env.NOTION_TOKEN;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const DATABASE_ID = process.env.NOTION_DATABASE_ID || CONFIG.DEFAULT_DATABASE_ID;
const EMAIL_USER = process.env.EMAIL_USER;
const EMAIL_PASS = process.env.EMAIL_PASS;
const RECIPIENT_EMAIL = process.env.RECIPIENT_EMAIL;

// Environment validation
if (!NOTION_TOKEN) {
  console.error('❌ Missing NOTION_TOKEN environment variable');
}
if (!OPENAI_API_KEY) {
  console.warn('⚠️ Missing OPENAI_API_KEY - will use basic analysis only');
}

// Initialize clients with error handling
let notion;
try {
  notion = new Client({ auth: NOTION_TOKEN });
} catch (error) {
  console.error('Failed to initialize Notion client:', error.message);
}

// In-memory cache for API responses
const cache = new Map();

// Circuit breaker for OpenAI API
const circuitBreaker = {
  failures: 0,
  lastFailTime: null,
  threshold: 3,
  resetTime: 5 * 60 * 1000, // 5 minutes
  
  isOpen() {
    if (this.failures >= this.threshold) {
      const timeSinceLastFail = Date.now() - this.lastFailTime;
      return timeSinceLastFail < this.resetTime;
    }
    return false;
  },
  
  recordSuccess() {
    this.failures = 0;
    this.lastFailTime = null;
  },
  
  recordFailure() {
    this.failures++;
    this.lastFailTime = Date.now();
  }
};

// Recipe Options (shared with frontend)
const RECIPE_OPTIONS = {
  CUISINE: [
    "African", "American", "Asian", "Brazilian", "Chinese", "Dessert", 
    "French", "German", "Greek", "Hungarian", "Indian", "Italian", 
    "Japanese", "Korean", "Mediterranean", "Mexican", "Middle Eastern", 
    "Persian", "Peruvian", "Spanish", "Thai", "Vietnamese"
  ],
  
  MEAL: [
    "Main Dish", "Side Dish", "Breakfast", "Dessert", "Snack", "Beverage"
  ],
  
  TAGS: [
    "Appetizer", "Baked", "Braised", "Breakfast", "Chocolate", "Citrusy",
    "Condiment", "Creamy", "Curry", "Drink", "Eggs", "Fish", "Grilled",
    "Herby", "No Bake", "Pasta", "Pickled", "Refreshing", "Roasted",
    "Salad", "Sandwich", "Savory", "Seafood", "Soup", "Spicy", "Steamed",
    "Stew", "Stir-Fry", "Sweet", "Tangy", "Traditional", "Vegan", "Vegetarian"
  ],
  
  INGREDIENTS: [
    "Beef", "Chicken", "Pork", "Fish", "Salmon", "Shrimp", "Eggs", "Cheese",
    "Pasta", "Rice", "Bread", "Potato", "Tomato", "Onions", "Garlic",
    "Spinach", "Broccoli", "Carrot", "Mushrooms", "Peppers", "Lemon",
    "Basil", "Herbs", "Ginger", "Chili", "Beans", "Cream", "Milk"
  ]
};

// Legacy aliases for backward compatibility
const CUISINE_OPTIONS = RECIPE_OPTIONS.CUISINE;
const MEAL_OPTIONS = RECIPE_OPTIONS.MEAL;
const TAG_OPTIONS = RECIPE_OPTIONS.TAGS;
const INGREDIENT_OPTIONS = RECIPE_OPTIONS.INGREDIENTS;

// Utility function for timeout handling
function withTimeout(promise, timeoutMs, errorMessage = 'Operation timeout') {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(errorMessage)), timeoutMs)
    )
  ]);
}

// Utility function for retry logic
async function withRetry(fn, maxRetries = CONFIG.MAX_RETRIES, delay = 1000) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      if (attempt === maxRetries) throw error;
      
      console.warn(`Attempt ${attempt} failed: ${error.message}. Retrying in ${delay}ms...`);
      await new Promise(resolve => setTimeout(resolve, delay));
      delay *= 2; // Exponential backoff
    }
  }
}

class RecipeEnrichmentSystem {
  constructor() {
    if (EMAIL_USER && EMAIL_PASS) {
      try {
        this.emailTransporter = nodemailer.createTransport({
          service: 'gmail',
          auth: {
            user: EMAIL_USER,
            pass: EMAIL_PASS
          }
        });
      } catch (error) {
        console.warn('Failed to initialize email transporter:', error.message);
      }
    }
  }

  // Get incomplete recipes from Notion with error handling
  async getIncompleteRecipes() {
    try {
      if (!notion) {
        throw new Error('Notion client not initialized - check NOTION_TOKEN');
      }

      const response = await withTimeout(
        notion.databases.query({
          database_id: DATABASE_ID,
          filter: {
            or: [
              { property: "Meal", select: { is_empty: true } },
              { property: "Cuisine", select: { is_empty: true } },
              { property: "Key Ingredients", multi_select: { is_empty: true } },
              { property: "Tags", multi_select: { is_empty: true } }
            ]
          }
        }),
        CONFIG.SCRAPE_TIMEOUT_MS,
        'Notion API timeout'
      );

      const recipes = response.results.map(page => ({
        id: page.id,
        url: page.url,
        name: page.properties.Name?.title?.[0]?.plain_text || '',
        link: page.properties.Link?.url || '',
        current_meal: page.properties.Meal?.select?.name,
        current_cuisine: page.properties.Cuisine?.select?.name,
        current_tags: page.properties.Tags?.multi_select?.map(tag => tag.name) || [],
        current_ingredients: page.properties['Key Ingredients']?.multi_select?.map(ing => ing.name) || []
      }));

      console.log(`✅ Found ${recipes.length} recipes needing enrichment`);
      return recipes;

    } catch (error) {
      console.error('❌ Error fetching recipes from Notion:', error.message);
      throw new Error(`Failed to fetch recipes: ${error.message}`);
    }
  }

  // Extract recipe data from URL with comprehensive error handling
  async extractRecipeFromURL(url) {
    if (!url) return null;
    
    // Check cache first
    const cacheKey = `scrape:${url}`;
    const cached = cache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < CONFIG.CACHE_TTL_MS) {
      console.log(`📋 Using cached data for: ${url}`);
      return cached.data;
    }
    
    try {
      console.log(`🌐 Scraping recipe from: ${url}`);
      
      const response = await withTimeout(
        withRetry(async () => {
          const res = await fetch(url, {
            headers: {
              'User-Agent': 'Mozilla/5.0 (compatible; RecipeBot/1.0; +https://recipe-enrichment.vercel.app)',
              'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
              'Accept-Language': 'en-US,en;q=0.5',
              'Accept-Encoding': 'gzip, deflate',
              'Connection': 'keep-alive'
            }
          });
          
          if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
          }
          
          return res;
        }),
        CONFIG.SCRAPE_TIMEOUT_MS,
        'Web scraping timeout'
      );
      
      const html = await response.text();
      const $ = cheerio.load(html);
      
      // Extract recipe data using multiple strategies
      const recipeData = {
        title: this.extractTitle($),
        ingredients: this.extractIngredients($),
        instructions: this.extractInstructions($),
        images: this.extractMainImage($),
        description: this.extractDescription($)
      };
      
      // Cache the result
      cache.set(cacheKey, {
        data: recipeData,
        timestamp: Date.now()
      });
      
      console.log(`✅ Scraped data: ${recipeData.ingredients?.length || 0} ingredients, ${recipeData.instructions?.length || 0} instructions`);
      return recipeData;
      
    } catch (error) {
      console.warn(`⚠️ Failed to scrape ${url}: ${error.message}`);
      return null;
    }
  }

  // Extract title from webpage
  extractTitle($) {
    const titleSelectors = [
      '.recipe-title',
      '.entry-title', 
      '.post-title',
      '[class*="recipe"] h1',
      'h1[class*="title"]',
      'h1'
    ];
    
    for (const selector of titleSelectors) {
      const title = $(selector).first().text().trim();
      if (title && title.length > 5) {
        return title.substring(0, 200); // Limit length
      }
    }
    return null;
  }

  // Extract ingredients with multiple selectors
  extractIngredients($) {
    const ingredientSelectors = [
      '.recipe-ingredient',
      '.ingredient',
      '[class*="ingredient"]',
      '[itemprop="recipeIngredient"]',
      '.ingredients li',
      '.recipe-ingredients li',
      'ul[class*="ingredient"] li'
    ];
    
    const ingredients = [];
    for (const selector of ingredientSelectors) {
      $(selector).each((_, el) => {
        const ingredient = $(el).text().trim();
        if (ingredient && ingredient.length > 2 && ingredient.length < 200) {
          ingredients.push(ingredient);
        }
      });
      
      if (ingredients.length > 0) break; // Use first successful selector
    }
    
    // Remove duplicates and limit count
    return [...new Set(ingredients)].slice(0, 25);
  }

  // Extract instructions
  extractInstructions($) {
    const instructionSelectors = [
      '.recipe-instruction',
      '.instruction',
      '[class*="instruction"]',
      '[itemprop="recipeInstructions"]',
      '.instructions li',
      '.recipe-instructions li',
      'ol[class*="instruction"] li'
    ];
    
    const instructions = [];
    for (const selector of instructionSelectors) {
      $(selector).each((_, el) => {
        const instruction = $(el).text().trim();
        if (instruction && instruction.length > 5 && instruction.length < 1000) {
          instructions.push(instruction);
        }
      });
      
      if (instructions.length > 0) break; // Use first successful selector
    }
    
    return instructions.slice(0, 20); // Limit to 20 steps
  }

  // Extract main image (simplified for performance)
  extractMainImage($) {
    const images = [];
    const seenUrls = new Set();
    
    const prioritySelectors = [
      '.recipe-image img',
      '.post-thumbnail img', 
      '.featured-image img',
      '[class*="recipe"] img'
    ];
    
    for (const selector of prioritySelectors) {
      $(selector).each((_, elem) => {
        const img = $(elem);
        const src = img.attr('src') || img.attr('data-src');
        
        if (src && this.isValidImageUrl(src) && !seenUrls.has(src)) {
          seenUrls.add(src);
          images.push({
            url: src,
            alt: img.attr('alt') || '',
            width: parseInt(img.attr('width')) || null,
            height: parseInt(img.attr('height')) || null,
            source: 'priority'
          });
        }
      });
      
      if (images.length >= 3) break; // Limit to prevent performance issues
    }
    
    return images.length > 0 ? images : null;
  }

  // Extract description
  extractDescription($) {
    const descSelectors = [
      '.recipe-description',
      '.recipe-summary', 
      '.entry-content p',
      '[class*="description"]'
    ];
    
    for (const selector of descSelectors) {
      const desc = $(selector).first().text().trim();
      if (desc && desc.length > 50 && desc.length < 500) {
        return desc;
      }
    }
    
    return null;
  }

  // Helper method to validate image URLs
  isValidImageUrl(url) {
    if (!url || typeof url !== 'string') return false;
    if (!url.startsWith('http')) return false;
    
    const imageExtensions = /\.(jpg|jpeg|png|gif|webp|svg)(\?|$)/i;
    const imageDomains = /\.(amazonaws\.com|cloudfront\.net|wp\.com|squarespace\.com)/i;
    
    return imageExtensions.test(url) || imageDomains.test(url);
  }

  // Use AI to analyze and categorize recipe with robust error handling
  async analyzeRecipeWithAI(recipe, extractedData) {
    // Check if OpenAI is available and circuit breaker is closed
    if (!OPENAI_API_KEY || circuitBreaker.isOpen()) {
      console.log('🤖 OpenAI unavailable, using fallback analysis');
      return this.createSmartFallbackAnalysis(recipe, extractedData);
    }
    
    const cacheKey = `ai:${recipe.name}:${recipe.link}`;
    const cached = cache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < CONFIG.CACHE_TTL_MS) {
      console.log(`🧠 Using cached AI analysis for: ${recipe.name}`);
      return cached.data;
    }
    
    try {
      console.log(`🤖 Running AI analysis for: ${recipe.name}`);
      
      const context = extractedData ? `
        Extracted Title: ${extractedData.title || 'N/A'}
        Sample Ingredients: ${extractedData.ingredients?.slice(0, 8).join(', ') || 'N/A'}
        Description: ${extractedData.description || 'N/A'}
      ` : 'No extracted data available';

      const prompt = `
      Analyze this recipe and provide enrichment data in VALID JSON format:
      
      Recipe Name: ${recipe.name}
      Source Link: ${recipe.link || 'No link'}
      ${context}
      
      Current Data (preserve if exists):
      - Meal Type: ${recipe.current_meal || 'Not set'}
      - Cuisine: ${recipe.current_cuisine || 'Not set'}
      - Tags: ${recipe.current_tags?.join(', ') || 'None'}
      - Key Ingredients: ${recipe.current_ingredients?.join(', ') || 'None'}
      
      RULES:
      1. Only suggest values for MISSING fields (null if field already has data)
      2. Choose from EXACT options provided below
      3. For key_ingredients, select 3-5 most important ingredients from the list
      4. Respond with ONLY valid JSON, no markdown or explanations
      
      Available Options:
      - MEAL TYPES: ${MEAL_OPTIONS.join(', ')}
      - CUISINES: ${CUISINE_OPTIONS.join(', ')}
      - TAGS: ${TAG_OPTIONS.join(', ')}
      - KEY INGREDIENTS: ${INGREDIENT_OPTIONS.join(', ')}
      
      {
        "standardized_title": "improved title or null",
        "meal": "meal_type or null if exists",
        "cuisine": "cuisine or null if exists", 
        "tags": ["tag1", "tag2"] or null if exists,
        "key_ingredients": ["ingredient1", "ingredient2"] or null if exists,
        "confidence": 0.85,
        "reasoning": "Brief explanation"
      }
      `;

      const response = await withTimeout(
        fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${OPENAI_API_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: 'gpt-4o-mini',
            messages: [{ role: 'user', content: prompt }],
            max_tokens: 400,
            temperature: 0.2
          })
        }),
        CONFIG.AI_TIMEOUT_MS,
        'OpenAI API timeout'
      );

      if (!response.ok) {
        throw new Error(`OpenAI API error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      const content = data.choices?.[0]?.message?.content?.trim();
      
      if (!content) {
        throw new Error('Empty response from OpenAI');
      }

      let analysis;
      try {
        analysis = JSON.parse(content);
      } catch (parseError) {
        console.warn('⚠️ Failed to parse AI response, using fallback');
        return this.createSmartFallbackAnalysis(recipe, extractedData);
      }

      // Validate the analysis structure
      if (!analysis || typeof analysis !== 'object') {
        throw new Error('Invalid analysis structure');
      }

      // Cache successful result
      cache.set(cacheKey, {
        data: analysis,
        timestamp: Date.now()
      });
      
      circuitBreaker.recordSuccess();
      console.log(`✅ AI analysis complete for: ${recipe.name} (confidence: ${analysis.confidence})`);
      
      return analysis;

    } catch (error) {
      console.warn(`⚠️ AI analysis failed for ${recipe.name}: ${error.message}`);
      circuitBreaker.recordFailure();
      
      // Return smart fallback analysis
      return this.createSmartFallbackAnalysis(recipe, extractedData);
    }
  }

  // Create smart fallback analysis using recipe name and extracted data
  createSmartFallbackAnalysis(recipe, extractedData) {
    console.log(`🧠 Creating smart fallback analysis for: ${recipe.name}`);
    
    const name = recipe.name.toLowerCase();
    const ingredients = extractedData?.ingredients || [];
    
    // Smart meal type inference
    let meal = null;
    if (!recipe.current_meal) {
      if (name.includes('breakfast') || name.includes('pancake') || name.includes('oatmeal') || name.includes('cereal')) {
        meal = 'Breakfast';
      } else if (name.includes('dessert') || name.includes('cake') || name.includes('cookie') || name.includes('ice cream')) {
        meal = 'Dessert';
      } else if (name.includes('salad') || name.includes('side') || name.includes('appetizer')) {
        meal = 'Side Dish';
      } else if (name.includes('drink') || name.includes('smoothie') || name.includes('juice')) {
        meal = 'Beverage';
      } else if (name.includes('snack')) {
        meal = 'Snack';
      } else {
        meal = 'Main Dish';
      }
    }

    // Smart cuisine inference
    let cuisine = null;
    if (!recipe.current_cuisine) {
      if (name.includes('italian') || name.includes('pasta') || name.includes('pizza') || name.includes('risotto')) {
        cuisine = 'Italian';
      } else if (name.includes('mexican') || name.includes('taco') || name.includes('burrito') || name.includes('enchilada')) {
        cuisine = 'Mexican';
      } else if (name.includes('chinese') || name.includes('stir fry') || name.includes('wok')) {
        cuisine = 'Chinese';
      } else if (name.includes('indian') || name.includes('curry') || name.includes('masala')) {
        cuisine = 'Indian';
      } else if (name.includes('french') || name.includes('crepe') || name.includes('baguette')) {
        cuisine = 'French';
      } else if (name.includes('japanese') || name.includes('sushi') || name.includes('teriyaki')) {
        cuisine = 'Japanese';
      } else if (name.includes('thai') || name.includes('pad thai')) {
        cuisine = 'Thai';
      } else if (name.includes('mediterranean') || name.includes('greek')) {
        cuisine = 'Mediterranean';
      }
    }

    // Smart key ingredients extraction from scraped data
    let key_ingredients = null;
    if (!recipe.current_ingredients?.length && ingredients.length > 0) {
      key_ingredients = this.extractKeyIngredientsFromList(ingredients);
    }

    // Smart tags inference
    let tags = null;
    if (!recipe.current_tags?.length) {
      tags = this.inferTagsFromNameAndIngredients(name, ingredients);
    }

    return {
      standardized_title: null, // Don't change existing titles in fallback
      meal: meal,
      cuisine: cuisine,
      tags: tags,
      key_ingredients: key_ingredients,
      confidence: 0.7,
      reasoning: "Smart rule-based analysis with ingredient extraction"
    };
  }

  // Extract key ingredients from scraped ingredients list
  extractKeyIngredientsFromList(scrapedIngredients) {
    const keyIngredients = [];
    
    // Map common ingredient patterns to our ingredient options
    const ingredientMapping = {
      'chicken': ['chicken', 'poultry'],
      'beef': ['beef', 'ground beef', 'steak'],
      'pork': ['pork', 'bacon', 'ham'],
      'fish': ['fish', 'cod', 'tilapia'],
      'salmon': ['salmon'],
      'shrimp': ['shrimp', 'prawns'],
      'eggs': ['egg', 'eggs'],
      'cheese': ['cheese', 'cheddar', 'mozzarella', 'parmesan'],
      'pasta': ['pasta', 'spaghetti', 'penne', 'noodles'],
      'rice': ['rice', 'basmati', 'jasmine'],
      'bread': ['bread', 'flour', 'wheat'],
      'potato': ['potato', 'potatoes'],
      'tomato': ['tomato', 'tomatoes'],
      'onions': ['onion', 'onions'],
      'garlic': ['garlic'],
      'spinach': ['spinach'],
      'broccoli': ['broccoli'],
      'carrot': ['carrot', 'carrots'],
      'mushrooms': ['mushroom', 'mushrooms'],
      'peppers': ['pepper', 'peppers', 'bell pepper'],
      'lemon': ['lemon', 'lemons'],
      'basil': ['basil'],
      'herbs': ['herbs', 'parsley', 'cilantro', 'oregano'],
      'ginger': ['ginger'],
      'chili': ['chili', 'jalapeño', 'cayenne'],
      'beans': ['beans', 'black beans', 'kidney beans'],
      'cream': ['cream', 'heavy cream'],
      'milk': ['milk']
    };

    // Check each scraped ingredient against our mapping
    for (const scrapedIngredient of scrapedIngredients.slice(0, 10)) {
      const ingredient = scrapedIngredient.toLowerCase();
      
      for (const [keyIngredient, patterns] of Object.entries(ingredientMapping)) {
        if (patterns.some(pattern => ingredient.includes(pattern))) {
          const mappedIngredient = INGREDIENT_OPTIONS.find(opt => 
            opt.toLowerCase() === keyIngredient.toLowerCase()
          );
          if (mappedIngredient && !keyIngredients.includes(mappedIngredient)) {
            keyIngredients.push(mappedIngredient);
          }
        }
      }
      
      if (keyIngredients.length >= 5) break; // Limit to 5 key ingredients
    }
    
    return keyIngredients.length > 0 ? keyIngredients : null;
  }

  // Infer tags from recipe name and ingredients
  inferTagsFromNameAndIngredients(name, ingredients) {
    const tags = [];
    const ingredientText = ingredients.join(' ').toLowerCase();
    
    // Cooking method tags
    if (name.includes('baked') || name.includes('baking')) tags.push('Baked');
    if (name.includes('grilled') || name.includes('grill')) tags.push('Grilled');
    if (name.includes('roasted') || name.includes('roast')) tags.push('Roasted');
    if (name.includes('stir fry') || name.includes('stir-fry')) tags.push('Stir-Fry');
    if (name.includes('steamed')) tags.push('Steamed');
    if (name.includes('braised')) tags.push('Braised');
    
    // Dish type tags
    if (name.includes('salad')) tags.push('Salad');
    if (name.includes('soup')) tags.push('Soup');
    if (name.includes('sandwich')) tags.push('Sandwich');
    if (name.includes('pasta')) tags.push('Pasta');
    if (name.includes('curry')) tags.push('Curry');
    
    // Flavor profile tags
    if (name.includes('spicy') || ingredientText.includes('chili') || ingredientText.includes('pepper')) {
      tags.push('Spicy');
    }
    if (name.includes('sweet') || ingredientText.includes('sugar') || ingredientText.includes('honey')) {
      tags.push('Sweet');
    }
    if (name.includes('creamy') || ingredientText.includes('cream') || ingredientText.includes('cheese')) {
      tags.push('Creamy');
    }
    
    // Dietary tags
    const meatKeywords = ['chicken', 'beef', 'pork', 'fish', 'salmon', 'shrimp'];
    const hasMeat = meatKeywords.some(meat => 
      name.includes(meat) || ingredientText.includes(meat)
    );
    if (!hasMeat && !ingredientText.includes('egg') && !ingredientText.includes('cheese')) {
      tags.push('Vegan');
    } else if (!hasMeat) {
      tags.push('Vegetarian');
    }
    
    return tags.length > 0 ? tags.slice(0, 4) : null; // Limit to 4 tags
  }

  // Create review data with full AI processing
  async createReviewData(recipes) {
    const reviewItems = [];
    const processedRecipes = recipes.slice(0, CONFIG.MAX_RECIPES_PER_BATCH);
    
    console.log(`🚀 Processing ${processedRecipes.length} recipes with full AI analysis`);
    
    // Process recipes in parallel but with concurrency limit
    const processingPromises = processedRecipes.map(async (recipe) => {
      try {
        console.log(`📝 Processing: ${recipe.name}`);
        
        // Extract data from URL if available
        let extractedData = null;
        if (recipe.link) {
          extractedData = await this.extractRecipeFromURL(recipe.link);
        }
        
        // Get AI analysis
        const analysis = await this.analyzeRecipeWithAI(recipe, extractedData);
        
        if (analysis) {
          return {
            recipe,
            extractedData: extractedData || { source: 'notion-only' },
            analysis,
            suggestedChanges: this.formatSuggestedChanges(recipe, analysis, extractedData)
          };
        }
        
        return null;
        
      } catch (error) {
        console.error(`❌ Error processing recipe ${recipe.name}:`, error.message);
        return null; // Continue with other recipes
      }
    });
    
    // Wait for all processing to complete
    const results = await Promise.all(processingPromises);
    
    // Filter out null results
    reviewItems.push(...results.filter(item => item !== null));
    
    console.log(`✅ Successfully processed ${reviewItems.length} recipes`);
    return reviewItems;
  }

  // Format suggested changes for review
  formatSuggestedChanges(recipe, analysis, extractedData) {
    const changes = {};
    
    // Only suggest changes for empty/missing fields
    if (!recipe.current_meal && analysis.meal) {
      changes.meal = {
        current: recipe.current_meal || 'Empty',
        suggested: analysis.meal
      };
    }
    
    if (!recipe.current_cuisine && analysis.cuisine) {
      changes.cuisine = {
        current: recipe.current_cuisine || 'Empty',
        suggested: analysis.cuisine
      };
    }
    
    if ((!recipe.current_tags || recipe.current_tags.length === 0) && analysis.tags && analysis.tags.length > 0) {
      changes.tags = {
        current: recipe.current_tags || [],
        suggested: analysis.tags
      };
    }
    
    if ((!recipe.current_ingredients || recipe.current_ingredients.length === 0) && analysis.key_ingredients && analysis.key_ingredients.length > 0) {
      changes.key_ingredients = {
        current: recipe.current_ingredients || [],
        suggested: analysis.key_ingredients
      };
    }
    
    if (analysis.standardized_title && analysis.standardized_title !== recipe.name) {
      changes.title = {
        current: recipe.name,
        suggested: analysis.standardized_title
      };
    }
    
    return changes;
  }
}

// Validation utilities
function validateUpdateData(updates) {
  const allowedFields = ['title', 'meal', 'cuisine', 'tags', 'keyIngredients', 'selectedImage'];
  const validated = {};
  
  for (const [key, value] of Object.entries(updates)) {
    if (allowedFields.includes(key) && value !== undefined) {
      validated[key] = sanitizeInput(value);
    }
  }
  
  return validated;
}

function sanitizeInput(input) {
  if (typeof input === 'string') {
    return input.trim().slice(0, 10000); // Limit string length
  }
  if (Array.isArray(input)) {
    return input.slice(0, 50).map(item => String(item).trim().slice(0, 100));
  }
  return input;
}

function validateRecipeId(recipeId) {
  if (!recipeId || typeof recipeId !== 'string' || recipeId.length < 10) {
    throw new Error('Invalid recipe ID');
  }
  return recipeId;
}

// Main API handler for Vercel
export default async function handler(req, res) {
  const startTime = Date.now();
  
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  try {
    // Environment validation
    if (!NOTION_TOKEN || !DATABASE_ID) {
      return res.status(500).json({
        success: false,
        error: 'Missing required environment variables',
        details: {
          hasNotionToken: !!NOTION_TOKEN,
          hasDatabaseId: !!DATABASE_ID,
          hasOpenAIKey: !!OPENAI_API_KEY
        }
      });
    }

    const enricher = new RecipeEnrichmentSystem();
    
    if (req.method === 'GET') {
      const refreshType = req.query.refresh || 'notion';
      console.log(`🔄 Refresh type: ${refreshType}`);
      
      // Get recipes from Notion
      const recipes = await enricher.getIncompleteRecipes();
      
      if (recipes.length === 0) {
        return res.status(200).json({
          success: true,
          data: [],
          stats: {
            totalRecipes: 0,
            totalSuggestions: 0,
            imagesFound: 0,
            avgConfidence: 0,
            processingTime: Date.now() - startTime
          },
          message: 'No recipes need enrichment'
        });
      }
      
      // Process with full AI analysis
      const reviewData = await enricher.createReviewData(recipes);
      
      const stats = {
        totalRecipes: reviewData.length,
        totalSuggestions: reviewData.reduce((sum, item) => {
          return sum + Object.keys(item.suggestedChanges).length;
        }, 0),
        imagesFound: reviewData.filter(item => item.extractedData?.images).length,
        avgConfidence: reviewData.length > 0 
          ? reviewData.reduce((sum, item) => sum + item.analysis.confidence, 0) / reviewData.length 
          : 0,
        processingTime: Date.now() - startTime,
        aiAvailable: !!OPENAI_API_KEY && !circuitBreaker.isOpen(),
        cacheSize: cache.size
      };
      
      console.log(`✅ Request completed in ${stats.processingTime}ms`);
      
      return res.status(200).json({
        success: true,
        data: reviewData,
        stats: stats
      });
      
    } else if (req.method === 'POST') {
      const { action, recipeId, updates } = req.body || {};
      
      if (action === 'updateRecipe' && recipeId && updates) {
        // Validate inputs
        const validatedRecipeId = validateRecipeId(recipeId);
        const validatedUpdates = validateUpdateData(updates);
        
        try {
          const properties = {};
          
          // Handle title update
          if (validatedUpdates.title) {
            properties.Name = {
              title: [{ text: { content: validatedUpdates.title } }]
            };
          }
          
          // Handle meal update
          if (validatedUpdates.meal) {
            properties.Meal = { select: { name: validatedUpdates.meal } };
          }
          
          // Handle cuisine update
          if (validatedUpdates.cuisine) {
            properties.Cuisine = { select: { name: validatedUpdates.cuisine } };
          }
          
          // Handle tags update
          if (validatedUpdates.tags && Array.isArray(validatedUpdates.tags)) {
            properties.Tags = {
              multi_select: validatedUpdates.tags.map(tag => ({ name: tag }))
            };
          }
          
          // Handle key ingredients update
          if (validatedUpdates.keyIngredients && Array.isArray(validatedUpdates.keyIngredients)) {
            properties['Key Ingredients'] = {
              multi_select: validatedUpdates.keyIngredients.map(ing => ({ name: ing }))
            };
          }
          
          // Handle image update
          if (validatedUpdates.selectedImage) {
            await notion.pages.update({
              page_id: validatedRecipeId,
              cover: {
                external: {
                  url: validatedUpdates.selectedImage
                }
              }
            });
          }
          
          // Update the page properties
          if (Object.keys(properties).length > 0) {
            await withTimeout(
              notion.pages.update({
                page_id: validatedRecipeId,
                properties
              }),
              CONFIG.SCRAPE_TIMEOUT_MS,
              'Notion update timeout'
            );
          }
          
          console.log(`✅ Updated recipe: ${validatedRecipeId}`);
          
          return res.status(200).json({
            success: true,
            message: 'Recipe updated successfully'
          });
          
        } catch (error) {
          console.error('❌ Error updating recipe:', error.message);
          return res.status(500).json({
            success: false,
            error: 'Failed to update recipe',
            details: error.message
          });
        }
        
      } else {
        return res.status(400).json({
          success: false,
          error: 'Invalid request format - missing action, recipeId, or updates'
        });
      }
      
    } else {
      return res.status(405).json({ 
        success: false,
        error: 'Method not allowed' 
      });
    }
    
  } catch (error) {
    console.error('❌ API Error:', error);
    return res.status(500).json({ 
      success: false,
      error: error.message,
      details: process.env.NODE_ENV === 'development' ? error.stack : 'Internal server error',
      processingTime: Date.now() - startTime
    });
  }
}